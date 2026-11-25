/** Target-first operations from a fixed local OpenAPI contract. */
import fs from "node:fs";
import { Sandbox, type ConnectOptions } from "../../api/sandbox.js";
import { ApplicationError } from "../../application/config.js";
import { loadLayeredConfig } from "../../transport/config_layers.js";
import { validateApplicationEndpoint } from "../../transport/application_http.js";
import { requestOpenApi } from "../../transport/openapi_http.js";
import { cliOptions } from "../../providers/selection.js";
import { argument, command, option, type Params } from "../kit.js";
import { FLOAT } from "../types.js";
import { UsageError, Exit } from "../errors.js";
import { handleErrors } from "../error_handler.js";
import { getFormatter } from "../formatters.js";
import { echo } from "../io.js";
import { applicationToken } from "../template_environment.js";
import { captureDeploymentTarget, readDeployment, sandboxTarget } from "../deployment_store.js";
import { apiReference, bindingOptions, boundOperation, readApiBinding, requireReadyBinding, saveApiBinding, selectResource, type ApiBinding } from "../api_binding.js";
import { describeApiOperation, describeApiOperations, loadRegistryApis, prepareApiOperation, type PreparedApiRequest } from "../api_contract.js";

export const sandboxApiSeams = {
  connect: (id: string, options: ConnectOptions) => Sandbox.connect(id, options),
  applicationToken,
  environment: (name: string): string | undefined => process.env[name],
};

const help = `Invoke an operation declared by a Sandbox's bound OpenAPI contract.

Usage: abx sandbox TARGET [OPERATION] [options]

  abx sandbox TARGET --bind ./registry.yaml
  abx sandbox TARGET --help
  abx sandbox TARGET OPERATION --help
  abx sandbox TARGET OPERATION --body @request.json

TARGET is an existing Sandbox ID or local Sandbox deployment name.
Help is offline. Invocation never creates a Sandbox or falls back to shell execution.

Options:
  --help, -h                 Show the target's operations or an operation's contract
  --api NAME                 Select an API when operation IDs are ambiguous
  --body JSON|@FILE          JSON request body (maximum 1 MiB)
  --path NAME=VALUE          Path parameter; repeat for multiple parameters
  --query NAME=VALUE         Query parameter; repeat for multiple parameters
  --header NAME=VALUE        Declared non-authentication header parameter
  --timeout SECONDS          HTTP request deadline, default 30; maximum 300
  --bind FILE                Bind a local registry.yaml to this actual Sandbox
  --resource sandbox.NAME    Select one resource when the registry declares several
  --credential API.SCHEME=SOURCE
                             Explicit source: env:VARIABLE or config:server_token
  --alias NAME=API:OPERATION  Local operation alias; repeat as needed

Binding replaces this target's saved contract, credentials references and aliases.
Use global --provider before sandbox to select a Provider. Platform commands such
as abx exec, files, status and delete remain separate from application operations.`;

function supplied(params: Params, name: string): boolean {
  const value = params[name];
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== false;
}

function bodyInput(input?: string | null): unknown {
  if (input === undefined || input === null) return undefined;
  let text = input;
  if (input.startsWith("@")) {
    const file = input.slice(1);
    if (!file || !fs.statSync(file).isFile() || fs.statSync(file).size > 1024 * 1024) throw new UsageError("Body must be a regular JSON file of at most 1 MiB.");
    text = fs.readFileSync(file, "utf8");
  }
  if (Buffer.byteLength(text) > 1024 * 1024) throw new UsageError("JSON request body exceeds 1 MiB.");
  try { return JSON.parse(text); } catch { throw new UsageError("--body requires JSON or @path/to/request.json."); }
}

/** Choose one declared security alternative without reading credentials or downgrading after failure. */
function authenticationHeaders(binding: ApiBinding, api: string, request: PreparedApiRequest): Record<string, string> {
  const authenticated = request.security.filter(requirement => Object.keys(requirement).length > 0);
  const configured = authenticated.filter(requirement => Object.keys(requirement).every(scheme => Object.hasOwn(binding.credentials, `${api}.${scheme}`)));
  if (configured.length > 1) throw new ApplicationError("Several authentication alternatives are configured for this operation. Bind credential references for exactly one alternative.");
  const selected = configured[0];
  if (!selected) {
    if (!request.security.length || request.security.some(requirement => Object.keys(requirement).length === 0)) return {};
    throw new ApplicationError("This operation requires authentication. Bind explicit --credential API.SCHEME=env:VARIABLE or API.SCHEME=config:server_token references.");
  }
  const headers: Record<string, string> = Object.create(null);
  for (const schemeName of Object.keys(selected)) {
    const scheme = request.schemes[schemeName];
    const source = binding.credentials[`${api}.${schemeName}`];
    const value = source === "config:server_token" ? sandboxApiSeams.applicationToken() : /^env:[A-Za-z_][A-Za-z0-9_]*$/.test(source) ? sandboxApiSeams.environment(source.slice(4)) : undefined;
    if (!value || /[\r\n]/.test(value)) throw new ApplicationError("The bound application credential is missing or invalid. Configure its declared source; no alternate identity was attempted.");
    const name = scheme.type === "http" ? "Authorization" : scheme.name!;
    if (Object.keys(headers).some(key => key.toLowerCase() === name.toLowerCase()) || Object.keys(request.headers).some(key => key.toLowerCase() === name.toLowerCase())) throw new ApplicationError("API authentication schemes conflict with application headers.");
    headers[name] = scheme.type === "http" ? `Bearer ${value}` : value;
  }
  return headers;
}

export const sandbox = command("sandbox", {
  automaticHelp: false,
  help: "Inspect and invoke a Sandbox's declared API operations: sandbox TARGET [OPERATION].",
  params: [argument("target", { required: false }), argument("operation", { required: false }),
    option(["--help", "-h"], { is_flag: true }), option("--api"), option("--body"),
    option("--path", { multiple: true }), option("--query", { multiple: true }), option("--header", { multiple: true }),
    option("--timeout", { type: FLOAT, default: 30 }), option("--bind"), option("--resource"),
    option("--credential", { multiple: true }), option("--alias", { multiple: true })],
  callback: handleErrors(async (ctx, params) => {
    const fmt = getFormatter(ctx);
    if (!params.target) { echo(help); if (!params.help) throw new Exit(2); return; }
    const reference = String(params.target);
    if (params.help && params.bind) { echo(help); return; }
    if (params.bind) {
      if (params.operation || ["api", "body", "path", "query", "header"].some(name => supplied(params, name))) throw new UsageError("Binding cannot be combined with an operation or request inputs.");
      const apis = selectResource(loadRegistryApis(String(params.bind)), params.resource ?? undefined);
      const options = bindingOptions(apis, params.credential, params.alias);
      const parsed = apiReference(reference);
      const target = parsed.provider ? { id: parsed.id, provider: parsed.provider } : sandboxTarget(reference), deployment = readDeployment(reference);
      if (deployment && deployment.status !== "ready") throw new ApplicationError("Only a ready deployment can be bound to an API contract.");
      const { id, ...connection } = target;
      const sb = await sandboxApiSeams.connect(id, connection);
      try {
        if (sb.id !== id) throw new ApplicationError("Provider returned a different Sandbox identity.");
        const resolved = captureDeploymentTarget(sb.provider, loadLayeredConfig({ provider: sb.provider, provider_options: target.provider_options ?? cliOptions(), ...target }));
        const binding: ApiBinding = { version: 1, target: { id, ...resolved }, apis, ...options,
          ...(deployment ? { deployment: { name: deployment.name, createdAt: deployment.createdAt } } : {}) };
        saveApiBinding(binding);
        fmt.printData({ target: reference, sandboxId: id, provider: sb.provider, apis: apis.map(api => api.name), status: "bound" });
      } finally { await sb.close(); }
      return;
    }
    if (["credential", "alias", "resource"].some(name => supplied(params, name))) throw new UsageError("--credential, --alias and --resource are binding options; use them with --bind.");
    const binding = readApiBinding(reference);
    if (!params.operation) {
      if (["api", "body", "path", "query", "header"].some(name => supplied(params, name))) throw new UsageError("Request inputs require an operation ID.");
      const description = { target: reference, sandboxId: binding.target.id, operations: describeApiOperations(binding.apis), aliases: binding.aliases };
      if (fmt.use_json) fmt.printData(description); else echo(JSON.stringify(description, null, 2));
      return;
    }
    const selected = boundOperation(binding, String(params.operation), params.api ?? undefined);
    if (params.help) { const description = describeApiOperation(selected); if (fmt.use_json) fmt.printData(description); else echo(JSON.stringify(description, null, 2)); return; }
    requireReadyBinding(binding);
    const request = prepareApiOperation(selected, { body: bodyInput(params.body), path: params.path, query: params.query, header: params.header });
    const timeout = Number(params.timeout);
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300) throw new UsageError("--timeout must be greater than zero and at most 300 seconds.");
    const { id, provider, providerOptions, connection } = binding.target;
    const sb = await sandboxApiSeams.connect(id, { provider, provider_options: providerOptions, ...connection });
    try {
      if (sb.id !== id || sb.provider !== provider) throw new ApplicationError("Provider returned a different Sandbox identity.");
      const endpoint = validateApplicationEndpoint(await sb.network.resolveEndpoint(selected.api.port), id, selected.api.port);
      if (endpoint.provider_id !== provider) throw new ApplicationError("Application endpoint belongs to another Provider.");
      if (endpoint.path_mode !== "prefix") throw new ApplicationError("This endpoint requires operation signing, which this command does not support.");
      const headers = authenticationHeaders(binding, selected.api.name, request);
      const response = await requestOpenApi(endpoint, { ...request, headers: { ...request.headers, ...headers } }, timeout);
      fmt.printData(response);
      if (response.status < 200 || response.status >= 300) throw new Exit(1);
    } finally { await sb.close(); }
  }),
});

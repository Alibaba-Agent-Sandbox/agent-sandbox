/** Target-first operations from a fixed local OpenAPI contract. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
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
import { echo, sys } from "../io.js";
import { applicationToken } from "../template_environment.js";
import { captureDeploymentTarget, readDeployment, sandboxTarget } from "../deployment_store.js";
import { apiReference, bindingOptions, boundOperation, credentialFingerprint, readApiBinding, requireReadyBinding, saveApiBinding, selectResource, type ApiBinding } from "../api_binding.js";
import { apiOperationFlags, describeApiOperation, describeApiOperations, loadRegistryApis, prepareApiOperation, type SelectedApiOperation, type ApiFlag, type PreparedApiRequest } from "../api_contract.js";

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
  --body JSON|@FILE|-        JSON request body, or stdin with - (maximum 1 MiB)
  --output FILE             Save successful response bytes; never overwrite a file
  --path-NAME VALUE          Qualified path parameter (similarly --query-NAME)
  --body-NAME VALUE          Scalar top-level JSON body field
  --NAME VALUE               Short form when the field name is unambiguous
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

const VALUE_OPTIONS = new Set(["api", "body", "output", "path", "query", "header", "timeout", "bind", "resource", "credential", "alias"]);

/** The target terminates framework parsing; only this command interprets its application options. */
function parseTail(params: Params): Array<[string,string]> {
  const words = params.arguments as string[];
  const named: Array<[string,string]> = [];
  for (let i=0;i<words.length;i++) {
    const word=words[i];
    if (word === "--help" || word === "-h") { params.help=true; continue; }
    if (!word.startsWith("-")) {
      if (params.operation) throw new UsageError("Unexpected positional argument; provide application inputs as options.");
      params.operation=word; continue;
    }
    const match=/^(--[a-zA-Z][a-zA-Z0-9_-]*)(?:=(.*))?$/s.exec(word);
    if (!match) throw new UsageError("Use a declared long application option or --help.");
    const flag=match[1], value=match[2] ?? words[++i];
    if (value === undefined || (match[2] === undefined && value.startsWith("--"))) throw new UsageError(`${flag} requires a value.`);
    const name=flag.slice(2);
    if (VALUE_OPTIONS.has(name)) (params[name] as unknown[]).push(value);
    else named.push([flag,value]);
  }
  return named;
}

function naturalInputs(selected: SelectedApiOperation, params: Params, named: Array<[string,string]>): Record<string,unknown> | undefined {
  const flags=apiOperationFlags(selected), body: Record<string,unknown>=Object.create(null);
  for (const [name,raw] of named) {
    const field=flags.find(flag => flag.flag === name);
    if (!field) throw new UsageError(`Unknown or ambiguous option '${name}'. Inspect this operation's --help for qualified options.`);
    if (field.location !== "body") { (params[field.location] as string[]).push(`${field.name}=${raw}`); continue; }
    if (params.body !== undefined) throw new UsageError("Use either --body or individual body field options, not both.");
    if (Object.hasOwn(body,field.name)) throw new UsageError(`Body field '${field.name}' may only be supplied once.`);
    if (field.type === "string") body[field.name]=raw;
    else {
      let value: unknown;
      try { value=JSON.parse(raw); } catch { throw new UsageError(`${name} requires a ${field.type} value.`); }
      if (typeof value !== (field.type === "integer" ? "number" : field.type) || (field.type === "integer" && !Number.isInteger(value))) throw new UsageError(`${name} requires a ${field.type} value.`);
      body[field.name]=value;
    }
  }
  return Object.keys(body).length ? body : undefined;
}

function supplied(params: Params, name: string): boolean {
  const value = params[name];
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== false;
}

async function stdinBodyBytes(): Promise<Uint8Array> {
  // In-process command runners supply a text input; the real CLI reads the original bytes.
  let descriptor: number | undefined;
  try { descriptor = sys.stdin.fileno?.(); } catch { /* In-memory command runner. */ }
  if (descriptor === undefined) return Buffer.from(await sys.stdin.read(1024 * 1024 + 1));
  if (process.stdin.readableEncoding) throw new UsageError("Standard input was already decoded. Supply --body @FILE to preserve the original JSON bytes.");
  const chunks: Buffer[] = [];
  let size=0;
  for await (const chunk of process.stdin) {
    if (typeof chunk === "string") throw new UsageError("Standard input must contain UTF-8 JSON bytes.");
    size += chunk.length;
    if (size > 1024 * 1024) throw new UsageError("JSON request body exceeds 1 MiB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function bodyInput(input?: string | null): Promise<unknown> {
  if (input === undefined || input === null) return undefined;
  let text = input;
  if (input === "-") {
    if (sys.stdin.isatty()) throw new UsageError("--body - requires piped JSON on standard input.");
    const bytes=await stdinBodyBytes();
    try { text = new TextDecoder("utf-8", {fatal:true}).decode(bytes); }
    catch { throw new UsageError("Standard input must be valid UTF-8 JSON."); }
  } else if (input.startsWith("@")) {
    const file = input.slice(1);
    if (!file) throw new UsageError("Body must be a regular JSON file of at most 1 MiB.");
    let fd: number | undefined;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("size");
      const bytes = Buffer.alloc(1024 * 1024 + 1);
      let size = 0, count: number;
      while (size < bytes.length && (count = fs.readSync(fd, bytes, size, bytes.length - size, null))) size += count;
      if (size > 1024 * 1024) throw new Error("size");
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    } catch { throw new UsageError("Body must be a readable regular UTF-8 JSON file of at most 1 MiB."); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  if (Buffer.byteLength(text) > 1024 * 1024) throw new UsageError("JSON request body exceeds 1 MiB.");
  try { return JSON.parse(text); } catch { throw new UsageError("--body requires JSON, @path/to/request.json or - for piped JSON."); }
}

function outputPath(input?: string | null): string | undefined {
  if (input == null) return undefined;
  if (!input || input === "-") throw new UsageError("--output requires a new local file path.");
  const file = path.resolve(input);
  if (fs.existsSync(file)) throw new UsageError("Output file already exists; choose a new --output path.");
  try { if (!fs.statSync(path.dirname(file)).isDirectory()) throw new Error("not a directory"); fs.accessSync(path.dirname(file), fs.constants.W_OK); }
  catch { throw new UsageError("Output directory must exist and be writable."); }
  return file;
}

/** Publish a fully received response without replacing a concurrently created file. */
function saveOutput(file: string, bytes: Uint8Array): void {
  const temporary = path.join(path.dirname(file), `.abx-download-${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(temporary, file);
  } catch { throw new ApplicationError("Response received, but the output file could not be saved. No existing file was overwritten and the request was not retried."); }
  finally { fs.rmSync(temporary, { force: true }); }
}

function printContractHelp(description: Record<string, unknown>, target: string): void {
  const lines: string[] = [];
  if (Array.isArray(description.operations)) {
    lines.push(`Usage: abx sandbox ${target} OPERATION [options]`, "", "Declared operations (not a live availability or authorization check):");
    for (const operation of description.operations as Array<Record<string, unknown>>) {
      const client = operation.client as { supported: boolean; reason?: string };
      lines.push(`  ${operation.operationId} [${operation.api}]  ${operation.summary ?? ""}`,
        `    ${operation.method} ${operation.path}${client.supported ? "" : ` — unsupported: ${client.reason}`}`);
    }
    const aliases = description.aliases as ApiBinding["aliases"];
    for (const [alias, value] of Object.entries(aliases)) lines.push(`  ${alias} → ${value.api}:${value.operation}`);
    lines.push("", `Details: abx sandbox ${target} OPERATION --help`);
  } else {
    const client = description.client as { supported: boolean; reason?: string; response: string };
    lines.push(`${description.operationId} — ${description.summary ?? ""}`, `${description.method} ${description.path}`, "",
      `Client support: ${client.supported ? "supported request contract" : `unsupported: ${client.reason}`}`, client.response);
    if (description.description) lines.push("", String(description.description));
    for (const flag of (description.flags ?? []) as ApiFlag[]) lines.push(`  ${flag.flag} VALUE  ${flag.required ? "required" : "optional"}; ${flag.location}.${flag.name}: ${flag.type}${flag.description ? `; ${flag.description}` : ""}`);
    for (const raw of (description.parameters ?? []) as Array<Record<string, unknown>>) {
      lines.push(`  --${raw.in} ${raw.name}=VALUE  ${raw.required ? "required" : "optional"}; ${raw.description ?? ""}`, `    Schema: ${JSON.stringify(raw.schema)}`);
    }
    if (description.requestBody) lines.push("", "Request body (--body JSON, @FILE or -):", JSON.stringify(description.requestBody, null, 2));
    lines.push("", `Authentication: ${JSON.stringify(description.security)}`, "Responses:", JSON.stringify(description.responses ?? {}, null, 2), "",
      `Usage: abx sandbox ${target} ${description.operationId} [--path NAME=VALUE] [--query NAME=VALUE] [--body @request.json] [--output FILE]`);
  }
  echo(stripVTControlCharacters(lines.join("\n")));
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
    const expected = binding.credentialFingerprints?.[`${api}.${schemeName}`];
    if (expected && credentialFingerprint(value) !== expected) throw new ApplicationError("The application credential changed since this Sandbox was created. Restore its original token, or explicitly bind an env:VARIABLE reference for the token accepted by this service; no application request was sent.");
    const name = scheme.type === "http" ? "Authorization" : scheme.name!;
    if (Object.keys(headers).some(key => key.toLowerCase() === name.toLowerCase()) || Object.keys(request.headers).some(key => key.toLowerCase() === name.toLowerCase())) throw new ApplicationError("API authentication schemes conflict with application headers.");
    headers[name] = scheme.type === "http" ? `Bearer ${value}` : value;
  }
  return headers;
}

export const sandbox = command("sandbox", {
  automaticHelp: false,
  passThroughOptions: true,
  help: "Inspect and invoke a Sandbox's declared API operations: sandbox TARGET [OPERATION].",
  params: [argument("target", { required: false }), argument("arguments", { required: false, nargs: -1 }),
    option(["--help", "-h"], { is_flag: true }), option("--api", { multiple: true }), option("--body", { multiple: true }), option("--output", { multiple: true }),
    option("--path", { multiple: true }), option("--query", { multiple: true }), option("--header", { multiple: true }),
    option("--timeout", { type: FLOAT, multiple: true }), option("--bind", { multiple: true }), option("--resource", { multiple: true }),
    option("--credential", { multiple: true }), option("--alias", { multiple: true })],
  callback: handleErrors(async (ctx, params) => {
    const named = parseTail(params);
    for (const name of ["api", "body", "output", "timeout", "bind", "resource"]) {
      const values = params[name];
      if (Array.isArray(values)) {
        if (values.length > 1) throw new UsageError(`--${name} may only be supplied once.`);
        params[name] = values[0];
      }
    }
    params.timeout ??= 30;
    const fmt = getFormatter(ctx);
    if (!params.target) { echo(help); if (!params.help) throw new Exit(2); return; }
    const reference = String(params.target);
    if (params.help && params.bind) { echo(help); return; }
    if (params.bind) {
      if (params.operation || named.length || ["api", "body", "output", "path", "query", "header"].some(name => supplied(params, name))) throw new UsageError("Binding cannot be combined with an operation or request inputs.");
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
      if (named.length || ["api", "body", "output", "path", "query", "header"].some(name => supplied(params, name))) throw new UsageError("Request inputs require an operation ID.");
      const description = { target: reference, sandboxId: binding.target.id, operations: describeApiOperations(binding.apis), aliases: binding.aliases };
      if (fmt.use_json) fmt.printData(description); else printContractHelp(description, reference);
      return;
    }
    const selected = boundOperation(binding, String(params.operation), params.api ?? undefined);
    if (params.help) { const description = describeApiOperation(selected); if (fmt.use_json) fmt.printData(description); else printContractHelp(description, reference); return; }
    requireReadyBinding(binding);
    const output = outputPath(params.output);
    const fields = naturalInputs(selected, params, named);
    const request = prepareApiOperation(selected, { body: fields ?? await bodyInput(params.body), path: params.path, query: params.query, header: params.header });
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
      const response = await requestOpenApi(endpoint, { ...request, headers: { ...request.headers, ...headers } }, timeout, Boolean(output));
      if (output && response.bytes !== undefined) {
        saveOutput(output, response.bytes);
        fmt.printData({ status: response.status, output, bytes: response.bytes.length });
      } else fmt.printData(response);
      if (response.status < 200 || response.status >= 300) throw new Exit(1);
    } finally { await sb.close(); }
  }),
});

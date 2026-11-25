/** Fixed local contracts for actual Sandbox identities; imports never grant credentials. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApplicationError, digest, record } from "../application/config.js";
import { paths } from "../transport/config_layers.js";
import { cliOptions, cliProvider } from "../providers/selection.js";
import { readDeployment, type Deployment } from "./deployment_store.js";
import { apiSecuritySchemes, describeApiOperations, selectApiOperation, type ApiContract } from "./api_contract.js";

export interface ApiBinding {
  version: 1;
  target: { id: string; provider: string; providerOptions?: Record<string, unknown>; connection?: { api_url?: string; domain?: string } };
  deployment?: { name: string; createdAt: string };
  apis: ApiContract[];
  credentials: Record<string, string>;
  aliases: Record<string, { api: string; operation: string }>;
}

const directory = (): string => path.join(paths.abxDir, "api-bindings");
const identity = (binding: ApiBinding): string => digest(binding.target);
const key = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Split only syntax here: loading a Provider to parse a help target would violate offline help. */
export function apiReference(reference: string): { id: string; provider?: string } {
  const split = reference.indexOf(":");
  if (split < 0) return { id: reference };
  const provider = reference.slice(0, split), id = reference.slice(split + 1);
  if (!/^[a-z][a-z0-9-]*$/.test(provider) || !id) throw new ApplicationError("Use a Sandbox ID, a deployment name or provider:SANDBOX_ID.");
  if (cliProvider() && cliProvider() !== provider) throw new ApplicationError("The target's Provider prefix conflicts with --provider.");
  return { id, provider };
}

export function bindingOptions(apis: ApiContract[], credentialPairs: string[], aliasPairs: string[]): Pick<ApiBinding, "credentials" | "aliases"> {
  const credentials: Record<string, string> = Object.create(null);
  const aliases: ApiBinding["aliases"] = Object.create(null);
  for (const pair of credentialPairs) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_.-]*)=(env:[A-Za-z_][A-Za-z0-9_]*|config:server_token)$/.exec(pair);
    if (!match) throw new ApplicationError("Use --credential API.SCHEME=env:VARIABLE or API.SCHEME=config:server_token. Credential values are never stored here.");
    const [, apiName, scheme, source] = match;
    const api = apis.find(item => item.name === apiName);
    if (!api || !Object.hasOwn(apiSecuritySchemes(api), scheme)) throw new ApplicationError("Credential reference names an undeclared API security scheme.");
    const name = `${apiName}.${scheme}`;
    if (Object.hasOwn(credentials, name)) throw new ApplicationError("Duplicate credential reference.");
    credentials[name] = source;
  }
  for (const pair of aliasPairs) {
    const match = /^([^=]+)=([^:]+):(.+)$/.exec(pair);
    if (!match || !key.test(match[1])) throw new ApplicationError("Use --alias NAME=API:OPERATION_ID; alias names start with a letter and contain letters, digits, underscores or hyphens.");
    const [, alias, api, operation] = match;
    if (Object.hasOwn(aliases, alias)) throw new ApplicationError("Duplicate operation alias.");
    selectApiOperation(apis, operation, api);
    if (describeApiOperations(apis).some(operation => operation.operationId === alias)) throw new ApplicationError("An alias cannot shadow an operationId.");
    aliases[alias] = { api, operation };
  }
  return { credentials, aliases };
}

export function selectResource(apis: ApiContract[], resource?: string): ApiContract[] {
  const resources = new Set(apis.map(api => api.resource));
  if (!resource && resources.size !== 1) throw new ApplicationError("This registry describes multiple resources. Select one with --resource sandbox.NAME.");
  const selected = apis.filter(api => api.resource === (resource ?? [...resources][0]));
  if (!selected.length) throw new ApplicationError("No APIs are declared for the selected Sandbox resource.");
  return selected;
}

export function saveApiBinding(binding: ApiBinding): void {
  if (Buffer.byteLength(JSON.stringify(binding)) > 8 * 1024 * 1024) throw new ApplicationError("API binding exceeds 8 MiB.");
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const file = path.join(directory(), `${identity(binding)}.json`), temporary = `${file}.${randomUUID()}.tmp`;
  if (!binding.deployment && fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, "utf8")) as ApiBinding;
    if (previous.version === 1 && previous.deployment && identity(previous) === identity(binding)) binding = { ...binding, deployment: previous.deployment };
  }
  const handle = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(handle, JSON.stringify(binding)); fs.fsyncSync(handle); }
  finally { fs.closeSync(handle); }
  try { fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}

/** Local-only resolution: no Provider loading, token resolution or network access. */
export function readApiBinding(reference: string): ApiBinding {
  const parsed = apiReference(reference);
  const deployment = readDeployment(reference);
  if (deployment && deployment.kind !== "sandbox") throw new ApplicationError("This name refers to a Serving deployment, not a Sandbox.");
  const records: ApiBinding[] = fs.existsSync(directory()) ? fs.readdirSync(directory()).filter(file => /^[a-f0-9]{64}\.json$/.test(file)).map(file => {
    const absolute = path.join(directory(), file);
    if (fs.statSync(absolute).size > 8 * 1024 * 1024) throw new ApplicationError("Stored API binding exceeds the supported size.");
    const value = JSON.parse(fs.readFileSync(absolute, "utf8")) as ApiBinding;
    if (value.version !== 1 || !record(value.target) || !Array.isArray(value.apis) || !record(value.credentials) || !record(value.aliases) || `${identity(value)}.json` !== file)
      throw new ApplicationError("Invalid local API binding. Bind its registry again.");
    return value;
  }) : [];
  const matches = records.filter(value => deployment ? value.deployment?.name === reference && value.target.id === deployment.sandboxId && value.deployment.createdAt === deployment.createdAt : value.target.id === parsed.id);
  const provider = parsed.provider ?? cliProvider();
  const selected = provider ? matches.filter(value => value.target.provider === provider) : matches;
  if (selected.length !== 1) throw new ApplicationError(selected.length ? "Ambiguous Sandbox binding. Select its Provider before the sandbox command." : "No API contract is bound to this target. Use abx sandbox TARGET --bind ./registry.yaml first.");
  const binding = selected[0];
  if (deployment && (deployment.sandboxId !== binding.target.id || deployment.provider !== binding.target.provider || deployment.createdAt !== binding.deployment?.createdAt))
    throw new ApplicationError("This deployment now refers to another Sandbox. Bind its registry again.");
  for (const [name, value] of Object.entries(cliOptions())) {
    if (binding.target.providerOptions?.[name] !== value) throw new ApplicationError("Provider overrides cannot redirect a bound Sandbox. Configure credentials through config or environment variables.");
  }
  for (const api of binding.apis) if (digest(api.document) !== api.digest) throw new ApplicationError("The stored API contract changed. Bind its registry again.");
  return binding;
}

export function requireReadyBinding(binding: ApiBinding): void {
  if (!binding.deployment) return;
  const current: Deployment | undefined = readDeployment(binding.deployment.name);
  if (!current || current.status !== "ready" || current.createdAt !== binding.deployment.createdAt || current.sandboxId !== binding.target.id || current.provider !== binding.target.provider)
    throw new ApplicationError("The bound deployment is not ready or its Sandbox changed. Inspect its status before invoking operations.");
}

export function boundOperation(binding: ApiBinding, operation: string, api?: string) {
  const alias = Object.hasOwn(binding.aliases, operation) ? binding.aliases[operation] : undefined;
  if (alias && api && alias.api !== api) throw new ApplicationError("The selected API conflicts with the operation alias.");
  return selectApiOperation(binding.apis, alias?.operation ?? operation, alias?.api ?? api);
}

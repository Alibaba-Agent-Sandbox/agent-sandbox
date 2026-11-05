/** Explicit local binding resolution. Resolved values never enter plans or receipts. */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { ApplicationError, record } from "./config.js";
import type { ManagedApplication, Role } from "./types.js";
import { paths } from "../transport/config_layers.js";

export interface CredentialSnapshot { AccountID: string; AccessKeyID: string; AccessKeySecret: string; SecurityToken?: string }
export interface ResolvedBindings {
  databaseUrl: string;
  vpcConfig?: { vpcId: string; vSwitchIds: string[]; securityGroupId: string };
  databaseCa?: string;
  auth: Record<string, unknown>;
  model: { apiKey: string; baseUrl: string; model: string; adapter: "codex" | "qwen-code" };
  provider: { provider: "alicloud-express"; apiKey: string; baseUrl: string; domain: string; region: string };
  internal: { token: string; roleArn?: string };
  ingress: { kind: "function-alias" | "custom-domain"; aliasName: string; allowTestDomain?: boolean; functionName?: string; domainName?: string; protocol?: "HTTPS"; path?: string };
  credentialsFile?: string;
}
export interface BindingOptions {
  scope?: { applicationId: string; accountId: string; region: string };
  mode?: "initial-apply" | "existing";
  credentialDirectory?: string;
}
/** Only explicit generate bindings create this narrow app credential store. */
function localCredentials(options: BindingOptions, business: boolean, internal: boolean): { businessKey?: string; internalToken?: string; file: string } {
  if (!options.scope || !options.mode) throw new ApplicationError("Generated application credentials are prepared only during explicit apply.");
  const directory = options.credentialDirectory ?? path.join(paths.abxDir, "managed-auth");
  const scope = createHash("sha256").update(JSON.stringify(options.scope)).digest("hex").slice(0, 32);
  const file = path.join(directory, `${scope}.json`);
  const read = (): { businessKey?: string; internalToken?: string; file: string } => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) throw new ApplicationError("The saved application credential file must remain private.");
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!record(value) || value.version !== 1 || JSON.stringify(value.scope) !== JSON.stringify(options.scope) || (business && (typeof value.businessKey !== "string" || value.businessKey.length < 32)) || (internal && (typeof value.internalToken !== "string" || value.internalToken.length < 32))) throw new ApplicationError("Saved application credentials are incomplete; restore them instead of rotating an active application implicitly.");
    return { ...value, file } as { businessKey?: string; internalToken?: string; file: string };
  };
  if (fs.existsSync(file)) return read();
  if (options.mode !== "initial-apply") throw new ApplicationError("Saved application credentials are missing; restore the prior store or provide explicit bindings before recovery.");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(handle, JSON.stringify({ version: 1, scope: options.scope,
      ...(business ? { businessKey: randomBytes(32).toString("base64url") } : {}),
      ...(internal ? { internalToken: randomBytes(32).toString("base64url") } : {}) }) + "\n");
    fs.fsyncSync(handle);
  } finally { fs.closeSync(handle); }
  try { fs.linkSync(temporary, file); } catch (error) { if (!record(error) || error.code !== "EEXIST") throw error; }
  finally { fs.rmSync(temporary, { force: true }); }
  if (process.platform !== "win32") { const folder = fs.openSync(directory, "r"); try { fs.fsyncSync(folder); } finally { fs.closeSync(folder); } }
  return read();
}
function fromEnvironment(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !process.env[name]) throw new ApplicationError("A required binding environment reference is missing.");
  return process.env[name]!;
}
function expand(value: unknown): unknown {
  if (record(value) && Object.keys(value).length === 1 && typeof value.env === "string") return fromEnvironment(value.env);
  if (Array.isArray(value)) return value.map(expand);
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
  return value;
}
function asJson(value: string): unknown { try { return JSON.parse(value); } catch { return value; } }
/** Binding references resolve only from an explicitly chosen file or named environment variable. */
export function resolveBindings(app: ManagedApplication, file?: string, options: BindingOptions = {}): ResolvedBindings {
  let source: Record<string, unknown> = {};
  if (file) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) throw new ApplicationError("Binding input must be a private regular JSON file of at most 1 MiB.");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!record(parsed)) throw new ApplicationError("Binding input must be a JSON object.");
    source = parsed;
  }
  const get = (logical: string): unknown => {
    const binding = app.bindings[logical];
    if (!binding) throw new ApplicationError(`Required application binding '${logical}' is missing.`);
    const value = binding.reference.startsWith("env:") ? asJson(fromEnvironment(binding.reference.slice(4))) : Object.hasOwn(source, binding.reference)
      ? source[binding.reference] : asJson(fromEnvironment(`ABX_APP_BINDING_${binding.reference.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`));
    return expand(value);
  };
  const state = get(app.state.bindingRef), rawAuth = get("clientAuth"), model = get("model"), provider = get("sandboxAccess"), rawInternal = get("internalAuth"), ingress = get(app.deployment.ingressBindingRef);
  const generateBusiness = record(rawAuth) && rawAuth.generate === true, generateInternal = record(rawInternal) && rawInternal.generate === true;
  const saved = generateBusiness || generateInternal ? localCredentials(options, generateBusiness, generateInternal) : undefined;
  const auth = generateBusiness ? { tokens: [{ sha256: businessTokenDigest(saved!.businessKey!), owner: String(rawAuth.owner ?? "default"), scopes: ["agents:read", "agents:write"] }] } : rawAuth;
  const internal = generateInternal ? { token: saved!.internalToken, ...(rawInternal.roleArn ? { roleArn: rawInternal.roleArn } : {}) } : rawInternal;
  const databaseUrl = typeof state === "string" ? state : record(state) ? state.databaseUrl : undefined;
  if (typeof databaseUrl !== "string" || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new ApplicationError("The FC profile requires an explicit PostgreSQL binding.");
  if (record(state) && Object.keys(state).some(key => !["databaseUrl", "vpcConfig", "databaseCa"].includes(key))) throw new ApplicationError("State binding accepts only databaseUrl, databaseCa and the explicit native vpcConfig.");
  let ca: unknown = record(state) ? state.databaseCa : undefined;
  if (record(ca) && Object.keys(ca).length === 1 && typeof ca.file === "string") {
    const caFile = path.resolve(file ? path.dirname(fs.realpathSync(file)) : process.cwd(), ca.file), stat = fs.lstatSync(caFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new ApplicationError("Database CA input must be a regular PEM file of at most 64 KiB.");
    ca = fs.readFileSync(caFile, "utf8");
  }
  if (ca !== undefined) {
    if (typeof ca !== "string" || Buffer.byteLength(ca) > 65536) throw new ApplicationError("Database CA binding must contain a bounded certificate PEM chain.");
    const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    if (!certificates.length || certificates.length > 8 || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) throw new ApplicationError("Database CA input must contain certificate PEM blocks only.");
    try { certificates.forEach(value => new X509Certificate(value)); } catch { throw new ApplicationError("Database CA input contains an invalid X.509 certificate."); }
    ca = certificates.join("\n") + "\n";
  }
  const vpc = record(state) ? state.vpcConfig : undefined;
  if (vpc !== undefined && (!record(vpc) || Object.keys(vpc).sort().join(",") !== "securityGroupId,vSwitchIds,vpcId"
    || !/^vpc-[a-zA-Z0-9]+$/.test(String(vpc.vpcId)) || !/^sg-[a-zA-Z0-9]+$/.test(String(vpc.securityGroupId))
    || !Array.isArray(vpc.vSwitchIds) || !vpc.vSwitchIds.length || vpc.vSwitchIds.length > 16 || new Set(vpc.vSwitchIds).size !== vpc.vSwitchIds.length
    || vpc.vSwitchIds.some(value => typeof value !== "string" || !/^vsw-[a-zA-Z0-9]+$/.test(value)))) throw new ApplicationError("State vpcConfig must contain only an existing VPC, distinct vSwitchIds and securityGroupId.");
  if (!record(auth) || !Array.isArray(auth.tokens) || !auth.tokens.length || auth.tokens.some(value => !record(value) || !/^[a-f0-9]{64}$/.test(String(value.sha256)) || typeof value.owner !== "string" || !Array.isArray(value.scopes))) throw new ApplicationError("Client authentication binding must contain token digests, owners and scopes.");
  if (!record(model) || typeof model.apiKey !== "string" || !model.apiKey || typeof model.baseUrl !== "string" || !model.baseUrl.startsWith("https://") || typeof model.model !== "string" || !model.model || !["codex", "qwen-code"].includes(String(model.adapter))) throw new ApplicationError("Model binding must supply one explicit supported adapter/model/HTTPS endpoint/key configuration.");
  if (!record(provider) || provider.provider !== "alicloud-express" || typeof provider.apiKey !== "string" || !provider.apiKey || typeof provider.baseUrl !== "string" || !provider.baseUrl.startsWith("https://") || typeof provider.domain !== "string" || !provider.domain || typeof provider.region !== "string") throw new ApplicationError("Sandbox binding must provide explicit Express API, domain, region and authentication.");
  if (!record(internal) || typeof internal.token !== "string" || internal.token.length < 32 || (internal.roleArn !== undefined && (typeof internal.roleArn !== "string" || !/^acs:ram::\d+:role\//.test(internal.roleArn)))) throw new ApplicationError("Internal binding requires a separate random token and a valid optional function role.");
  if (!record(ingress) || !["function-alias", "custom-domain"].includes(String(ingress.kind)) || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(String(ingress.aliasName ?? "prod"))) throw new ApplicationError("Ingress binding must select an explicit managed alias or custom domain.");
  if (ingress.kind === "function-alias" && ingress.allowTestDomain !== true) throw new ApplicationError("FC built-in domains are test endpoints; explicitly acknowledge allowTestDomain or configure a production custom domain.");
  if (ingress.kind === "custom-domain" && (typeof ingress.domainName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(ingress.domainName) || ingress.protocol !== "HTTPS" || (ingress.path !== undefined && ingress.path !== "/"))) throw new ApplicationError("Custom ingress requires an existing HTTPS root-domain binding.");
  return { databaseUrl, ...(vpc ? { vpcConfig: vpc } : {}), ...(ca ? { databaseCa: ca } : {}), auth, model, provider, internal, ingress: { ...ingress, aliasName: String(ingress.aliasName ?? "prod") }, ...(saved ? { credentialsFile: saved.file } : {}) } as ResolvedBindings;
}
/** Only compile-time configuration and hashes may be inspected without exposing credentials. */
export function bootstrapEnvironment(app: ManagedApplication, binding: ResolvedBindings, role: Role, config: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = { ABX_MANAGED_CONFIG_JSON: JSON.stringify(config), ABX_MANAGED_DATABASE_URL: binding.databaseUrl,
    ABX_MANAGED_INTERNAL_TOKEN: binding.internal.token, ABX_MANAGED_FC_ENDPOINT: `fcv3.${app.deployment.region}.aliyuncs.com` };
  if (binding.databaseCa) env.ABX_MANAGED_DATABASE_CA_PEM = binding.databaseCa;
  if (role === "gateway") env.ABX_MANAGED_AUTH_JSON = JSON.stringify(binding.auth);
  else env.ABX_MANAGED_PROVIDER_CONFIG_JSON = JSON.stringify(binding.provider);
  if (role === "worker") env.ABX_MANAGED_MODEL_CONFIG_JSON = JSON.stringify(binding.model);
  return env;
}
/** Stable digest used for binding-change detection; no secret or password-derived hash is persisted. */
export function publicBindingIdentity(binding: ResolvedBindings): Record<string, unknown> {
  return { models: { [binding.model.model]: binding.model.adapter }, provider: binding.provider.provider,
    ingress: { kind: binding.ingress.kind, aliasName: binding.ingress.aliasName, functionName: binding.ingress.functionName ?? null, domainName: binding.ingress.domainName ?? null } };
}
export function businessTokenDigest(token: string): string { return createHash("sha256").update(token).digest("hex"); }
/** A quick non-secret routing check; the durable database identity is the authoritative ledger pin. */
export function stateConnectionIdentity(databaseUrl: string): string {
  let uri: URL; try { uri = new URL(databaseUrl); } catch { throw new ApplicationError("State binding requires one explicit PostgreSQL URI."); }
  const permitted = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "ssl_min_protocol_version", "ssl_max_protocol_version", "connect_timeout", "application_name", "channel_binding"]);
  if (!["postgres:", "postgresql:"].includes(uri.protocol) || !uri.hostname || uri.hostname.includes(",") || !uri.username || !uri.pathname || uri.pathname === "/" || uri.hash
    || [...uri.searchParams.keys()].some(key => !permitted.has(key))) throw new ApplicationError("Managed state requires a single explicit host/database/user URI; routing/schema overrides and unknown query options are unsupported.");
  return createHash("sha256").update(JSON.stringify({ host: uri.hostname.toLowerCase(), port: uri.port || "5432", database: decodeURIComponent(uri.pathname.slice(1)), user: decodeURIComponent(uri.username) })).digest("hex");
}

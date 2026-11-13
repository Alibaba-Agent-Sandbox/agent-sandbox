/** Official FC models/transport with an immutable credential snapshot and no implicit write retries. */
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { ApplicationError, record } from "../../../application/config.js";
import { loadLayeredConfig } from "../../../transport/config_layers.js";
import type { CredentialSnapshot } from "../../../application/bindings.js";
import type { FunctionReceipt, Role } from "../../../application/types.js";

const require = createRequire(import.meta.url);
type Model = new (input?: Record<string, unknown>) => unknown;
interface Response { statusCode?: number; body?: unknown }
type Client = Record<string, (...args: unknown[]) => Promise<Response>>;
interface Sdk { default: new (config: unknown) => Client; [key: string]: Model | (new (config: unknown) => Client) }
const sdk = require("@alicloud/fc20230330") as Sdk;
const core = require("@alicloud/openapi-core") as { $OpenApiUtil: { Config: Model } };
const dara = require("@darabonba/typescript") as { RuntimeOptions: Model };
const runtime = (): unknown => new dara.RuntimeOptions({ autoretry: false, maxAttempts: 1, readTimeout: 30000, connectTimeout: 10000 });
const model = (name: string, value: Record<string, unknown> = {}): unknown => new sdk[name](value);

/** Resolve a named Devs profile, or explicitly select current abx/cloud environment credentials. */
export async function resolveDeployCredentials(accessRef: string): Promise<CredentialSnapshot> {
  let raw: Record<string, unknown>;
  try {
    if (accessRef === "abx") {
      const config = loadLayeredConfig({ provider: "alicloud-express" });
      raw = { AccessKeyID: config.access_key_id, AccessKeySecret: config.access_key_secret, SecurityToken: config.provider_options.security_token };
    } else if (accessRef === "env") raw = { AccessKeyID: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || process.env.ALICLOUD_ACCESS_KEY_ID,
      AccessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || process.env.ALICLOUD_ACCESS_KEY_SECRET,
      SecurityToken: process.env.ALIBABA_CLOUD_SECURITY_TOKEN || process.env.ALICLOUD_SECURITY_TOKEN };
    else {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(accessRef)) throw new Error("Invalid reference");
      const loaded = require("@serverless-devs/credential") as { default: new (input: unknown) => { get(name: string): Promise<{ credential: Record<string, unknown> }> } };
      const reader = new loaded.default({ logger: { debug(): void {}, info(): void {}, warn(): void {}, error(): void {} } });
      raw = (await reader.get(accessRef)).credential;
    }
    if (typeof raw.AccessKeyID !== "string" || !raw.AccessKeyID || typeof raw.AccessKeySecret !== "string" || !raw.AccessKeySecret || (raw.SecurityToken !== undefined && typeof raw.SecurityToken !== "string")) throw new Error("Missing credential");
    const sts = require("@alicloud/sts20150401") as { default: new (config: unknown) => { getCallerIdentityWithOptions(runtime: unknown): Promise<Response> } };
    const client = new sts.default(new core.$OpenApiUtil.Config({ accessKeyId: raw.AccessKeyID, accessKeySecret: raw.AccessKeySecret,
      ...(raw.SecurityToken ? { securityToken: raw.SecurityToken } : {}), endpoint: "sts.cn-hangzhou.aliyuncs.com", protocol: "https", readTimeout: 15000, connectTimeout: 10000 }));
    const response = await client.getCallerIdentityWithOptions(runtime());
    const account = record(response.body) ? response.body.accountId : undefined;
    if (typeof account !== "string" || !/^\d+$/.test(account)) throw new Error("Missing caller account");
    if (raw.AccountID && raw.AccountID !== account) throw new Error("Profile account differs from STS");
    return { AccountID: account, AccessKeyID: raw.AccessKeyID, AccessKeySecret: raw.AccessKeySecret, ...(raw.SecurityToken ? { SecurityToken: raw.SecurityToken } : {}) } as CredentialSnapshot;
  } catch { throw new ApplicationError("Could not resolve and verify the selected deployment identity; no credentials or raw cloud output were retained."); }
}
/** Sign exactly the same canonical role/body envelope as the managed Python control plane. */
export function signInvocation(role: "worker" | "dispatcher", payload: Record<string, unknown>, token: string): Record<string, unknown> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : record(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
  const body = { version: 1, role, payload };
  return { ...body, signature: createHmac("sha256", token).update(JSON.stringify(canonical(body))).digest("hex") };
}
export interface FcTransport {
  accountId: string;
  describeFunction(name: string): Promise<Record<string, unknown> | null>;
  createFunction(props: Record<string, unknown>): Promise<Record<string, unknown>>;
  describeAlias(name: string, alias: string): Promise<string | null>;
  setAlias(name: string, alias: string, version: string, expected: string | null): Promise<void>;
  publishVersion(name: string, revision: string): Promise<string>;
  createHttpTrigger(name: string, trigger: string, qualifier: string): Promise<string>;
  describeHttpTrigger(name: string, trigger: string, qualifier: string): Promise<string | null>;
  deleteTrigger(name: string, trigger: string): Promise<void>;
  deleteAlias(name: string, alias: string): Promise<void>;
  configureWorker(name: string): Promise<void>;
  configureTimer(name: string, token: string, enabled: boolean): Promise<void>;
  invokeControl(name: string, envelope: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteFunction(name: string): Promise<void>;
  deleteVersion(name: string, version: string): Promise<void>;
  hasVersion(name: string, version: string): Promise<boolean>;
  publishDomain(domain: string, name: string, qualifier: string): Promise<void>;
}
function absent(error: unknown, code: string): boolean { return record(error) && error.statusCode === 404 && error.code === code; }
function classification(error: unknown): string {
  if (!record(error)) return "unclassified";
  const code = typeof error.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(error.code) ? error.code : error instanceof TypeError ? "TypeError" : "unclassified";
  return `${Number.isInteger(error.statusCode) ? `HTTP ${Number(error.statusCode)}, ` : ""}${code}`;
}
function objectBody(response: Response): Record<string, unknown> {
  if (!response.statusCode || response.statusCode < 200 || response.statusCode > 299 || !record(response.body)) throw new ApplicationError("Cloud response omitted a valid resource identity.");
  return response.body;
}
/** Compare native creation identity; an existing same-name replacement is never adopted. */
export function verifyFunction(body: Record<string, unknown>, account: string, region: string, name: string, previous?: FunctionReceipt): void {
  const arn = /^acs:fc:([^:]+):(\d+):functions\/([^:]+)(?::LATEST)?$/.exec(String(body.functionArn));
  if (body.functionName !== name || !arn || arn[1] !== region || arn[2] !== account || arn[3] !== name || typeof body.functionId !== "string" || typeof body.createdTime !== "string") throw new ApplicationError("FC returned an unexpected or incomplete native function identity.");
  if (previous && (previous.functionArn !== body.functionArn || previous.functionId !== body.functionId || previous.createdTime !== body.createdTime)) throw new ApplicationError("Native function identity changed; refusing to adopt or modify a replacement.");
}
/** Create one transport from explicit region and a single verified AK/STS snapshot. */
export function nativeFcEndpoint(account: string, region: string, override?: string): string {
  const value = region === "cn-heyuan-acdr-1" ? `${account}.${region}-internal.fc.aliyuncs.com` : override || `fcv3.${region}.aliyuncs.com`;
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new ApplicationError("Invalid FC API endpoint.");
  return url.origin;
}
export function createFcTransport(credential: CredentialSnapshot, region: string, endpoint?: string): FcTransport {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(region)) throw new ApplicationError("Invalid FC region.");
  const target = new URL(nativeFcEndpoint(credential.AccountID, region, endpoint));
  const client = new sdk.default(new core.$OpenApiUtil.Config({ accessKeyId: credential.AccessKeyID, accessKeySecret: credential.AccessKeySecret,
    ...(credential.SecurityToken ? { securityToken: credential.SecurityToken } : {}), endpoint: target.host, protocol: target.protocol.slice(0, -1), readTimeout: 30000, connectTimeout: 10000 }));
  const call = (method: string, args: unknown[]): Promise<Response> => client[`${method}WithOptions`](...args, {}, runtime());
  const describeFunction = async (name: string): Promise<Record<string, unknown> | null> => {
    try { const value = objectBody(await call("getFunction", [name, model("GetFunctionRequest", { qualifier: "LATEST" })])); verifyFunction(value, credential.AccountID, region, name); return value; }
    catch (error) { if (absent(error, "FunctionNotFound")) return null; throw new ApplicationError("FC function inspection failed; absence was not established."); }
  };
  const describeAlias = async (name: string, alias: string): Promise<string | null> => {
    try { const value = objectBody(await call("getAlias", [name, alias])); if (typeof value.versionId !== "string") throw new Error("Version omitted"); return value.versionId; }
    catch (error) { if (absent(error, "AliasNotFound")) return null; throw new ApplicationError("FC alias state could not be confirmed."); }
  };
  const hasVersion = async (name: string, version: string): Promise<boolean> => {
    try { objectBody(await call("getFunction", [name, model("GetFunctionRequest", { qualifier: version })])); return true; }
    catch (error) { if (absent(error, "VersionNotFound") || absent(error, "FunctionNotFound")) return false; throw new ApplicationError("Function version existence could not be confirmed."); }
  };
  return {
    accountId: credential.AccountID, describeFunction, describeAlias, hasVersion,
    async createFunction(props) {
      try { const value = objectBody(await call("createFunction", [model("CreateFunctionRequest", { body: model("CreateFunctionInput", props) })])); verifyFunction(value, credential.AccountID, region, String(props.functionName)); return value; }
      catch (error) { throw new ApplicationError(`FC create-only operation failed or its outcome is unknown (${classification(error)}); reconcile the saved intent.`); }
    },
    async publishVersion(name, revision) {
      try { const body = objectBody(await call("publishFunctionVersion", [name, model("PublishFunctionVersionRequest", { body: model("PublishVersionInput", { description: `Agent Sandbox revision ${revision}` }) })])); if (typeof body.versionId !== "string") throw new Error("Version omitted"); return body.versionId; }
      catch { throw new ApplicationError("FC version publication failed or is unconfirmed."); }
    },
    async setAlias(name, alias, version, expected) {
      if (await describeAlias(name, alias) !== expected) throw new ApplicationError("FC alias changed since planning; refuse to overwrite concurrent publication.");
      try {
        if (expected === null) await call("createAlias", [name, model("CreateAliasRequest", { body: model("CreateAliasInput", { aliasName: alias, versionId: version }) })]);
        else await call("updateAlias", [name, alias, model("UpdateAliasRequest", { body: model("UpdateAliasInput", { versionId: version }) })]);
      } catch { throw new ApplicationError("Alias cutover outcome is unconfirmed; reconcile without replaying publication."); }
      if (await describeAlias(name, alias) !== version) throw new ApplicationError("Alias cutover was not confirmed.");
    },
    async createHttpTrigger(name, trigger, qualifier) {
      try {
        const body = objectBody(await call("createTrigger", [name, model("CreateTriggerRequest", { body: model("CreateTriggerInput", { triggerName: trigger, triggerType: "http", qualifier,
          triggerConfig: JSON.stringify({ authType: "anonymous", methods: ["GET", "POST", "DELETE", "HEAD", "OPTIONS"], disableURLInternet: false }) }) })]));
        const endpoint = record(body.httpTrigger) ? body.httpTrigger.urlInternet : undefined;
        if (typeof endpoint !== "string" || !/^https:\/\/[^/?#@]+(?:\/)?$/.test(endpoint)) throw new Error("Endpoint omitted");
        return endpoint.replace(/\/$/, "");
      } catch { throw new ApplicationError("HTTP trigger creation failed or endpoint identity is unavailable."); }
    },
    async describeHttpTrigger(name, trigger, qualifier) {
      try {
        const body = objectBody(await call("getTrigger", [name, trigger]));
        if (body.qualifier !== qualifier || body.triggerType !== "http") throw new Error("Different trigger binding");
        const endpoint = record(body.httpTrigger) ? body.httpTrigger.urlInternet : undefined;
        if (typeof endpoint !== "string" || !/^https:\/\/[^/?#@]+(?:\/)?$/.test(endpoint)) throw new Error("Endpoint omitted");
        return endpoint.replace(/\/$/, "");
      } catch (error) { if (absent(error, "TriggerNotFound")) return null; throw new ApplicationError("HTTP trigger identity could not be confirmed."); }
    },
    async deleteTrigger(name, trigger) {
      try { await call("deleteTrigger", [name, trigger]); }
      catch (error) { if (!absent(error, "TriggerNotFound")) throw new ApplicationError("Trigger deletion is unconfirmed."); }
    },
    async deleteAlias(name, alias) {
      try { await call("deleteAlias", [name, alias]); }
      catch (error) { if (!absent(error, "AliasNotFound")) throw new ApplicationError("Alias deletion is unconfirmed."); }
      if (await describeAlias(name, alias) !== null) throw new ApplicationError("Alias absence was not confirmed.");
    },
    async configureWorker(name) {
      try { await call("putAsyncInvokeConfig", [name, model("PutAsyncInvokeConfigRequest", { qualifier: "LATEST", body: model("PutAsyncInvokeConfigInput", { asyncTask: true, maxAsyncRetryAttempts: 0, maxAsyncEventAgeInSeconds: 3600 }) })]); }
      catch { throw new ApplicationError("Worker asynchronous task configuration failed."); }
    },
    async configureTimer(name, token, enabled) {
      const triggerConfig = JSON.stringify({ cronExpression: "@every 1m", enable: enabled, payload: JSON.stringify(signInvocation("dispatcher", { limit: 20 }, token)) });
      try {
        let exists = false;
        try { await call("getTrigger", [name, "abx-dispatch"]); exists = true; } catch (error) { if (!absent(error, "TriggerNotFound")) throw error; }
        if (exists) await call("updateTrigger", [name, "abx-dispatch", model("UpdateTriggerRequest", { body: model("UpdateTriggerInput", { qualifier: "LATEST", triggerConfig }) })]);
        else await call("createTrigger", [name, model("CreateTriggerRequest", { body: model("CreateTriggerInput", { triggerName: "abx-dispatch", triggerType: "timer", qualifier: "LATEST", triggerConfig }) })]);
      } catch { throw new ApplicationError("Dispatcher timer configuration is unconfirmed."); }
    },
    async invokeControl(name, envelope) {
      try {
        const response = await client.invokeFunctionWithOptions(name, model("InvokeFunctionRequest", { qualifier: "LATEST", body: Readable.from([Buffer.from(JSON.stringify(envelope), "utf8")]) }), model("InvokeFunctionHeaders", { xFcInvocationType: "Sync", xFcLogType: "None" }), runtime());
        if (response.statusCode !== 200 || !response.body) throw new Error("Invocation failed");
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const part of response.body as AsyncIterable<Buffer>) { bytes += part.length; if (bytes > 65536) throw new Error("Output limit"); chunks.push(Buffer.from(part)); }
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!record(value) || ["errorType", "ErrorType", "errorMessage", "ErrorMessage", "error", "Error"].some(key => Object.hasOwn(value, key))) throw new Error("Invalid output");
        return value;
      } catch { throw new ApplicationError("Private invocation failed or returned an invalid bounded result."); }
    },
    async deleteVersion(name, version) {
      try { await call("deleteFunctionVersion", [name, version]); }
      catch (error) { if (!absent(error, "VersionNotFound")) throw new ApplicationError("Function version deletion is unconfirmed."); }
      if (await hasVersion(name, version)) throw new ApplicationError("Function version absence was not confirmed.");
    },
    async deleteFunction(name) {
      try { await call("deleteFunction", [name]); }
      catch (error) { if (!absent(error, "FunctionNotFound")) throw new ApplicationError("Function deletion is unconfirmed."); }
      if (await describeFunction(name) !== null) throw new ApplicationError("Function absence was not independently confirmed.");
    },
    async publishDomain(domain, name, qualifier) {
      try {
        const existing = objectBody(await call("getCustomDomain", [domain]));
        const route = record(existing.routeConfig) && Array.isArray(existing.routeConfig.routes) ? existing.routeConfig.routes : null;
        if (!route || route.length > 1 || route.some(item => !record(item) || item.path !== "/*" || item.functionName !== name)) throw new ApplicationError("Domain is not an exclusive existing root route for this owned Gateway.");
        await call("updateCustomDomain", [domain, model("UpdateCustomDomainRequest", { body: model("UpdateCustomDomainInput", { routeConfig: model("RouteConfig", { routes: [model("PathConfig", { path: "/*", functionName: name, qualifier, methods: ["GET", "POST", "DELETE", "HEAD", "OPTIONS"] })] }) }) })]);
      } catch { throw new ApplicationError("Existing custom-domain route publication is unconfirmed; its previous configuration was not replaced blindly."); }
    },
  };
}
/** Identity-only receipt, never the raw function/environment response. */
export function functionReceipt(body: Record<string, unknown>, role: Role, image: string, revision: string, ownership: "created" | "retained"): FunctionReceipt {
  return { role, functionName: String(body.functionName), functionArn: String(body.functionArn), functionId: String(body.functionId), createdTime: String(body.createdTime), image, revision, ownership };
}

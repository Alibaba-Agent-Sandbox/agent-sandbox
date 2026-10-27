/** Provider-owned, durable API-key preparation using the official credential-resource API. */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { AuthenticationError, InvalidAPIKeyError } from "../../models/errors.js";
import { ProviderConfigError, ProviderProtocolError, ProviderTrustError } from "../../models/provider_errors.js";
import { collectSources, paths, type LayeredConfig } from "../../transport/config_layers.js";
import { getKey } from "../../utils/config_keys.js";
import { resolveKey } from "../../utils/config_resolver.js";
import { getOperationConfig } from "../../utils/operation_config.js";
import type { ProviderCommand } from "../command_contract.js";
import { commandSchema } from "./command_schema.js";
import type { FcManagementSdk } from "./sdk.js";

export const MANAGED_KEY_HELP = "Choose an existing Sandbox API key, or AK/SK-managed authentication. Creating a managed key requires sandbox:CreateApiKey; reuse requires sandbox:DescribeApiKey; renewal requires sandbox:UpdateApiKey, scoped to the target Team's API keys. Creation/renewal requires confirmation (automatic only with --ci); a managed key expires after 30 days and is renewed on use within its final day. Optional Team: abx config set team_id <TEAM_ID>; otherwise the API uses your default Team. Permissions: https://help.aliyun.com/zh/agent-sandbox/authorize-ram-users-to-access-the-console";
const lifetime = 30 * 24 * 3600_000;
const renewBefore = 24 * 3600_000;
const requireModule = createRequire(import.meta.url);
function loadSdk(): FcManagementSdk {
  // Literal requires let SEA retain the lazy SDK; help and discovery never load it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Required for lazy SEA bundling.
  const models = typeof require === "function" ? require("@alicloud/sandbox20260820") : requireModule("@alicloud/sandbox20260820");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Required for lazy SEA bundling.
  const core = typeof require === "function" ? require("@alicloud/openapi-core") : requireModule("@alicloud/openapi-core");
  return { models, Client: models.default ?? models.Client, Config: core.$OpenApiUtil?.Config ?? core.OpenApiUtil?.Config };
}
/** Private test seam; production always uses the locked official SDK. */
export const managedKeySeams = { loadSdk, now: Date.now, directory: () => path.join(paths.abxDir, "credentials", "alicloud-express") };

const recordSchema = z.object({
  version: z.literal(1), state: z.enum(["pending", "ready"]), name: z.string().min(1),
  api_key_id: z.string().optional(), api_key_value: z.string().min(1).optional(),
  team_id: z.string().optional(), expire_time: z.string().optional(),
});
type KeyRecord = z.infer<typeof recordSchema>;
const inputSchema = z.strictObject({ team_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/).optional() });
const preparedSchema = z.strictObject({ secret_file: z.string(), api_key_id: z.string(), team_id: z.string(), expire_time: z.string() });
/** The result contains a private local file reference, never a plaintext key. */
export const MANAGED_KEY_COMMAND: ProviderCommand = {
  id: "api-key.prepare", description: "Create, reuse or renew a private 30-day Express API key (sandbox:CreateApiKey/DescribeApiKey/UpdateApiKey on the target Team); return metadata only.",
  description_zh: "创建、复用或续期本机私有的 30 天极速版 API Key，需目标 Team 的 CreateApiKey/DescribeApiKey/UpdateApiKey 权限；只返回元数据。",
  input_schema: commandSchema(inputSchema), output_schema: commandSchema(preparedSchema), effect: "write", idempotent: true,
};
/** Read-only resolution cannot create, renew, reset or re-enable a key. */
export const MANAGED_KEY_RESOLVE_COMMAND: ProviderCommand = {
  ...MANAGED_KEY_COMMAND, id: "api-key.resolve", effect: "read",
  description: "Resolve an existing managed key without creating or renewing credentials.",
  description_zh: "只读解析已管理的 API Key，不创建或续期凭据。",
};
/** Identifies the exact mutation that the Express CLI must explain and confirm. */
export class ManagedKeyConsentRequiredError extends ProviderTrustError {
  constructor(readonly operation: "creation" | "renewal", readonly region: string, readonly team: string) {
    super(`Managed API-key ${operation} requires confirmation (region ${region}, Team ${team}). Confirm in a terminal, explicitly run 'abx provider command run alicloud-express api-key.prepare --yes', or use --ci.`, {
      suggestion: "In a terminal, confirm the prompt; in automation use 'abx --ci ...'. To prepare explicitly, run 'abx provider command run alicloud-express api-key.prepare --yes'. Python: prepare_api_key(confirm=True). " + MANAGED_KEY_HELP,
    });
  }
}
export type PreparedKey = z.infer<typeof preparedSchema>;
const preparing = new Map<string, Promise<PreparedKey>>();

function privateDirectory(directory: string): void {
  for (const candidate of [path.dirname(directory), directory]) {
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) throw new ProviderConfigError("Managed credential directories must not be symbolic links.");
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProviderConfigError("Managed credential directory must be a real private directory.");
  fs.chmodSync(directory, 0o700);
}
function readRecord(filename: string): KeyRecord | undefined {
  let fd: number;
  try { fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new ProviderConfigError("Cannot read managed credential file safely."); }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("Insecure credential file");
    return recordSchema.parse(JSON.parse(fs.readFileSync(fd, "utf8")));
  } catch { throw new ProviderConfigError("Managed credential file is invalid or not private (0600). Inspect it locally; its contents are never displayed."); }
  finally { fs.closeSync(fd); }
}
function saveRecord(filename: string, record: KeyRecord): void {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, filename); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
function safeFailure(action: string, error: unknown): AuthenticationError {
  const status = Number(object(error).statusCode);
  const permission = action === "creation" ? "sandbox:CreateApiKey" : action === "renewal" ? "sandbox:UpdateApiKey" : "sandbox:DescribeApiKey";
  return new AuthenticationError(`Managed API-key ${action} failed${status === 403 ? " (permission denied)" : ""}. Check ${permission} on the target Team's API keys, region and AccessKey validity; an existing Sandbox API key is an alternative.`, {
    suggestion: MANAGED_KEY_HELP + " Credential values and raw cloud responses are omitted. An uncertain write is not retried; inspect the managed key in the selected region before recovery.",
  });
}

/** Prepare once per AccessKey identity, region and Team selector, coordinating other processes. */
export async function prepareManagedApiKey(config: LayeredConfig, raw: Record<string, unknown> = {}, confirmed = false): Promise<PreparedKey> {
  const input = inputSchema.safeParse(raw);
  if (!input.success) throw new ProviderConfigError("api-key.prepare accepts only an optional team_id.");
  const ak = config.access_key_id?.trim(), sk = config.access_key_secret?.trim();
  if (!ak || !sk) throw new InvalidAPIKeyError("Configure a Sandbox API key or both Alibaba Cloud AccessKey credentials.", { suggestion: MANAGED_KEY_HELP });
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(config.region)) throw new ProviderConfigError("Invalid managed-key region.");
  // team_id is an existing Express CLI setting, not a global transport contract.
  const team = input.data.team_id ?? config.provider_options["team_id"] ?? getOperationConfig()?.["team_id"] ?? resolveKey(getKey("team_id", "alicloud-express")!, collectSources())?.value ?? undefined;
  if (team !== undefined && (typeof team !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/.test(team))) throw new ProviderConfigError("Invalid managed-key team_id.");
  const identity = createHash("sha256").update(JSON.stringify([ak, config.region, team ?? "default"])).digest("hex");
  const directory = managedKeySeams.directory();
  privateDirectory(directory);
  const filename = path.join(directory, `${identity}.json`);
  const job = `${filename}:${confirmed}`;
  const underway = preparing.get(job);
  if (underway) return underway;
  const task = prepareLocked(config, filename, identity, team, ak, sk, confirmed);
  preparing.set(job, task);
  try { return await task; } finally { preparing.delete(job); }
}

async function prepareLocked(config: LayeredConfig, filename: string, identity: string, team: string | undefined, ak: string, sk: string, confirmed: boolean): Promise<PreparedKey> {
  const lock = `${filename}.lock`;
  const deadline = Date.now() + 15_000;
  let fd: number | undefined;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, "wx", 0o600); fs.writeFileSync(fd, String(process.pid)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new ProviderConfigError("Cannot lock managed credential storage; check its permissions.");
      // Never unlink another writer's lock: competing stale-lock recoveries can
      // otherwise delete a new owner's lock and allow duplicate cloud writes.
      let owner: number;
      try { owner = Number(fs.readFileSync(lock, "utf8")); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new ProviderConfigError("Cannot read the managed credential lock safely.");
      }
      if (Number.isInteger(owner) && owner > 0) {
        try { process.kill(owner, 0); }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ESRCH") throw new ProviderConfigError("A previous managed-key writer exited without releasing its lock. Inspect the pending record and cloud key before removing this exact .lock file; no credential write was repeated.");
        }
      }
      if (Date.now() >= deadline) throw new ProviderConfigError("Another process is preparing this managed API key; retry after it finishes.");
      await delay(50);
    }
  }
  try {
    let saved = readRecord(filename);
    if (saved?.state === "pending") throw new ProviderConfigError(`A previous managed-key write has an unknown outcome (${saved.name}). Inspect API Keys in the selected region before recovering this local record; creation was not repeated.`);
    if (saved && (!saved.api_key_id || !saved.api_key_value || !saved.team_id)) throw new ProviderConfigError("Managed credential metadata is incomplete; inspect the local record before proceeding.");
    if (!saved && !confirmed) throw new ManagedKeyConsentRequiredError("creation", config.region, team ?? "default");
    const sdk = managedKeySeams.loadSdk();
    const milliseconds = Math.ceil(config.http_timeout * 1000);
    const client = new sdk.Client(new sdk.Config({ accessKeyId: ak, accessKeySecret: sk, regionId: config.region,
      endpoint: `sandbox.${config.region}.aliyuncs.com`, readTimeout: milliseconds, connectTimeout: milliseconds, retryOptions: { retryable: false } }));
    const runtime = { autoretry: false, maxAttempts: 1, readTimeout: milliseconds, connectTimeout: milliseconds };
    const request = (name: string, value: Record<string, unknown>) => new sdk.models[name]!(value);
    const call = async (action: string, operation: () => Promise<unknown>): Promise<Record<string, unknown>> => {
      try {
        const body = object(object(await operation()).body);
        if (body.code !== undefined && !["200", "Success", "SUCCESS", "OK", ""].includes(String(body.code))) throw new Error("Cloud rejected request");
        return body;
      } catch (error) {
        // A definite authorization/validation rejection did not create a credential.
        if (action !== "lookup" && [400, 401, 403, 404, 422].includes(Number(object(error).statusCode))) {
          if (saved) saveRecord(filename, { ...saved, state: "ready" });
          else fs.unlinkSync(filename);
        }
        throw safeFailure(action, error);
      }
    };
    if (saved) {
      const current = await call("lookup", () => client.describeApiKeyWithOptions(saved!.api_key_id, request("DescribeApiKeyRequest", {}), {}, runtime));
      const key = object(current.apiKey);
      if (!saved.api_key_id || !saved.api_key_value || key.apiKeyID !== saved.api_key_id || key.apiKeyName !== saved.name || key.teamID !== saved.team_id) throw new ProviderProtocolError("Managed API-key identity differs from the saved record; automatic replacement was refused.");
      if (key.status !== "active") throw new AuthenticationError("The managed API key is disabled or unavailable. Inspect its policy/status; it was not reset or replaced.", { suggestion: MANAGED_KEY_HELP });
      const expires = Date.parse(String(key.expireTime ?? ""));
      if (!Number.isFinite(expires)) throw new ProviderProtocolError("Managed API-key expiry is missing or invalid.");
      saved.expire_time = String(key.expireTime);
      if (expires - managedKeySeams.now() < renewBefore) {
        if (!confirmed) throw new ManagedKeyConsentRequiredError("renewal", config.region, saved.team_id ?? team ?? "default");
        const expireTime = new Date(managedKeySeams.now() + lifetime).toISOString();
        saveRecord(filename, { ...saved, state: "pending" });
        const renewed = await call("renewal", () => client.updateApiKeyWithOptions(saved!.api_key_id, request("UpdateApiKeyRequest", {
          body: request("UpdateApiKeyInput", { expireTime }),
        }), {}, runtime));
        const key = object(renewed.apiKey);
        if (key.apiKeyID !== saved.api_key_id || key.teamID !== saved.team_id || !Number.isFinite(Date.parse(String(key.expireTime))) || Math.abs(Date.parse(String(key.expireTime)) - Date.parse(expireTime)) > 1000) throw new ProviderProtocolError("Key renewal returned incomplete or mismatched metadata; inspect the key before recovering the pending local record.");
        saved.expire_time = String(key.expireTime);
      }
    } else {
      const name = `abx-managed-${identity.slice(0, 20)}-${randomUUID().slice(0, 8)}`;
      const expireTime = new Date(managedKeySeams.now() + lifetime).toISOString();
      saveRecord(filename, { version: 1, state: "pending", name });
      const created = await call("creation", () => client.createApiKeyWithOptions(request("CreateApiKeyRequest", {
        body: request("CreateApiKeyInput", { apiKeyName: name, expireTime, ...(team ? { teamID: team } : {}) }),
      }), {}, runtime));
      const key = object(created.apiKey);
      if (typeof key.apiKeyValue !== "string" || !key.apiKeyValue.trim() || typeof key.apiKeyID !== "string" || !key.apiKeyID || typeof key.teamID !== "string" || !key.teamID || key.apiKeyName !== name || team && key.teamID !== team) throw new ProviderProtocolError("Key creation returned incomplete metadata; inspect the key before recovering the pending local record.");
      saved = { version: 1, state: "ready", name, api_key_id: key.apiKeyID, api_key_value: key.apiKeyValue.trim(), team_id: key.teamID, expire_time: expireTime };
    }
    saveRecord(filename, { ...saved, state: "ready" });
    return preparedSchema.parse({ secret_file: filename, api_key_id: saved.api_key_id, team_id: saved.team_id, expire_time: saved.expire_time });
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

/** Explicit API keys always win; rejected keys never trigger credential creation. */
export async function resolveSandboxApiKey(config: LayeredConfig): Promise<string> {
  if (config.sandbox_api_key?.trim()) return config.sandbox_api_key;
  const prepared = await prepareManagedApiKey(config);
  const saved = readRecord(prepared.secret_file);
  if (saved?.state !== "ready" || !saved.api_key_value) throw new ProviderProtocolError("Managed key preparation did not produce a usable credential.");
  return saved.api_key_value;
}

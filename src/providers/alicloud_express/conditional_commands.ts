/** Express data-plane operations registered once for the CLI and all engine clients. */
import { z } from "zod";
import { InvalidAPIKeyError, QuotaExceededError, SandboxError, SandboxNotFoundError } from "../../models/errors.js";
import { ApiKeyAuth } from "../../transport/auth_contract.js";
import type { LayeredConfig } from "../../transport/config_layers.js";
import { HttpClient, HTTPStatusError, TimeoutException } from "../../transport/http.js";
import type { ProviderCommand, ProviderCommandRunner } from "../command_contract.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError, ProviderProtocolError, ProviderResourceNotFoundError, ProviderTimeoutError } from "../../models/provider_errors.js";
import { commandSchema } from "./command_schema.js";

type Dict = Record<string, unknown>;
const sandboxId = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
// Express returns UUID snapshot IDs. Names share the template deletion route, so this API accepts IDs only.
const snapshotId = z.uuid().describe("Snapshot UUID returned by snapshot.create/list; template names and aliases are refused.");
const requestTimeout = z.number().int().min(1).max(300).optional();
const lifetime = z.number().int().min(1).max(86400).optional();
const inputs = {
  "sandbox.pause": z.strictObject({ sandbox_id: sandboxId, request_timeout: requestTimeout }),
  "sandbox.resume": z.strictObject({ sandbox_id: sandboxId, timeout: lifetime, request_timeout: requestTimeout }),
  "snapshot.create": z.strictObject({ sandbox_id: sandboxId, name: z.string().min(1).max(256).optional(), request_timeout: requestTimeout }),
  "snapshot.list": z.strictObject({ sandbox_id: sandboxId.optional(), name: z.string().min(1).max(512).optional(), limit: z.number().int().min(1).max(100).optional(), next_token: z.string().min(1).max(4096).optional(), request_timeout: requestTimeout }),
  "snapshot.restore": z.strictObject({ snapshot_id: snapshotId, timeout: lifetime, metadata: z.record(z.string().min(1).max(64), z.string().max(512)).optional(), request_timeout: requestTimeout }),
  "snapshot.delete": z.strictObject({ snapshot_id: snapshotId, request_timeout: requestTimeout }),
} as const;
type Id = keyof typeof inputs;
const snapshot = z.strictObject({ snapshot_id: z.string().min(1), names: z.array(z.string()) });
const outputs = {
  "sandbox.pause": z.strictObject({ sandbox_id: sandboxId, paused: z.literal(true) }),
  "sandbox.resume": z.strictObject({ sandbox_id: sandboxId, resumed: z.literal(true) }),
  "snapshot.create": snapshot,
  "snapshot.list": z.strictObject({ snapshots: z.array(snapshot), next_token: z.string().nullable() }),
  "snapshot.restore": z.strictObject({ sandbox_id: sandboxId, snapshot_id: snapshotId }),
  "snapshot.delete": z.strictObject({ deleted: z.boolean() }),
};
const labels: Record<Id, readonly [string, string]> = {
  "sandbox.pause": ["Pause with memory retained (account allowlist required).", "保留内存暂停沙箱（需账号白名单）。"],
  "sandbox.resume": ["Resume the same sandbox through connect (account allowlist required).", "通过 connect 恢复同一个沙箱（需账号白名单）。"],
  "snapshot.create": ["Snapshot a running generation2 sandbox (Snapshot allowlist required).", "为运行中的二代沙箱创建快照（需快照白名单）。"],
  "snapshot.list": ["List one Snapshot page, optionally filtered by source sandbox or name.", "分页查询快照，可按源沙箱或名称过滤。"],
  "snapshot.restore": ["Create a new sandbox from a Snapshot UUID.", "从快照 UUID 创建新沙箱。"],
  "snapshot.delete": ["Delete a Snapshot UUID independently of its source sandbox.", "独立删除快照 UUID，不删除源沙箱。"],
};

/** Discovery is pure metadata: no credentials, SDK import or network access. */
export const CONDITIONAL_COMMANDS: readonly ProviderCommand[] = (Object.keys(inputs) as Id[]).map((id) => ({
  id, description: labels[id][0], description_zh: labels[id][1],
  input_schema: commandSchema(inputs[id]), output_schema: commandSchema(outputs[id]),
  effect: id === "snapshot.list" ? "read" : id === "snapshot.delete" ? "delete" : "write",
  idempotent: id === "snapshot.list" || id === "snapshot.delete",
}));

export function isConditionalCommand(id: string): id is Id { return Object.hasOwn(inputs, id); }

function readSnapshot(raw: unknown): z.infer<typeof snapshot> {
  const parsed = z.object({ snapshotID: z.string().min(1), names: z.array(z.string()) }).safeParse(raw);
  if (!parsed.success) throw new ProviderProtocolError("Express returned an invalid Snapshot result; do not repeat a creation automatically.");
  return { snapshot_id: parsed.data.snapshotID, names: parsed.data.names };
}

function serviceError(id: Id, error: unknown): never {
  if (error instanceof HTTPStatusError) {
    const status = error.response.status_code;
    if (status === 404 && id === "snapshot.delete") throw error; // Handled as a documented absence by the caller.
    if (status === 404) {
      if (id.startsWith("sandbox.") || id === "snapshot.create") throw new SandboxNotFoundError("The source sandbox was not found.");
      throw new ProviderResourceNotFoundError("The Snapshot was not found.");
    }
    if (status === 403) throw new SandboxError("Express denied this operation (HTTP403).", { suggestion: "Check the selected account/region and pause or Snapshot allowlist; snapshots require generation2. This is service admission, not an undeclared provider capability." });
    if (status === 429) throw new QuotaExceededError("Express rejected the operation (HTTP429). No retry was made.");
    throw new ProviderProtocolError(`Express operation '${id}' returned HTTP${status}. No retry was made.`, { suggestion: "For HTTP409, wait for the owned sandbox transition to finish. For a failed Snapshot creation, list by source sandbox before retrying; check allowlist and generation2 prerequisites." });
  }
  if (error instanceof TimeoutException) throw new ProviderTimeoutError(`Express operation '${id}' timed out; its outcome may be unknown. No retry was made.`, { suggestion: "Reconcile the source sandbox and Snapshot list before repeating a mutation." });
  throw error;
}

/** Build an isolated, closeable data-plane runner. AK/SK is never substituted for the API key. */
export function buildConditionalCommandRunner(config: LayeredConfig): ProviderCommandRunner {
  if (!config.sandbox_api_key?.trim()) throw new InvalidAPIKeyError("Express pause/Snapshot commands require the selected sandbox API key; AK/SK does not replace it.");
  const http = new HttpClient(config.toTransportConfig(), new ApiKeyAuth(config.sandbox_api_key));
  return {
    async run(id: string, raw: Dict, signal: AbortSignal): Promise<unknown> {
      if (!isConditionalCommand(id)) throw new ProviderFeatureNotSupportedError("alicloud-express", `command:${id}`);
      const parsed = inputs[id].safeParse(raw);
      if (!parsed.success) throw new ProviderConfigError(`Invalid input for '${id}'; use the command schema and a returned Snapshot UUID, not a template name.`);
      if (signal.aborted) throw new ProviderTimeoutError("Provider command was cancelled before sending a request.");
      const input = parsed.data as Dict;
      const request_timeout = Number(input.request_timeout ?? (id === "snapshot.create" ? 300 : config.http_timeout));
      const source = encodeURIComponent(String(input.sandbox_id));
      try {
        if (id === "sandbox.pause") {
          await http.platformRequest("POST", `/sandboxes/${source}/pause`, { json: { memory: true }, request_timeout });
          return { sandbox_id: input.sandbox_id, paused: true };
        }
        if (id === "sandbox.resume") {
          await http.platformRequest("POST", `/sandboxes/${source}/connect`, { json: { timeout: input.timeout ?? 300 }, request_timeout });
          return { sandbox_id: input.sandbox_id, resumed: true };
        }
        if (id === "snapshot.create") {
          const response = await http.platformRequest("POST", `/sandboxes/${source}/snapshots`, { json: input.name === undefined ? {} : { name: input.name }, request_timeout });
          return readSnapshot(response.json());
        }
        if (id === "snapshot.list") {
          const response = await http.platformRequest("GET", "/snapshots", { params: {
            ...(input.sandbox_id === undefined ? {} : { sandboxID: input.sandbox_id }),
            ...(input.name === undefined ? {} : { name: input.name }),
            limit: input.limit ?? 100, ...(input.next_token === undefined ? {} : { nextToken: input.next_token }),
          }, request_timeout });
          const rows: unknown = response.json();
          if (!Array.isArray(rows)) throw new ProviderProtocolError("Express returned an invalid Snapshot page.");
          return { snapshots: rows.map(readSnapshot), next_token: response.headers.get("x-next-token") ?? null };
        }
        if (id === "snapshot.restore") {
          const response = await http.platformRequest("POST", "/sandboxes", { json: { templateID: input.snapshot_id, timeout: input.timeout ?? 300, ...(input.metadata === undefined ? {} : { metadata: input.metadata }) }, request_timeout });
          const result = z.object({ sandboxID: sandboxId }).safeParse(response.json());
          if (!result.success) throw new ProviderProtocolError("Express may have created a sandbox but returned an invalid ID; reconcile owned resources before retrying.");
          return { sandbox_id: result.data.sandboxID, snapshot_id: input.snapshot_id };
        }
        try { await http.platformRequest("DELETE", `/templates/${encodeURIComponent(String(input.snapshot_id))}`, { request_timeout }); }
        catch (error) { if (error instanceof HTTPStatusError && error.response.status_code === 404) return { deleted: false }; throw error; }
        return { deleted: true };
      } catch (error) { return serviceError(id, error); }
    },
    close: () => http.close(),
  };
}

/** Express-only runtime mutations, registered once for CLI and engine consumers. */
import { z } from "zod";
import { InvalidAPIKeyError, QuotaExceededError, SandboxNotFoundError } from "../../models/errors.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError, ProviderProtocolError, ProviderTimeoutError } from "../../models/provider_errors.js";
import { validateVolumeMounts } from "../../models/sandbox.js";
import type { LayeredConfig } from "../../transport/config_layers.js";
import { HTTPStatusError, TimeoutException } from "../../transport/http.js";
import type { ProviderCommand, ProviderCommandRunner } from "../command_contract.js";
import { commandSchema } from "./command_schema.js";
import { dataPlaneClient } from "./data_plane.js";
import { networkUpdateSchema, networkUpdateWire } from "./network_schema.js";

type Dict = Record<string, unknown>;
const sandboxId = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
const requestTimeout = z.number().int().min(1).max(300).optional();
const text = z.string().min(1).max(1024);
const path = z.string().min(2).max(128);
const ossPoint = z.strictObject({ bucket_name: z.string().min(3).max(64), bucket_path: z.string().max(128).optional(), endpoint: text, mount_dir: path.max(64), read_only: z.boolean().optional() });
const agenticFsPoint = z.strictObject({ server_addr: z.string().min(1).max(128), mount_dir: path });
const bucketPoint = z.strictObject({ agentic_bucket: text, bucket_name: text, bucket_path: text.optional(), endpoint: text, mount_dir: path, read_only: z.boolean().optional() });
const juicePoint = z.strictObject({ volume_name: text, remote_dir: text.optional(), mount_dir: path, token: z.string().min(1).max(65536), args: z.array(z.string().max(4096)).max(64).optional() });
const inlineMounts = z.strictObject({
  oss: z.strictObject({ mount_points: z.array(ossPoint).min(1).max(5) }).optional(),
  agentic_fs: z.strictObject({ user_id: z.number().int().min(-1).max(65534).optional(), group_id: z.number().int().min(-1).max(65534).optional(), mount_points: z.array(agenticFsPoint).min(1).max(5) }).optional(),
  agentic_bucket: z.strictObject({ mount_points: z.array(bucketPoint).min(1).max(5) }).optional(),
  juice_fs: z.strictObject({ envs: z.record(z.string().min(1).max(256), z.string().max(65536)).optional(), mount_points: z.array(juicePoint).min(1).max(5) }).optional(),
});
const appendInput = z.strictObject({
  sandbox_id: sandboxId, request_timeout: requestTimeout,
  named_volume_mounts: z.array(z.strictObject({ name: text, path })).min(1).max(20).optional(),
  inline_volume_mounts: inlineMounts.optional(),
});
const inputs = {
  "sandbox.mounts.append": appendInput,
  "sandbox.network.update": z.strictObject({ sandbox_id: sandboxId, network: networkUpdateSchema, request_timeout: requestTimeout }),
  "sandbox.timeout": z.strictObject({ sandbox_id: sandboxId, timeout: z.number().int().min(1).max(2147483647), request_timeout: requestTimeout }),
};
type Id = keyof typeof inputs;
const outputs = {
  "sandbox.mounts.append": z.strictObject({ sandbox_id: sandboxId, appended: z.literal(true) }),
  "sandbox.network.update": z.strictObject({ sandbox_id: sandboxId, updated: z.literal(true) }),
  "sandbox.timeout": z.strictObject({ sandbox_id: sandboxId, timeout: z.number().int().min(1) }),
};
const descriptions: Record<Id, readonly [string, string]> = {
  "sandbox.mounts.append": ["Append named or inline mounts to a running sandbox; existing mounts, roles and VPC are retained.", "向运行中的沙箱追加按名或直接配置的存储挂载，保留已有挂载、角色和 VPC。"],
  "sandbox.network.update": ["Replace egress network rules; an explicit empty network object clears the rules.", "整体替换出网规则；显式空 network 对象会清空规则。"],
  "sandbox.timeout": ["Set an existing sandbox lifetime in seconds without connecting or resuming it.", "设置已有沙箱的生存期限（秒），不连接或隐式恢复沙箱。"],
};
/** Static discovery is credential-free and never contacts a backend. */
export const RUNTIME_COMMANDS: readonly ProviderCommand[] = (Object.keys(inputs) as Id[]).map((id) => ({
  id, description: descriptions[id][0], description_zh: descriptions[id][1], effect: "write", idempotent: false,
  input_schema: commandSchema(inputs[id]), output_schema: commandSchema(outputs[id]),
}));
export function isRuntimeCommand(id: string): id is Id { return Object.hasOwn(inputs, id); }

const aliases: Record<string, string> = { named_volume_mounts: "namedVolumeMounts", inline_volume_mounts: "inlineVolumeMounts", mount_points: "mountPoints", bucket_name: "bucketName", bucket_path: "bucketPath", mount_dir: "mountDir", read_only: "readOnly", agentic_fs: "agenticFS", user_id: "userID", group_id: "groupID", server_addr: "serverAddr", agentic_bucket: "agenticBucket", juice_fs: "juiceFS", volume_name: "volumeName", remote_dir: "remoteDir" };
function mountWire(value: unknown, envs = false): unknown {
  if (Array.isArray(value)) return value.map((v) => mountWire(v));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [envs ? key : aliases[key] ?? key, envs ? child : mountWire(child, key === "envs")]));
}
function validateMounts(input: z.infer<typeof appendInput>): void {
  const paths = (input.named_volume_mounts ?? []).map((item) => item.path);
  for (const config of Object.values(input.inline_volume_mounts ?? {})) paths.push(...config.mount_points.map((item) => item.mount_dir));
  if (!paths.length) throw new ProviderConfigError("Append mounts requires at least one named or inline mount point.");
  try { for (const entry of paths) validateVolumeMounts({ [entry]: "mount" }); }
  catch { throw new ProviderConfigError("Mount paths must be normalized absolute Unix paths outside system and hidden directories."); }
  for (let i = 0; i < paths.length; i++) {
    for (let j = 0; j < i; j++) {
      if (paths[i] === paths[j] || paths[i]!.startsWith(`${paths[j]}/`) || paths[j]!.startsWith(`${paths[i]}/`)) {
        throw new ProviderConfigError("Submitted mount paths must be distinct and must not overlap.");
      }
    }
  }
  for (const point of input.inline_volume_mounts?.juice_fs?.mount_points ?? []) {
    if (point.args?.some((arg) => /^--(?:token|subdir)(?:=|$)/.test(arg))) throw new ProviderConfigError("JuiceFS args cannot override platform-managed token or subdir arguments.");
  }
}
function serviceError(id: Id, error: unknown): never {
  if (error instanceof HTTPStatusError) {
    const status = error.response.status_code;
    if (status === 404) throw new SandboxNotFoundError("The target sandbox was not found.");
    if (status === 429) throw new QuotaExceededError("Express rejected the operation (HTTP429). No retry was made.");
    throw new ProviderProtocolError(`Express operation '${id}' returned HTTP${status}. No retry was made.`, { suggestion: "Check account policy, running state, storage/role/VPC prerequisites or the declared network fields. Reconcile the target before repeating a mutation." });
  }
  if (error instanceof TimeoutException) throw new ProviderTimeoutError(`Express operation '${id}' timed out; its outcome may be unknown. No retry was made.`, { suggestion: "Inspect the target configuration and independently verify storage or network behavior before retrying." });
  if (error instanceof InvalidAPIKeyError) throw new InvalidAPIKeyError("Express rejected the selected Sandbox API key. No credential creation or retry was attempted.");
  throw new ProviderProtocolError(`Express operation '${id}' failed; its remote outcome may be unknown. No retry was made.`);
}

/** Closeable runtime runner; validation precedes lazy credential resolution and backend I/O. */
export function buildRuntimeCommandRunner(config: LayeredConfig): ProviderCommandRunner {
  const client = dataPlaneClient(config);
  return {
    async run(id, raw, signal) {
      if (!isRuntimeCommand(id)) throw new ProviderFeatureNotSupportedError("alicloud-express", `command:${id}`);
      const parsed = inputs[id].safeParse(raw);
      if (!parsed.success) throw new ProviderConfigError(`Invalid input for '${id}'; inspect the command input schema.`);
      if (id === "sandbox.mounts.append") validateMounts(parsed.data as z.infer<typeof appendInput>);
      const input = parsed.data as Dict;
      const body = id === "sandbox.network.update" ? networkUpdateWire((parsed.data as z.infer<typeof inputs["sandbox.network.update"]>).network)
        : id === "sandbox.timeout" ? { timeout: input.timeout }
          : mountWire({ ...(input.named_volume_mounts === undefined ? {} : { named_volume_mounts: input.named_volume_mounts }), ...(input.inline_volume_mounts === undefined ? {} : { inline_volume_mounts: input.inline_volume_mounts }) }) as Dict;
      const http = await client.get(signal);
      const request_timeout = Number(input.request_timeout ?? (id === "sandbox.mounts.append" ? 120 : config.http_timeout));
      const suffix = id === "sandbox.mounts.append" ? "fc-volume-mounts" : id === "sandbox.timeout" ? "timeout" : "network";
      try {
        const response = await http.platformRequest(id === "sandbox.network.update" ? "PUT" : "POST", `/sandboxes/${encodeURIComponent(String(input.sandbox_id))}/${suffix}`, { json: body, request_timeout });
        if (response.status_code !== 204) throw new ProviderProtocolError("Express returned an unexpected runtime mutation response; reconcile before retrying.");
        return id === "sandbox.mounts.append" ? { sandbox_id: input.sandbox_id, appended: true }
          : id === "sandbox.timeout" ? { sandbox_id: input.sandbox_id, timeout: input.timeout }
            : { sandbox_id: input.sandbox_id, updated: true };
      } catch (error) { return serviceError(id, error); }
    },
    close: () => client.close(),
  };
}

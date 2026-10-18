/** Verified workflows shared by all MCP transports; adapters remain provider-owned. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getProvider, resolveProviderId } from "../providers/registry.js";
import type { SandboxManager } from "./mcp.js";
import type { JsonObject } from "./_py.js";
import { cliProvider } from "../providers/selection.js";
import { queryTask, startTask } from "./tasks.js";

const sid = { sandbox_id: z.string().min(1) };
const task = { ...sid, task_id: z.uuid() };
const path = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const operationInputs = {
  get_capabilities: z.strictObject({}),
  list_sandboxes: z.strictObject({ limit: z.number().int().min(1).max(1000).optional(), offset: z.number().int().min(0).optional() }),
  get_sandbox: z.strictObject(sid),
  set_sandbox_timeout: z.strictObject({ ...sid, timeout: z.number().int().min(1).max(86400) }),
  retain_sandbox: z.strictObject({ ...sid, retain: z.boolean().default(true) }),
  upload_file: z.strictObject({ ...sid, path, content_base64: z.string().max(1400000), sha256: hash }),
  download_file: z.strictObject({ ...sid, path, max_bytes: z.number().int().min(1).max(1048576).default(1048576) }),
  start_task: z.strictObject({ ...sid, command: z.string().min(1).max(262144), cwd: path.optional() }),
  get_task: z.strictObject({ ...task, max_bytes: z.number().int().min(1).max(65536).default(16384) }),
  cancel_task: z.strictObject(task),
  verify_sandbox: z.strictObject(sid),
};
const descriptions: Record<keyof typeof operationInputs, string> = {
  get_capabilities: "Inspect provider declarations and explicitly unverified platform dependencies. Declarations are not live acceptance.",
  list_sandboxes: "Observe resources without connecting, renewing or adopting them.",
  get_sandbox: "Observe sandbox metadata without renewal or ownership changes. Missing timeout/region remain unknown.",
  set_sandbox_timeout: "Explicitly change lifetime, then query metadata. Accepted does not imply observed TTL matches.",
  retain_sandbox: "Preserve a session-created sandbox across disconnect (until its platform lifetime expires). Existing resources are preserved by default.",
  upload_file: "Upload bounded binary data from base64, check input SHA-256 and remote read-back. Does not read local paths.",
  download_file: "Return bounded bytes as base64 with SHA-256. Client must write and verify the local artifact before reporting delivery.",
  start_task: "Start a Linux sh/python3 task with persistent status/logs in the sandbox; retain sandbox on disconnect. Return task_id; do not resubmit after uncertain errors.",
  get_task: "Recover the original task by ID and return exit status and bounded log tails. Never recreates the environment.",
  cancel_task: "Signal the persisted task process group after checking process identity. Poll cancelling to a terminal state and verify observable work stopped.",
  verify_sandbox: "Check deterministic command output and binary round trip, cleaning up the probe file.",
};
export const OPERATION_SCHEMAS = Object.entries(operationInputs).map(([name, schema]) => ({
  name, description: descriptions[name as keyof typeof operationInputs], inputSchema: z.toJSONSchema(schema, { io: "input" }) as JsonObject,
}));
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Return only non-secret metadata; explicitly convert Date objects before Python-compatible JSON encoding. */
export function safeInfo(info: Record<string, unknown>): JsonObject {
  return Object.fromEntries(["sandbox_id", "template", "status", "region", "timeout", "cpu_count", "memory_mb", "started_at", "end_at"].map(key => {
    const value = info[key];
    return [key, (key === "timeout" && value === 0) || (key === "region" && value === "") ? null : value instanceof Date ? value.toISOString() : value ?? null];
  }));
}

/** Dispatch a schema-validated workflow operation. */
export async function handleOperation(name: keyof typeof operationInputs, raw: JsonObject, manager: SandboxManager): Promise<JsonObject> {
  const p = operationInputs[name].parse(raw) as Record<string, unknown>;
  if (name === "get_capabilities") {
    const provider = getProvider(resolveProviderId(cliProvider()));
    return { provider: provider.id, declared_features: [...provider.features].sort(), verification: "declaration_only",
      platform_dependencies: ["storage_mount", "template_cache", "warm_pool", "billing", "snapshot", "deep_hibernation", "preview_expiry", "desktop_handoff", "hosted_mcp"],
      note: "Only per-provider live evidence establishes workflow support; task wrappers need Linux, sh, python3, nohup and /proc." };
  }
  if (name === "list_sandboxes") return { sandboxes: (await manager.listSandboxes(p)).map(safeInfo) };
  const id = p.sandbox_id as string;
  if (name === "get_sandbox") return { sandbox: safeInfo(await manager.observeSandbox(id)) };
  if (name === "set_sandbox_timeout") {
    await manager.setSandboxTimeout(p.timeout as number, id);
    const info = safeInfo(await manager.observeSandbox(id));
    return { accepted: true, requested_timeout: p.timeout, sandbox: info, timeout_verified: info.timeout === p.timeout };
  }
  const sandbox = await manager.getSandbox(id);
  if (name === "retain_sandbox") { manager.retainSandbox(id, p.retain as boolean); return { sandbox_id: id, retained: p.retain }; }
  if (name === "upload_file") {
    const encoded = p.content_base64 as string;
    const data = Buffer.from(encoded, "base64");
    if (data.toString("base64") !== encoded) throw new Error("Invalid canonical base64");
    if (digest(data) !== p.sha256) throw new Error("Input SHA-256 mismatch; file was not written");
    await sandbox.files.write(p.path, data);
    const received = await sandbox.files.readBytes(p.path) as Uint8Array;
    if (digest(received) !== p.sha256) throw new Error("Upload verification failed: remote bytes differ");
    return { path: p.path, bytes: received.length, sha256: digest(received), verified: true };
  }
  if (name === "download_file") {
    const stat = await sandbox.files.getInfo(p.path) as { size: number };
    if (stat.size > (p.max_bytes as number)) throw new Error("File exceeds max_bytes; use CLI download for large files");
    const data = await sandbox.files.readBytes(p.path) as Uint8Array;
    if (data.length > (p.max_bytes as number)) throw new Error("File grew beyond max_bytes; use CLI download");
    return { path: p.path, bytes: data.length, sha256: digest(data), content_base64: Buffer.from(data).toString("base64") };
  }
  if (name === "start_task") { manager.retainSandbox(id, true); return { sandbox_id: id, ...await startTask(sandbox, p.command as string, p.cwd as string | undefined) }; }
  if (name === "get_task" || name === "cancel_task") return { sandbox_id: id, ...await queryTask(sandbox, p.task_id as string, name === "cancel_task", p.max_bytes as number | undefined) };
  const probe = `/tmp/.abx-probe-${randomUUID()}`;
  try {
    const result = await sandbox.commands.run("printf abx-probe", { shell: true, timeout: 15 });
    const data = Buffer.from([0, 255, 10, 128, 42]);
    await sandbox.files.write(probe, data);
    const received = await sandbox.files.readBytes(probe) as Uint8Array;
    const checks = { command_exit: result.exit_code === 0, command_output: result.stdout === "abx-probe", binary_round_trip: digest(data) === digest(received) };
    return { checks, verified: Object.values(checks).every(Boolean) };
  } finally { await sandbox.files.remove(probe); }
}

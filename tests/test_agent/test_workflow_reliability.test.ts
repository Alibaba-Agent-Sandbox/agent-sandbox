import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxManager, SandboxMCPServer, sdk } from "../../src/agent/mcp.js";
import { dispatchTool } from "../../src/agent/tools.js";
import { safeInfo } from "../../src/agent/operations.js";
import { queryTask, startTask, type TaskSandbox } from "../../src/agent/tasks.js";

const run = promisify(execFile);
const local: TaskSandbox = { commands: { run: async command => {
  try { return { ...await run("sh", ["-c", command], { timeout: 20000 }), exit_code: 0 }; }
  catch (error) { const e = error as { stdout: string; stderr: string; code: number }; return { stdout: e.stdout, stderr: e.stderr, exit_code: e.code }; }
} } };
const ids: string[] = [];
afterEach(async () => {
  for (const id of ids.splice(0)) {
    await queryTask(local, id, true).catch(() => undefined);
    await rm(`/tmp/.abx-tasks/${id}`, { force: true, recursive: true });
  }
  vi.restoreAllMocks();
});
async function terminal(id: string): Promise<Record<string, unknown>> {
  let result: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) {
    result = await queryTask(local, id);
    if (["succeeded", "failed", "cancelled"].includes(result.state as string)) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`No terminal task state: ${JSON.stringify(result)}`);
}

describe("real Linux task lifecycle", () => {
  it("recovers the original task and its exit/logs from fresh client state", async () => {
    const started = await startTask(local, "printf before; sleep .15; printf after; printf failure >&2; exit 7");
    const id = started.task_id as string; ids.push(id);
    const result = await terminal(id);
    expect(result).toMatchObject({ task_id: id, state: "failed", exit_code: 7, stdout: "beforeafter", stderr: "failure" });
    expect(await queryTask({ ...local }, id)).toMatchObject(result);
  });
  it("cancels a task group, observes terminal state and no additional output", async () => {
    const started = await startTask(local, "while true; do printf tick; sleep .05; done");
    const id = started.task_id as string; ids.push(id);
    await queryTask(local, id, true);
    const result = await terminal(id);
    expect(result.state).toBe("cancelled");
    const server = new SandboxMCPServer();
    server._manager.getSandbox = vi.fn().mockResolvedValue(local);
    const response = await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: "get_task", arguments: { sandbox_id: "local-test", task_id: id },
    } });
    const toolResult = response?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(toolResult.isError).toBe(false);
    expect(JSON.parse(toolResult.content[0]!.text)).toMatchObject({ state: "cancelled", exit_code: -15 });
    await new Promise(resolve => setTimeout(resolve, 120));
    expect((await queryTask(local, id)).stdout).toBe(result.stdout);
  });
  it("never manufactures a completed result for an unknown task", async () => {
    await expect(queryTask(local, "12345678-1234-1234-1234-123456789012")).rejects.toThrow("Task control failed");
  });
});

describe("workflow evidence and ownership", () => {
  it("does not modify lifetime or kill a resource connected by ID", async () => {
    const sandbox = { id: "existing", setTimeout: vi.fn(), kill: vi.fn(), close: vi.fn() };
    const connect = vi.fn().mockResolvedValue(sandbox);
    vi.spyOn(sdk, "loadSandbox").mockResolvedValue({ create: vi.fn(), connect, killById: vi.fn(), list: vi.fn(), getInfoById: vi.fn() });
    const manager = new SandboxManager();
    await manager.getSandbox("existing");
    await manager.getSandbox("existing");
    await manager.shutdown();
    expect(sandbox.setTimeout).not.toHaveBeenCalled();
    expect(sandbox.kill).not.toHaveBeenCalled();
    expect(sandbox.close).toHaveBeenCalledOnce();
  });
  it("retains an explicitly preserved created sandbox and kills only an ephemeral created one", async () => {
    const a = { id: "keep", kill: vi.fn(), close: vi.fn() }, b = { id: "drop", kill: vi.fn() };
    vi.spyOn(sdk, "loadSandbox").mockResolvedValue({ create: vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b), connect: vi.fn(), killById: vi.fn(), list: vi.fn(), getInfoById: vi.fn() });
    const manager = new SandboxManager();
    await manager.createSandbox({ retain: true }); await manager.createSandbox(); await manager.shutdown();
    expect(a.kill).not.toHaveBeenCalled(); expect(a.close).toHaveBeenCalledOnce(); expect(b.kill).toHaveBeenCalledOnce();
  });
  it("rejects unsupported create parameters before creating resources", async () => {
    const manager = new SandboxManager(); manager.createSandbox = vi.fn();
    expect(await dispatchTool("create_sandbox", { team_id: "unsupported" }, manager)).toHaveProperty("error");
    expect(manager.createSandbox).not.toHaveBeenCalled();
  });
  it("checks remote bytes and refuses a corrupted upload", async () => {
    const manager = new SandboxManager();
    const input = Buffer.from([0, 255, 128]);
    const write = vi.fn();
    manager.getSandbox = vi.fn().mockResolvedValue({ files: { write, readBytes: async () => Buffer.from("corrupt") } });
    const result = await dispatchTool("upload_file", { sandbox_id: "test", path: "/tmp/x", content_base64: input.toString("base64"), sha256: createHash("sha256").update(input).digest("hex") }, manager);
    expect(result.error).toMatch(/remote bytes differ/); expect(write).toHaveBeenCalledOnce();
  });
  it("serializes observed dates and keeps unknown lifetime unknown", () => {
    expect(safeInfo({ started_at: new Date("2026-10-18T00:00:00Z"), timeout: 0, region: "", envd_access_token: "private" })).toMatchObject({ started_at: "2026-10-18T00:00:00.000Z", timeout: null, region: null });
    expect(safeInfo({ envd_access_token: "private" })).not.toHaveProperty("envd_access_token");
  });
});

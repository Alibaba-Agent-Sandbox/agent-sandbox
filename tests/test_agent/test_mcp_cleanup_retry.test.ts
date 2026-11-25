import * as http from "node:http";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SandboxManager, sdk } from "../../src/agent/mcp.js";
import { McpCleanupError } from "../../src/agent/lifecycle_errors.js";
import { createMcpApp, serveMcpApp, SessionStore, time } from "../../src/agent/mcp_http.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function handle(id: string) {
  return { id, kill: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
}
function sdkWith(created: ReturnType<typeof handle>) {
  vi.spyOn(sdk, "loadSandbox").mockResolvedValue({
    create: vi.fn().mockResolvedValue(created), connect: vi.fn().mockResolvedValue(created),
    list: vi.fn(), getInfoById: vi.fn(), setTimeoutById: vi.fn(), killById: vi.fn(),
  });
}
afterEach(() => vi.restoreAllMocks());

it("retains failed owned handles and tries every resource before reporting incomplete cleanup", async () => {
  const manager = new SandboxManager();
  const failed = handle("failed"); const other = handle("other");
  failed.kill.mockRejectedValueOnce(new Error("backend secret must not escape"));
  manager._sandboxes.set(failed.id, failed); manager._sandboxes.set(other.id, other);
  manager._default_sandbox = failed;
  await expect(manager.shutdown()).rejects.toThrow(McpCleanupError);
  expect([...manager._sandboxes.keys()]).toEqual(["failed"]);
  expect(manager._default_sandbox).toBe(failed);
  expect(other.kill).toHaveBeenCalledOnce();
  await expect(manager.createSandbox()).rejects.toMatchObject({ name: "CancelledError" });
  await manager.shutdown();
  expect(failed.kill).toHaveBeenCalledTimes(2);
  expect(other.kill).toHaveBeenCalledOnce();
  expect(manager._sandboxes.size).toBe(0);
});

it("retries only closing borrowed handles, without deleting their remote resource", async () => {
  const borrowed = handle("borrowed"); sdkWith(borrowed);
  const manager = new SandboxManager();
  await manager.getSandbox("borrowed");
  borrowed.close.mockRejectedValueOnce(new Error("close failed"));
  await expect(manager.shutdown()).rejects.toThrow(McpCleanupError);
  expect(manager._sandboxes.get("borrowed")).toBe(borrowed);
  await manager.shutdown();
  expect(borrowed.kill).not.toHaveBeenCalled();
  expect(borrowed.close).toHaveBeenCalledTimes(2);
});

it("retains a late create when shutdown cleanup fails, then permits cleanup retry", async () => {
  const created = handle("late"); created.kill.mockRejectedValueOnce(new Error("timeout"));
  const entered = deferred<void>(); const returned = deferred<typeof created>();
  sdkWith(created);
  vi.spyOn(sdk, "loadSandbox").mockResolvedValue({
    create: async () => { entered.resolve(); return returned.promise; },
    connect: vi.fn(), list: vi.fn(), getInfoById: vi.fn(), setTimeoutById: vi.fn(), killById: vi.fn(),
  });
  const manager = new SandboxManager();
  const creating = manager.createSandbox();
  const creationResult = expect(creating).rejects.toMatchObject({ name: "CancelledError" });
  await entered.promise;
  const stopping = manager.shutdown();
  const stopResult = expect(stopping).rejects.toThrow(McpCleanupError);
  await new Promise<void>(done => setImmediate(done));
  returned.resolve(created);
  await Promise.all([creationResult, stopResult]);
  expect(manager._sandboxes.get("late")).toBe(created);
  await manager.shutdown();
  expect(created.kill).toHaveBeenCalledTimes(2);
});

it("deduplicates concurrent DELETE and expiry cleanup, keeping failures counted against capacity", async () => {
  const store = new SessionStore({ session_ttl_seconds: 1, max_sessions: 1 });
  const [id, server] = await store.createSession();
  const released = deferred<void>();
  const cleanup = vi.spyOn(server, "shutdown").mockImplementation(async () => { await released.promise; throw new Error("failure"); });
  store._sessions.get(id)!.last_access = 0;
  const expired = store.cleanupExpired();
  const deletion = expect(store.destroySession(id)).rejects.toThrow("failure");
  expect(store.getSession(id)).toBeNull();
  released.resolve();
  expect(await expired).toBe(0); await deletion;
  expect(cleanup).toHaveBeenCalledOnce();
  await expect(store.createSession()).rejects.toThrow("limit");
  expect(cleanup).toHaveBeenCalledOnce();
  cleanup.mockResolvedValue(undefined);
  await store.destroySession(id);
  expect(store._sessions.size).toBe(0);
});

it("retries failed expiry only after the next session TTL interval", async () => {
  let now = 10;
  vi.spyOn(time, "monotonic").mockImplementation(() => now);
  const store = new SessionStore({ session_ttl_seconds: 5 });
  const [id, server] = await store.createSession();
  const cleanup = vi.spyOn(server, "shutdown").mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue(undefined);
  now = 15; expect(await store.cleanupExpired()).toBe(0);
  now = 19; expect(await store.cleanupExpired()).toBe(0);
  expect(cleanup).toHaveBeenCalledOnce(); expect(store.isClosing(id)).toBe(true);
  now = 20; expect(await store.cleanupExpired()).toBe(1);
  expect(cleanup).toHaveBeenCalledTimes(2); expect(store._sessions.size).toBe(0);
});

it("server shutdown continues after a failed session and blocks new sessions", async () => {
  const store = new SessionStore();
  const [first, a] = await store.createSession(); const [second, b] = await store.createSession();
  vi.spyOn(a, "shutdown").mockRejectedValueOnce(new Error("failure")).mockResolvedValue(undefined);
  const cleanupB = vi.spyOn(b, "shutdown");
  await expect(store.shutdownAll()).rejects.toThrow(McpCleanupError);
  expect(store._sessions.has(first)).toBe(true); expect(store._sessions.has(second)).toBe(false);
  expect(cleanupB).toHaveBeenCalledOnce();
  await expect(store.createSession()).rejects.toThrow("shutting down");
  await store.shutdownAll(); expect(store._sessions.size).toBe(0);
});

it("real HTTP returns retryable cleanup failure, rejects calls while closing, then terminates the same session", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "abx-mcp-cleanup-"));
  const socketPath = path.join(temporary, "http.sock");
  const app = createMcpApp({ auth_token: "fixture-token" });
  const server = app.createServer();
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  const call = (method: string, id?: string, body?: object) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const request = http.request({ socketPath, path: "/mcp", method, headers: {
      Authorization: "Bearer fixture-token", "Content-Type": "application/json", ...(id ? { "Mcp-Session-Id": id } : {}),
    } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject); request.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const init = await call("POST", undefined, { jsonrpc: "2.0", id: 1, method: "initialize" });
    const id = String(init.headers["mcp-session-id"]);
    const owned = handle("owned"); owned.kill.mockRejectedValueOnce(new Error("private backend detail"));
    app.state.session_store.getSession(id)!._manager._sandboxes.set(owned.id, owned);
    const failed = await call("DELETE", id);
    expect(failed.status).toBe(503); expect(failed.body).toContain("same Mcp-Session-Id");
    expect(failed.body).not.toContain("private backend detail");
    expect((await call("POST", id, { jsonrpc: "2.0", id: 2, method: "tools/list" })).status).toBe(409);
    expect(owned.kill).toHaveBeenCalledOnce();
    const retried = await call("DELETE", id);
    expect(retried.status).toBe(200); expect(JSON.parse(retried.body)).toEqual({ status: "session_terminated" });
    expect(owned.kill).toHaveBeenCalledTimes(2);
    expect((await call("DELETE", id)).status).toBe(404);
  } finally {
    await app.shutdown();
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

it("HTTP listener shutdown rejects both completion promises when cleanup fails", async () => {
  const app = createMcpApp();
  const [id, server] = await app.state.session_store.createSession();
  const cleanup = vi.spyOn(server, "shutdown").mockRejectedValueOnce(new McpCleanupError()).mockResolvedValue(undefined);
  const running = await serveMcpApp(app, {host: "127.0.0.1", port: 0, handleSignals: false, log_level: "error"});
  await expect(running.close()).rejects.toThrow(McpCleanupError);
  await expect(running.closed).rejects.toThrow(McpCleanupError);
  expect(app.state.session_store._sessions.has(id)).toBe(true);
  await app.shutdown();
  expect(cleanup).toHaveBeenCalledTimes(2);
});

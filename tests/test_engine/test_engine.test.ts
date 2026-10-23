import { Sandbox } from "../../src/api/sandbox.js";
/**
 * The engine over real HTTP, SSE and WebSocket against the catalog's cubesandbox plugin and a local E2B-shaped backend.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { ENGINE_PROTOCOL, engineFile, readRecord } from "../../src/engine/discovery.js";
import { startEngine, type EngineHandle } from "../../src/engine/server.js";
import * as installer from "../../src/providers/installer.js";
import { type E2BMock, startE2BMock } from "../_support/e2b_mock.js";
import { useIso } from "../_support/iso.js";
import { TEST_HOST_VERSION, catalogDir } from "../_support/plugins.js";
import { Provider, type ProviderInfra, type TerminalContext } from "../../src/providers/base.js";
import { registerProvider, unregisterProvider } from "../../src/providers/registry.js";
import type { LayeredConfig } from "../../src/transport/config_layers.js";
import { HttpClient } from "../../src/transport/http.js";
import { ApiKeyAuth } from "../../src/transport/auth_contract.js";
import type { SandboxInfo } from "../../src/models/sandbox.js";
import { SandboxProtocol } from "../../src/providers/shared/e2b/sandbox.js";
import { EnvdTokenManager } from "../../src/providers/shared/e2b/auth.js";
import { TerminalSession } from "../../src/providers/shared/e2b/terminal.js";

const iso = useIso();
const here = path.dirname(fileURLToPath(import.meta.url));
const CUBE = catalogDir("cubesandbox");
const haveCatalog = fs.existsSync(path.join(CUBE, "abx-provider.toml"));

describe.skipIf(!haveCatalog)("engine", () => {
  let engine: EngineHandle;
  let mock: E2BMock;
  let base = "";
  let token = "";
  let connection: Record<string, unknown> = {};

  beforeEach(async () => {
    mock = await startE2BMock();
    await installer.install(CUBE, { yes: true, hostVersion: TEST_HOST_VERSION });
    engine = await startEngine({ idle_timeout: 0 });
    base = `http://127.0.0.1:${engine.record.port}`;
    token = engine.record.token;
    connection = { provider: "cubesandbox", provider_options: { base_url: mock.origin, domain: "localhost", proxy: `127.0.0.1:${mock.port}` } };
  });
  afterEach(async () => {
    unregisterProvider("engine-pty-fixture");
    await engine.close();
    await mock.close();
  });

  const conn = (c: Record<string, unknown> = connection): string => Buffer.from(JSON.stringify(c)).toString("base64url");
  async function api(method: string, route: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any; res: Response }> {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "X-Abx-Connection": conn(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.clone().text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, res };
  }

  it("publishes a record and answers health", async () => {
    const record = readRecord();
    expect(record?.protocol).toBe(ENGINE_PROTOCOL);
    expect(record?.port).toBe(engine.record.port);
    expect((fs.statSync(engineFile()).mode & 0o777).toString(8)).toBe("600");
    const health = await api("GET", "/v1/health");
    expect(health.status).toBe(200);
    expect(health.json.protocol).toBe(ENGINE_PROTOCOL);
  });

  it("rejects a missing token, a wrong token, a foreign Host and a browser Origin", async () => {
    expect((await fetch(`${base}/v1/health`)).status).toBe(401);
    expect((await fetch(`${base}/v1/health`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
    expect((await fetch(`${base}/v1/health`, { headers: { Authorization: `Bearer ${token}`, Origin: "http://evil.test" } })).status).toBe(401);
    const status = await new Promise<number>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: engine.record.port, path: "/v1/health", headers: { Host: "foreign.localhost", Authorization: `Bearer ${token}` } }, (r) => resolve(r.statusCode ?? 0));
      req.end();
    });
    expect(status).toBe(401);
  });

  it("keeps application command run distinct from raw shell run", async () => {
    const runCommand = vi.fn(async () => ({value:42,exit_code:0}));
    const sandbox = {runCommand,close:async()=>undefined};
    const connect=vi.spyOn(Sandbox,"connect").mockResolvedValue(sandbox as unknown as Sandbox);
    try {
      const result=await api("POST","/v1/sandboxes/sbx-1/application/commands/run",{arguments:{x:1},server_port:9000});
      expect(result.status).toBe(200);expect(runCommand).toHaveBeenCalledWith("run",{x:1},expect.objectContaining({server_port:9000}));
      expect((await api("POST","/v1/sandboxes/sbx-1/application/commands/run",{arguments:[],unknown:true})).status).toBe(400);
    }finally{connect.mockRestore();}
  });

  it("only one engine runs at a time", async () => {
    await expect(startEngine({ idle_timeout: 0 })).rejects.toThrow("EngineRunning");
  });

  it("creates, runs, streams, moves files, runs code and kills", async () => {
    const created = await api("POST", "/v1/sandboxes", { template: "base", timeout: 60 });
    expect(created.status).toBe(201);
    expect(created.json.sandbox_id).toBe("sbx-1");
    expect(created.json.url).toBe("http://49983-sbx-1.reported.test");
    expect(created.json.info.template).toBe("base");

    const run = await api("POST", "/v1/sandboxes/sbx-1/commands/run", { cmd: "echo hi" });
    expect(run.status).toBe(200);
    expect(run.json).toMatchObject({ stdout: "hi\n", exit_code: 0 });

    const stream = await api("POST", "/v1/sandboxes/sbx-1/commands/stream", { cmd: "echo hi" });
    const text = await stream.res.text();
    expect(stream.res.headers.get("content-type")).toContain("text/event-stream");
    const chunks = text
      .split("\n\n")
      .filter((b) => b.startsWith("data: ") && b !== "data: {}")
      .map((b) => JSON.parse(b.slice(6)));
    expect(chunks.some((c) => c.type === "stdout" && c.data === "hi\n")).toBe(true);
    expect(chunks.some((c) => c.type === "exit" && c.exit_code === 0)).toBe(true);
    expect(text).toContain("event: end");

    const put = await fetch(`${base}/v1/sandboxes/sbx-1/files/content?path=${encodeURIComponent("/tmp/a.bin")}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "X-Abx-Connection": conn() },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(put.status).toBe(200);
    const upload = mock.seen.find((s) => s.url.startsWith("/files?") && s.method === "POST");
    expect(upload?.url).toContain("username=root");
    expect(upload?.body.includes(Buffer.from([1, 2, 3]))).toBe(true);

    const got = await fetch(`${base}/v1/sandboxes/sbx-1/files/content?path=${encodeURIComponent("/tmp/a.bin")}`, {
      headers: { Authorization: `Bearer ${token}`, "X-Abx-Connection": conn() },
    });
    expect(Buffer.from(await got.arrayBuffer()).toString()).toBe("file-bytes");

    const code = await api("POST", "/v1/sandboxes/sbx-1/code/run", { code: "print(42)", mode: "default-context" });
    expect(code.status).toBe(200);
    expect(JSON.stringify(code.json)).toContain("42");

    const killed = await api("DELETE", "/v1/sandboxes/sbx-1");
    expect(killed.status).toBe(200);
    expect(mock.seen.some((s) => s.method === "DELETE" && s.url === "/sandboxes/sbx-1")).toBe(true);
  });

  it("reuses one session across calls and reconnects after a restart", async () => {
    await api("POST", "/v1/sandboxes", { template: "base" });
    mock.seen.length = 0;
    await api("POST", "/v1/sandboxes/sbx-1/commands/run", { cmd: "echo hi" });
    await api("POST", "/v1/sandboxes/sbx-1/commands/run", { cmd: "echo hi" });
    expect(mock.seen.filter((s) => s.url.endsWith("/connect")).length).toBe(0);
    expect((await api("GET", "/v1/health")).json.sessions).toBe(1);

    await engine.close();
    engine = await startEngine({ idle_timeout: 0 });
    base = `http://127.0.0.1:${engine.record.port}`;
    token = engine.record.token;
    const again = await api("POST", "/v1/sandboxes/sbx-1/commands/run", { cmd: "echo hi" });
    expect(again.status).toBe(200);
    expect(mock.seen.filter((s) => s.method === "POST" && s.url.endsWith("/connect")).length).toBe(1);
  });

  it("keeps two connections to the same id apart", async () => {
    await api("POST", "/v1/sandboxes", { template: "base" });
    const other = { ...connection, provider_options: { ...(connection["provider_options"] as object), api_key: "second" } };
    const second = await api("POST", "/v1/sandboxes/sbx-1/commands/run", { cmd: "echo hi" }, { "X-Abx-Connection": conn(other) });
    expect(second.json).toMatchObject({ stdout: "hi\n" });
    expect((await api("GET", "/v1/health")).json.sessions).toBe(2);
  });

  it("maps errors to status, type and code", async () => {
    const missing = await api("GET", "/v1/nope");
    expect(missing.status).toBe(404);
    const denied = await api("POST", "/v1/sandboxes/sbx-1/commands/run", { cmd: "ls" }, { "X-Abx-Connection": conn({ provider: "no-such-provider" }) });
    expect(denied.status).toBe(404);
    expect(denied.json.error.code).toBe("E8001");
    await api("POST", "/v1/sandboxes", { template: "base" });
    const unsupported = await api("GET", "/v1/sandboxes/sbx-1/processes");
    expect(unsupported.status).toBe(501);
    expect(unsupported.json.error).toMatchObject({ type: "ProviderFeatureNotSupportedError", code: "E8004" });
    expect((await api("POST", "/v1/sandboxes/sbx-1/commands/run", { cmd: "x" }, { "X-Abx-Connection": "!!!" })).status).toBe(400);
  });

  it("lists, reports a port url and resumes", async () => {
    await api("POST", "/v1/sandboxes", { template: "base" });
    const port = await api("GET", "/v1/sandboxes/sbx-1/ports/8080/url");
    expect(port.status).toBe(200);
    expect(port.json.url).toContain("8080-sbx-1");
    expect((await api("POST", "/v1/sandboxes/sbx-1/resume", {})).status).toBe(200);
    expect(mock.seen.some((s) => s.url === "/sandboxes/sbx-1/resume")).toBe(true);
  });

  it("shuts down on request and removes its record", async () => {
    const res = await api("POST", "/v1/shutdown", {});
    expect(res.status).toBe(200);
    await engine.closed;
    expect(readRecord()).toBeNull();
  });

  it("exits after the idle timeout", async () => {
    await engine.close();
    engine = await startEngine({ idle_timeout: 0.2 });
    await Promise.race([engine.closed, new Promise((_, rej) => setTimeout(() => rej(new Error("did not exit")), 8000))]);
    expect(readRecord()).toBeNull();
  });

  it("bridges the terminal WebSocket to the sandbox PTY", async () => {
    // Cube declares no PTY. Exercise the generic bridge with an explicit wire fixture.
    class PtyProvider extends Provider {
      readonly id = "engine-pty-fixture";
      override features = new Set(["sandbox.lifecycle", "pty"]);
      override inherit = new Set(["sandbox_base_url"]);
      override endpointDefaults = { sandbox_base_url: mock.origin };
      override resolveSessionUrl() { return mock.origin; }
      override createSessionAuth(info: SandboxInfo) { return new EnvdTokenManager(info.envd_access_token, info.sandbox_id); }
      override async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
        const auth = new ApiKeyAuth("placeholder-key");
        const http = new HttpClient(config.toTransportConfig(), auth);
        return { config, auth, http_client: http, sandbox_protocol: new SandboxProtocol(http),
          process_protocol: null, filesystem_protocol: null, code_interpreter_protocol: null, close: () => http.close() };
      }
      override async openTerminal(context: TerminalContext, options: { cols: number; rows: number; shell: string }) {
        return TerminalSession.create(context.url, context.token, context.config, options);
      }
    }
    registerProvider(new PtyProvider());
    connection = { provider: "engine-pty-fixture" };
    await api("POST", "/v1/sandboxes", { template: "base" });
    const ws = new WebSocket(`ws://127.0.0.1:${engine.record.port}/v1/sandboxes/sbx-1/terminal?cols=100&rows=30`, {
      headers: { Authorization: `Bearer ${token}`, "X-Abx-Connection": conn() },
    });
    const received: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("unexpected-response", (_r, res) => reject(new Error(`${res.statusCode} ${res.statusMessage}`)));
      ws.on("error", reject);
      ws.on("open", () => ws.send("ls\n"));
      ws.on("message", (data) => {
        received.push(data.toString());
        if (received.includes("ls\n")) resolve();
      });
    });
    ws.close();
    expect(received.some((m) => m.includes('"resize"') && m.includes("100"))).toBe(true);
    expect(mock.seen.some((s) => s.method === "UPGRADE" && s.headers["host"] === new URL(mock.origin).host)).toBe(true);
  });

  it("requires the token on the terminal WebSocket", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${engine.record.port}/v1/sandboxes/sbx-1/terminal`);
    const code = await new Promise<number>((resolve) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => undefined);
    });
    expect(code).toBe(401);
  });
});

/**
 * STDIO process checks for the MCP server.
 *
 * These start the real `abx mcp start` process (`src/bin/abx.ts`). The sandbox
 * API is a local stub, so the tests do not create a cloud sandbox.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ENTRY = fileURLToPath(new URL("../../src/bin/abx.ts", import.meta.url));

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Hold the sandbox API call long enough to prove ping is not blocked. */
function slowServer(delayMs = 800): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      setTimeout(() => {
        const body = '{"message":"unavailable"}';
        res.writeHead(500, {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        });
        res.end(body);
      }, delayMs);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

interface Mcp {
  proc: ChildProcessWithoutNullStreams;
  lines: string[];
  waiters: Array<() => void>;
  stderr: string[];
  runtime: string;
}

function watchMcp(proc: ChildProcessWithoutNullStreams, runtime: string): Mcp {
  const mcp: Mcp = { proc, lines: [], waiters: [], stderr: [], runtime };
  let buffered = "";
  proc.stdout.setEncoding("utf-8");
  proc.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    let at: number;
    while ((at = buffered.indexOf("\n")) !== -1) {
      mcp.lines.push(buffered.slice(0, at));
      buffered = buffered.slice(at + 1);
    }
    for (const wake of mcp.waiters.splice(0)) wake();
  });
  proc.stdout.on("end", () => {
    for (const wake of mcp.waiters.splice(0)) wake();
  });
  proc.stderr.setEncoding("utf-8");
  proc.stderr.on("data", (chunk: string) => mcp.stderr.push(chunk));
  return mcp;
}

function startMcp(apiUrl: string): Mcp {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "abx-mcp-stdio-"));
  const env = { ...process.env };
  env.ABX_MCP_RUNTIME_DIR = runtime;
  env.HOME = runtime;
  env.USERPROFILE = runtime;
  env.ABX_NO_KEYCHAIN = "1";
  const proc = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      ENTRY,
      "mcp",
      "start",
      "--api-key",
      "stdio-e2e-placeholder",
      "--api-url",
      apiUrl,
      "--template",
      "python-hello",
    ],
    { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  return watchMcp(proc, runtime);
}

function send(mcp: Mcp, payload: Record<string, unknown>): void {
  mcp.proc.stdin.write(`${JSON.stringify(payload)}\n`);
}

async function readline(mcp: Mcp, timeoutMs = 8000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (mcp.lines.length === 0) {
    if (mcp.proc.exitCode !== null) {
      throw new Error(`EOF on MCP stdout\n${mcp.stderr.join("")}`);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      mcp.proc.kill();
      throw new Error("timed out waiting for MCP stdout");
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, remaining);
      mcp.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  const parsed = JSON.parse(mcp.lines.shift() as string);
  expect(typeof parsed).toBe("object");
  return parsed;
}

async function stop(mcp: Mcp): Promise<void> {
  mcp.proc.stdin.end();
  const exited = new Promise<boolean>((resolve) => {
    if (mcp.proc.exitCode !== null) resolve(true);
    mcp.proc.once("exit", () => resolve(true));
  });
  const timedOut = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000));
  if (!(await Promise.race([exited, timedOut]))) {
    mcp.proc.kill("SIGKILL");
    await new Promise<void>((resolve) => mcp.proc.once("exit", () => resolve()));
  }
  fs.rmSync(mcp.runtime, { recursive: true, force: true });
}

async function initialize(mcp: Mcp): Promise<void> {
  send(mcp, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "0" },
    },
  });
  const response = await readline(mcp, 20000);
  expect(response.result.protocolVersion).toBe("2024-11-05");
}

describe("TestStdioProcess", () => {
  // The real STDIO server stays up for the calls an agent actually sends.

  it("test_large_tool_call_does_not_kill_the_process", async () => {
    const mcp = startMcp("http://127.0.0.1:9");
    try {
      await initialize(mcp);
      send(mcp, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "write_file",
          arguments: { path: "/tmp/big.txt", content: "x".repeat(70_000) },
        },
      });
      const response = await readline(mcp, 10000);
      expect(response.id).toBe(2);
      expect(mcp.proc.exitCode).toBeNull();
      const text = response.result.content[0].text as string;
      expect(text).not.toContain("mozilla.org");
    } finally {
      await stop(mcp);
    }
  });

  it("test_ping_is_answered_while_a_tool_call_is_in_flight", async () => {
    const server = await slowServer();
    const port = (server.address() as AddressInfo).port;
    const mcp = startMcp(`http://127.0.0.1:${port}`);
    try {
      await initialize(mcp);
      const started = performance.now();
      send(mcp, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "run_code", arguments: { code: "print(1)" } },
      });
      send(mcp, { jsonrpc: "2.0", id: 3, method: "ping", params: {} });
      const first = await readline(mcp, 5000);
      const pingAt = (performance.now() - started) / 1000;
      const second = await readline(mcp, 8000);
      expect(first.id).toBe(3);
      expect(first.result).toEqual({});
      // Ordering is the contract; the bound only catches a ping that was
      // held for most of the tool call (the stub answers after 0.8 s).
      expect(pingAt).toBeLessThan(0.75);
      expect(second.id).toBe(2);
      expect(mcp.proc.exitCode).toBeNull();
    } finally {
      await stop(mcp);
      server.closeAllConnections();
      server.close();
    }
  });

  it("test_sdk_is_imported_before_the_first_request_is_served", async () => {
    // A cold lazy import inside the first tool call would block ping.
    // Importing the sandbox module takes hundreds of milliseconds on a busy
    // host and runs on the event loop. The server must pay it at startup, so
    // a ping answered before any tool call already sees it loaded.
    const probe = [
      'import { findSourceMap } from "node:module";',
      'import { SandboxMCPServer } from "./src/agent/mcp.ts";',
      'import { main } from "./src/agent/mcp_main.ts";',
      'const sandboxUrl = new URL("./src/api/sandbox.ts", import.meta.url).href;',
      'if (findSourceMap(sandboxUrl) !== undefined) throw new Error("sandbox module loaded before startup");',
      "SandboxMCPServer.prototype._handlePing = async function () {",
      "  return { loaded: findSourceMap(sandboxUrl) !== undefined };",
      "};",
      "await main();",
    ].join("\n");
    const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "abx-mcp-stdio-"));
    const env = { ...process.env };
    env.ABX_SANDBOX_API_KEY = "stdio-e2e-placeholder";
    env.ABX_MCP_RUNTIME_DIR = runtime;
    env.HOME = runtime;
    env.USERPROFILE = runtime;
    env.ABX_NO_KEYCHAIN = "1";
    const proc = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", probe], {
      cwd: ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const mcp = watchMcp(proc, runtime);
    try {
      send(mcp, { jsonrpc: "2.0", id: 1, method: "ping", params: {} });
      const response = await readline(mcp, 15000);
      expect(response.result).toEqual({ loaded: true });
    } finally {
      await stop(mcp);
    }
  });
});

/** Extra branch coverage for `abx mcp` (JSON round-trip fidelity, state file, HTTP server lifecycle). */

import "../_support/isolatedHome.js";

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as mcpMod from "../../src/cli/commands/mcp.js";
import { cli } from "../../src/cli/main.js";
import { useIsolatedEnv } from "../_support/env.js";
import { CliRunner } from "../helpers/cliRunner.js";

const iso = useIsolatedEnv();
const originalIdeMap = mcpMod._IDE_CONFIG_MAP;
const originalSeams = { ...mcpMod.mcpSeams };

afterEach(() => {
  vi.restoreAllMocks();
  mcpMod._setIdeConfigMap(originalIdeMap);
  Object.assign(mcpMod.mcpSeams, originalSeams);
});

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function cursorOnly(configPath: string): void {
  mcpMod._setIdeConfigMap({ cursor: () => configPath });
}

async function install(configPath: string): Promise<{ exit_code: number; output: string }> {
  cursorOnly(configPath);
  vi.spyOn(mcpMod, "_readApiKey").mockReturnValue("k");
  return new CliRunner().invoke(cli, ["mcp", "install", "--target", "cursor"]);
}

describe("TestMcpInstallJsonFidelity", () => {
  it("keeps existing floats, big ints, unicode and key order when merging", async () => {
    const configPath = path.join(iso.tmp_path, "mcp.json");
    fs.writeFileSync(
      configPath,
      '{"b": 1e5, "a": 12345678901234567890, "mcpServers": {"other": {"command": "x"}}, "u": "é", "10": 1, "2": 2}',
      "utf8",
    );
    const result = await install(configPath);
    expect(result.exit_code, result.output).toBe(0);
    const text = fs.readFileSync(configPath, "utf8");
    expect(text).toContain('"b": 100000.0');
    expect(text).toContain('"a": 12345678901234567890');
    expect(text).toContain('"u": "é"');
    expect(text.indexOf('"10"')).toBeLessThan(text.indexOf('"2"'));
    expect(text).toContain('"other"');
    expect(text).toContain('"agent-sandbox"');
  });

  it("rejects a config whose top level is not an object", async () => {
    const configPath = path.join(iso.tmp_path, "mcp.json");
    fs.writeFileSync(configPath, "[1, 2]", "utf8");
    const result = await install(configPath);
    expect(result.exit_code).not.toBe(0);
    expect(fs.readFileSync(configPath, "utf8")).toBe("[1, 2]");
  });

  it("rejects invalid JSON without touching the file", async () => {
    const configPath = path.join(iso.tmp_path, "mcp.json");
    fs.writeFileSync(configPath, "{not json", "utf8");
    const result = await install(configPath);
    expect(result.exit_code).not.toBe(0);
    expect(fs.readFileSync(configPath, "utf8")).toBe("{not json");
  });

  it("rejects invalid UTF-8 with the CPython codec message", async () => {
    const configPath = path.join(iso.tmp_path, "mcp.json");
    fs.writeFileSync(configPath, Buffer.from([0x7b, 0xff, 0x7d]));
    const result = await install(configPath);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("can't decode byte 0xff in position 1");
  });
});

describe("TestMcpStateFile", () => {
  it("status ignores and stop cleans a stale state file", async () => {
    const stateFile = mcpMod._serverStatePath();
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ pid: 999999, mode: "http" }), "utf8");
    vi.spyOn(mcpMod, "_pidAlive").mockReturnValue(false);
    const result = await new CliRunner().invoke(cli, ["mcp", "stop"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("MCP server is not running.");
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it("a corrupt state file counts as no server", () => {
    const stateFile = mcpMod._serverStatePath();
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, "{oops", "utf8");
    expect(mcpMod._readServerState()).toBeNull();
    expect(mcpMod._runningServer()).toBeNull();
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function runAbx(args: string[], runtime: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/bin/abx.ts", ...args], {
      cwd: CLI_ROOT,
      env: { ...process.env, HOME: runtime, USERPROFILE: runtime, ABX_MCP_RUNTIME_DIR: runtime, ABX_NO_KEYCHAIN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("TestMcpStartHttpLifecycle", () => {
  it("exits 3 with the uvicorn bind error when the port is taken and frees the pid file", async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
    const runtime = fs.mkdtempSync(path.join(iso.tmp_path, "run-"));
    try {
      const result = await runAbx(["mcp", "start", "--http", "--port", String(port), "--api-key", "k"], runtime);
      expect(result.code).toBe(3);
      expect(result.stderr).toContain(
        `ERROR:    [Errno 98] error while attempting to bind on address ('127.0.0.1', ${port}): address already in use`,
      );
      expect(result.stderr).toContain("INFO:     Application shutdown complete.");
      expect(fs.existsSync(path.join(runtime, "mcp-server.json"))).toBe(false);
    } finally {
      blocker.close();
    }
  }, 60_000);

  it("serves requests, logs access lines on stdout and dies by SIGTERM leaving the pid file", async () => {
    const port = await freePort();
    const runtime = fs.mkdtempSync(path.join(iso.tmp_path, "run-"));
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/bin/abx.ts", "mcp", "start", "--http", "--port", String(port), "--api-key", "k"],
      {
        cwd: CLI_ROOT,
        env: { ...process.env, HOME: runtime, USERPROFILE: runtime, ABX_MCP_RUNTIME_DIR: runtime, ABX_NO_KEYCHAIN: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.on("close", (code, signal) => resolve({ code, signal })),
    );
    const deadline = Date.now() + 40_000;
    while (!stderr.includes("Uvicorn running on") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    child.kill("SIGTERM");
    const { signal } = await closed;
    expect(signal).toBe("SIGTERM");
    expect(stdout).toMatch(/INFO: {5}127\.0\.0\.1:\d+ - "GET \/health HTTP\/1\.1" 200 OK/);
    expect(stderr).toContain("INFO:     Finished server process");
    expect(fs.existsSync(path.join(runtime, "mcp-server.json"))).toBe(true);
  }, 90_000);
});

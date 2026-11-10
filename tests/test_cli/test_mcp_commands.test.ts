/** Tests for MCP CLI commands: install, start, status (port of `tests/test_cli/test_mcp_commands.py`). */

import "../_support/isolatedHome.js";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as agentMcp from "../../src/agent/mcp.js";
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

function runner(): CliRunner {
  return new CliRunner();
}

function tmpPath(): string {
  return iso.tmp_path;
}

function patchIdeMap(configPath: string, onlyCursor = false): void {
  mcpMod._setIdeConfigMap(
    onlyCursor
      ? { cursor: () => configPath }
      : { cursor: () => configPath, claude: () => configPath, vscode: () => configPath },
  );
}

function patchApiKey(value: string | null): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(mcpMod, "_readApiKey").mockReturnValue(value);
}

const readJson = (file: string): any => JSON.parse(fs.readFileSync(file, "utf8"));

// ---------------------------------------------------------------------------
// install command
// ---------------------------------------------------------------------------

describe("TestMcpInstall", () => {
  // Test `abx mcp install` command.

  it("test_install_cursor", async () => {
    const configPath = path.join(tmpPath(), ".cursor", "mcp.json");
    patchIdeMap(configPath);
    patchApiKey("test-key-1234");
    const result = await runner().invoke(cli, ["mcp", "install", "--target", "cursor"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.statSync(configPath).isFile()).toBe(true);
    const config = readJson(configPath);
    expect(config).toHaveProperty("mcpServers");
    expect(config.mcpServers).toHaveProperty("agent-sandbox");
    const srv = config.mcpServers["agent-sandbox"];
    expect(srv.args.slice(-2)).toEqual(["mcp", "start"]);
    expect(srv.command).toBeTruthy();
    expect(srv.env ?? {}).not.toHaveProperty("ABX_SANDBOX_API_KEY");
  });

  it("test_install_claude", async () => {
    const configPath = path.join(tmpPath(), "claude", "claude_desktop_config.json");
    patchIdeMap(configPath);
    patchApiKey("claude-key");
    const result = await runner().invoke(cli, ["mcp", "install", "--target", "claude"]);
    expect(result.exit_code, result.output).toBe(0);
    const config = readJson(configPath);
    expect(config).toHaveProperty("mcpServers");
    expect(config.mcpServers).toHaveProperty("agent-sandbox");
  });

  it("test_install_vscode", async () => {
    const configPath = path.join(tmpPath(), ".vscode", "mcp.json");
    patchIdeMap(configPath);
    patchApiKey("vsc-key");
    const result = await runner().invoke(cli, ["mcp", "install", "--target", "vscode"]);
    expect(result.exit_code, result.output).toBe(0);
    const config = readJson(configPath);
    expect(config).toHaveProperty("servers");
    const srv = config.servers["agent-sandbox"];
    expect(srv.type).toBe("stdio");
    expect(srv.args.slice(-2)).toEqual(["mcp", "start"]);
    expect(srv.env ?? {}).not.toHaveProperty("ABX_SANDBOX_API_KEY");
  });

  it("test_install_refuses_to_overwrite_jsonc", async () => {
    const configPath = path.join(tmpPath(), ".cursor", "mcp.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const original = '{ // keep-me\n  "editor.fontSize": 14,\n}\n';
    fs.writeFileSync(configPath, original);
    patchIdeMap(configPath, true);
    patchApiKey("k");
    const result = await runner().invoke(cli, ["mcp", "install", "--target", "cursor"]);
    expect(result.exit_code).not.toBe(0);
    expect(fs.readFileSync(configPath, "utf8")).toBe(original);
    expect(result.output).toContain("not strict JSON");
  });

  it("test_install_merges_existing_config", async () => {
    const configPath = path.join(tmpPath(), ".cursor", "mcp.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { "other-server": { command: "other" } } }));
    patchIdeMap(configPath);
    patchApiKey("key");
    const result = await runner().invoke(cli, ["mcp", "install", "--target", "cursor"]);
    expect(result.exit_code).toBe(0);
    const config = readJson(configPath);
    // Both servers should be present
    expect(config.mcpServers).toHaveProperty("other-server");
    expect(config.mcpServers).toHaveProperty("agent-sandbox");
  });

  it("test_install_without_api_key", async () => {
    const configPath = path.join(tmpPath(), ".cursor", "mcp.json");
    patchIdeMap(configPath);
    patchApiKey(null);
    const result = await runner().invoke(cli, ["mcp", "install", "--target", "cursor"]);
    expect(result.exit_code).toBe(0);
    const config = readJson(configPath);
    const srv = config.mcpServers["agent-sandbox"];
    // No env block if no key
    expect(!("env" in srv) || !("ABX_SANDBOX_API_KEY" in (srv.env ?? {}))).toBe(true);
  });

  it("test_install_requires_target", async () => {
    const result = await runner().invoke(cli, ["mcp", "install"]);
    expect(result.exit_code).not.toBe(0);
  });

  it("test_install_shows_tool_names", async () => {
    const configPath = path.join(tmpPath(), ".cursor", "mcp.json");
    patchIdeMap(configPath);
    patchApiKey("k");
    const result = await runner().invoke(cli, ["mcp", "install", "--target", "cursor"]);
    expect(result.output).toContain("create_sandbox");
    expect(result.output).toContain("run_code");
    expect(result.output).toContain("kill_sandbox");
  });
});

// ---------------------------------------------------------------------------
// status command
// ---------------------------------------------------------------------------

describe("TestMcpStatus", () => {
  // Test `abx mcp status` command.

  it("test_status_json", async () => {
    patchApiKey("test-key");
    const result = await runner().invoke(cli, ["--json", "mcp", "status"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data.server).toBe("agent-sandbox");
    expect(data.tools_count).toBe(21);
    expect(data.auth_configured).toBe(true);
  });

  it("test_status_no_auth", async () => {
    patchApiKey(null);
    const result = await runner().invoke(cli, ["--json", "mcp", "status"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data.auth_configured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// start command (basic test: we don't actually run the server)
// ---------------------------------------------------------------------------

function fakeServer(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(agentMcp, "SandboxMCPServer").mockImplementation(function (this: unknown) {
    return { run: vi.fn(async () => undefined) } as never;
  } as never);
}

describe("TestMcpStart", () => {
  // Test `abx mcp start` command options.

  it("test_start_help", async () => {
    // start --help should describe logs, HTTP, background, and stop.
    const result = await runner().invoke(cli, ["mcp", "start", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("--http");
    expect(result.output).toContain("--background");
    expect(result.output).toContain("abx mcp stop");
  });

  it("test_stdio_banner_hides_the_api_key", async () => {
    // Foreground STDIO prints configuration to stderr and never the secret.
    iso.monkeypatch.setenv("ABX_MCP_RUNTIME_DIR", tmpPath());
    fakeServer();
    const result = await runner().invoke(cli, ["mcp", "start", "--api-key", "super-secret-key", "--template", "python-hello"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Agent Sandbox MCP server");
    expect(result.output).toContain("python-hello");
    expect(result.output).toContain("configured");
    expect(result.output).toContain("Waiting for JSON-RPC on stdin");
    expect(result.output).toContain("abx mcp stop");
    expect(result.output).not.toContain("super-secret-key");
  });

  it("test_quiet_suppresses_the_banner", async () => {
    iso.monkeypatch.setenv("ABX_MCP_RUNTIME_DIR", tmpPath());
    fakeServer();
    const result = await runner().invoke(cli, ["--quiet", "mcp", "start", "--api-key", "k"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("Agent Sandbox MCP server");
  });

  it("test_start_refuses_a_live_server", async () => {
    iso.monkeypatch.setenv("ABX_MCP_RUNTIME_DIR", tmpPath());
    const proc: ChildProcess = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    try {
      fs.writeFileSync(path.join(tmpPath(), "mcp-server.json"), JSON.stringify({ pid: proc.pid, mode: "stdio" }));
      const result = await runner().invoke(cli, ["mcp", "start"]);
      expect(result.exit_code).not.toBe(0);
      expect(result.output).toContain("already running");
    } finally {
      proc.kill("SIGKILL");
      await new Promise<void>((resolve) => proc.once("exit", () => resolve()));
    }
  });

  it("test_non_loopback_http_requires_a_token", async () => {
    iso.monkeypatch.setenv("ABX_MCP_RUNTIME_DIR", tmpPath());
    iso.monkeypatch.delenv("ABX_MCP_AUTH_TOKEN");
    const result = await runner().invoke(cli, ["mcp", "start", "--http", "--host", "0.0.0.0", "--auth-token", ""]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("auth-token");
  });

  it("test_background_detaches_http_without_putting_secrets_on_argv", async () => {
    iso.monkeypatch.setenv("ABX_MCP_RUNTIME_DIR", tmpPath());

    const popen = vi.fn(async (command: string[], opts: { env: Record<string, string>; logFd: number }) => {
      expect(command).toContain("--http");
      expect(command).not.toContain("--api-key");
      expect(command).not.toContain("--auth-token");
      expect(opts.env["ABX_SANDBOX_API_KEY"]).toBe("super-secret-key");
      expect(opts.env["ABX_MCP_AUTH_TOKEN"]).toBe("bearer-token");
      fs.writeFileSync(path.join(tmpPath(), "mcp-server.json"), JSON.stringify({ pid: 424242, mode: "http" }));
      return { pid: 424242, poll: () => null };
    });
    mcpMod.mcpSeams.popen = popen;
    const result = await runner().invoke(cli, [
      "mcp",
      "start",
      "--background",
      "--port",
      "9011",
      "--api-key",
      "super-secret-key",
      "--auth-token",
      "bearer-token",
    ]);
    expect(result.exit_code, result.output).toBe(0);
    expect(popen).toHaveBeenCalledOnce();
    expect(result.output).toContain("424242");
    expect(result.output).toContain("9011");
    expect(result.output).toContain("abx mcp stop");
    expect(result.output).not.toContain("super-secret-key");
    expect(result.output).not.toContain("bearer-token");
  });

  it("test_stop_signals_the_recorded_pid", async () => {
    iso.monkeypatch.setenv("ABX_MCP_RUNTIME_DIR", tmpPath());
    fs.writeFileSync(path.join(tmpPath(), "mcp-server.json"), JSON.stringify({ pid: 4242, mode: "http" }));
    const alive = { value: true };
    const sent: Array<[number, NodeJS.Signals | number]> = [];

    vi.spyOn(mcpMod, "_pidAlive").mockImplementation((pid: number) => pid === 4242 && alive.value);
    mcpMod.mcpSeams.kill = (pid, sig) => {
      sent.push([pid, sig]);
      alive.value = false;
    };
    const result = await runner().invoke(cli, ["mcp", "stop"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(sent).toEqual([[4242, "SIGTERM"]]);
    expect(result.output.toLowerCase()).toContain("stopped");
    expect(fs.existsSync(path.join(tmpPath(), "mcp-server.json"))).toBe(false);
  });

  it("test_stop_when_nothing_is_running", async () => {
    iso.monkeypatch.setenv("ABX_MCP_RUNTIME_DIR", tmpPath());
    const result = await runner().invoke(cli, ["mcp", "stop"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("not running");
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

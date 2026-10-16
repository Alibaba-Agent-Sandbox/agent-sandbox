/** Tests for MCP CLI commands: install, start, status, deploy (port of `tests/test_cli/test_mcp_commands.py`). */

import "../_support/isolatedHome.js";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as yamlParse } from "yaml";

import * as agentMcp from "../../src/agent/mcp.js";
import * as mcpMod from "../../src/cli/commands/mcp.js";
import { cli } from "../../src/cli/main.js";
import * as region from "../../src/cli/region.js";
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
    expect(srv.env.ABX_SANDBOX_API_KEY).toBe("test-key-1234");
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
    expect(data.tools_count).toBe(7);
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

// ---------------------------------------------------------------------------
// deploy command
// ---------------------------------------------------------------------------

describe("TestMcpDeploy", () => {
  // Test `abx mcp deploy` command.

  it("test_deploy_help", async () => {
    // deploy --help should work.
    const result = await runner().invoke(cli, ["mcp", "deploy", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.includes("FC") || result.output.includes("Streamable HTTP")).toBe(true);
    expect(result.output).toContain("--name");
    expect(result.output).toContain("--generate-token");
  });

  it("test_deploy_output_dir", async () => {
    // deploy --output-dir writes artifact to local directory.
    const out = path.join(tmpPath(), "artifact");
    patchApiKey("test-api-key");
    // region now falls back to the shared resolution chain (config/env/default); pin it for determinism.
    vi.spyOn(region, "resolveRegion").mockReturnValue("cn-hangzhou");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--generate-token"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(out, "requirements.txt"), "utf8")).toBe(
      "agent-sandbox-client[mcp]\nuvicorn>=0.29\n",
    );
    expect(fs.statSync(path.join(out, "app.py")).isFile()).toBe(true);
    expect(fs.readFileSync(path.join(out, "app.py"), "utf8")).toContain("require_auth_token");
    expect(fs.statSync(path.join(out, "config.yaml")).isFile()).toBe(true);
    // Verify config.yaml content
    const cfg = yamlParse(fs.readFileSync(path.join(out, "config.yaml"), "utf8"));
    expect(cfg.function_name).toBe("agent-sandbox-mcp");
    expect(cfg.region).toBe("cn-hangzhou");
    expect(cfg.memory).toBe(512);
    expect(cfg.environment_variables).toHaveProperty("ABX_SANDBOX_API_KEY");
    expect(cfg.environment_variables).toHaveProperty("ABX_MCP_AUTH_TOKEN");
  });

  it("test_deploy_custom_name_region", async () => {
    // deploy with custom --name and --region.
    const out = path.join(tmpPath(), "artifact");
    patchApiKey("k");
    const result = await runner().invoke(cli, [
      "mcp",
      "deploy",
      "--output-dir",
      out,
      "--name",
      "my-mcp-fn",
      "--region",
      "cn-shanghai",
      "--template",
      "python-base",
      "--memory",
      "1024",
      "--timeout",
      "300",
      "--generate-token",
    ]);
    expect(result.exit_code, result.output).toBe(0);
    const cfg = yamlParse(fs.readFileSync(path.join(out, "config.yaml"), "utf8"));
    expect(cfg.function_name).toBe("my-mcp-fn");
    expect(cfg.region).toBe("cn-shanghai");
    expect(cfg.memory).toBe(1024);
    expect(cfg.timeout).toBe(300);
    expect(cfg.environment_variables.ABX_DEFAULT_TEMPLATE).toBe("python-base");
    expect(cfg.environment_variables.ALIBABA_CLOUD_REGION_ID).toBe("cn-shanghai");
    expect(cfg.environment_variables.ABX_MCP_AUTH_TOKEN).toBeTruthy();
  });

  it("test_deploy_auth_token_file", async () => {
    // deploy --auth-token-file reads token from file.
    const out = path.join(tmpPath(), "artifact");
    const tokenFile = path.join(tmpPath(), "token.txt");
    fs.writeFileSync(tokenFile, "my-fixed-token-value\n");
    patchApiKey("k");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--auth-token-file", tokenFile]);
    expect(result.exit_code, result.output).toBe(0);
    const cfg = yamlParse(fs.readFileSync(path.join(out, "config.yaml"), "utf8"));
    expect(cfg.environment_variables.ABX_MCP_AUTH_TOKEN).toBe("my-fixed-token-value");
    expect(result.output).not.toContain("my-fixed-token-value");
    expect(result.output).toContain("Bearer <BEARER_TOKEN>");
  });

  it("test_deploy_empty_auth_token_file_is_refused", async () => {
    // An empty token file must not produce an open or fail-closed artifact.
    const out = path.join(tmpPath(), "artifact");
    const tokenFile = path.join(tmpPath(), "token.txt");
    fs.writeFileSync(tokenFile, "  \n");
    patchApiKey("k");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--auth-token-file", tokenFile]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("non-empty");
    expect(fs.existsSync(path.join(out, "config.yaml"))).toBe(false);
  });

  it("test_deploy_missing_token_is_refused", async () => {
    // Omitting the Bearer token must not disable client authentication.
    const out = path.join(tmpPath(), "artifact");
    patchApiKey("k");
    iso.monkeypatch.setenv("ABX_MCP_AUTH_TOKEN", "");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("non-empty");
    expect(fs.existsSync(path.join(out, "config.yaml"))).toBe(false);
  });

  it("test_deploy_generate_token", async () => {
    // deploy --generate-token produces a random token.
    const out = path.join(tmpPath(), "artifact");
    patchApiKey("k");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--generate-token"]);
    expect(result.exit_code, result.output).toBe(0);
    const cfg = yamlParse(fs.readFileSync(path.join(out, "config.yaml"), "utf8"));
    const token = cfg.environment_variables.ABX_MCP_AUTH_TOKEN ?? "";
    expect(token.length).toBeGreaterThan(16); // urlsafe_b64 tokens are long
  });

  it("test_deploy_no_api_key_warning", async () => {
    // deploy without API key shows warning.
    const out = path.join(tmpPath(), "artifact");
    patchApiKey(null);
    iso.monkeypatch.delenv("ABX_SANDBOX_API_KEY");
    iso.monkeypatch.delenv("E2B_API_KEY");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--generate-token"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("ABX_SANDBOX_API_KEY");
  });

  it("test_deploy_explicit_api_key", async () => {
    // An explicit --api-key takes precedence over stored configuration.
    const out = path.join(tmpPath(), "artifact");
    const readApiKey = patchApiKey(null);
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--api-key", "cli-api-key", "--generate-token"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(readApiKey).not.toHaveBeenCalled();
    const cfg = yamlParse(fs.readFileSync(path.join(out, "config.yaml"), "utf8"));
    expect(cfg.environment_variables.ABX_SANDBOX_API_KEY).toBe("cli-api-key");
  });

  it("test_deploy_session_affinity_flag", async () => {
    // deploy --enable-session-affinity is reflected in config.
    const out = path.join(tmpPath(), "artifact");
    patchApiKey("k");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--enable-session-affinity", "--generate-token"]);
    expect(result.exit_code, result.output).toBe(0);
    const cfg = yamlParse(fs.readFileSync(path.join(out, "config.yaml"), "utf8"));
    expect(cfg.http_trigger.enable_session_affinity).toBe(true);
  });

  it("test_deploy_no_session_affinity_flag", async () => {
    // deploy --no-session-affinity disables affinity in config.
    const out = path.join(tmpPath(), "artifact");
    patchApiKey("k");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--no-session-affinity", "--generate-token"]);

    expect(result.exit_code, result.output).toBe(0);
    const cfg = yamlParse(fs.readFileSync(path.join(out, "config.yaml"), "utf8"));
    expect(cfg.http_trigger.enable_session_affinity).toBe(false);
  });

  it("test_deploy_custom_domain", async () => {
    // deploy --custom-domain is reflected in config.
    const out = path.join(tmpPath(), "artifact");
    patchApiKey("k");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--custom-domain", "mcp.example.com", "--generate-token"]);
    expect(result.exit_code, result.output).toBe(0);
    const cfg = yamlParse(fs.readFileSync(path.join(out, "config.yaml"), "utf8"));
    expect(cfg.custom_domain).toBe("mcp.example.com");
  });

  it("test_deploy_without_output_dir", async () => {
    // deploy without --output-dir generates artifact to temp dir.
    patchApiKey("k");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--generate-token"]);
    // Should succeed even without output-dir
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output.toLowerCase().includes("artifact") || result.output.toLowerCase().includes("deploy")).toBe(true);
    const m = /FC deployment artifact written to (\S+)/.exec(result.output);
    if (m) fs.rmSync(m[1] as string, { recursive: true, force: true });
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

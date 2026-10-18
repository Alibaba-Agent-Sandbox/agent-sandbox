/**
 * Tests for command-level `--region` options and the unified priority.
 *
 * Covers the region-as-command-option design (task 159):
 *
 *  - the root `abx` group no longer accepts `--region/-r`;
 *  - regional commands (`list`/`kill`, the `template` control plane, and `mcp deploy`) accept a local `--region` and
 *    forward it to `loadConfig` / `resolveRegion`;
 *  - priority everywhere: command `--region` > `ALIBABA_CLOUD_REGION_ID` env / `abx config set region` (`~/.abx/config.toml`) >
 *    default `cn-hangzhou`;
 *  - purely local commands reject `--region` with the standard Click error;
 *  - the `template deploy` alias and the top-level `install` / `deploy` shortcuts expose/forward `--region` like the
 *    commands they delegate to;
 *  - `mcp deploy` no longer has its own hardcoded default -- it shares the same resolution semantics as every other
 *    regional command.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as yamlParse } from "yaml";

import { cli } from "../../src/cli/main.js";
import { resolveRegion } from "../../src/cli/region.js";
import * as transportAuth from "../../src/providers/alicloud_express/auth.js";
import * as transportConfig from "../../src/transport/config.js";
import * as layered from "../../src/transport/config_layers.js";
import * as transportHttp from "../../src/transport/http.js";
import * as protocolSandbox from "../../src/providers/shared/e2b/sandbox.js";
import { useIsolatedEnv } from "../_support/env.js";
import { CliRunner, type Result } from "../helpers/cliRunner.js";
import { ALL_COMMANDS } from "./conftest.js";

const iso = useIsolatedEnv();

/** Return stdout+stderr across Click runner versions. */
function combinedOutput(result: Result): string {
  return (result.output || "") + (result.stderr || "");
}

function runner(): CliRunner {
  return new CliRunner();
}

/**
 * `isolated_region_env`: point every transport-config source at a tmp dir for determinism. Patches the config.toml /
 * .env candidates inside the transport config module and removes all region-relevant environment variables, then resets
 * the module-level config cache.
 */
function useIsolatedRegionEnv(): { readonly dir: string } {
  const state = { dir: "" };
  let savedConfigFile = "";
  let savedPaths: typeof layered.paths;
  let savedCandidates: string[] = [];
  beforeEach(() => {
    state.dir = iso.tmp_path;
    savedConfigFile = transportConfig._CONFIG_FILE;
    savedPaths = { ...layered.paths, envFiles: [...layered.paths.envFiles] };
    layered._setPaths({ configFile: path.join(state.dir, "config.toml"), envFiles: [path.join(state.dir, ".env")] });
    savedCandidates = transportConfig._ENV_FILE_CANDIDATES;
    transportConfig._setConfigFile(path.join(state.dir, "config.toml"));
    transportConfig._setEnvFileCandidates([path.join(state.dir, ".env")]);
    for (const v of [
      "ALIBABA_CLOUD_REGION_ID",
      "ABX_SANDBOX_API_KEY",
      "ABX_SANDBOX_BASE_URL",
      "ABX_SANDBOX_DOMAIN",
      "ABX_SANDBOX_API_KEY",
      "ABX_SANDBOX_BASE_URL",
      "SANDBOX_API_KEY",
      "SANDBOX_API_BASE_URL",
      "ALICLOUD_ACCESS_KEY_ID",
      "ALICLOUD_ACCESS_KEY_SECRET",
      "AccessKey",
      "AccessSecret",
      "ABX_MCP_AUTH_TOKEN",
    ]) {
      iso.monkeypatch.delenv(v);
    }
    transportConfig.resetConfig();
  });
  afterEach(() => {
    transportConfig.resetConfig();
    transportConfig._setConfigFile(savedConfigFile);
    layered._setPaths(savedPaths);
    transportConfig._setEnvFileCandidates(savedCandidates);
  });
  return state;
}

const region_env = useIsolatedRegionEnv();
afterEach(() => {
  vi.restoreAllMocks();
});

const writeConfig = (region: string): void => fs.writeFileSync(path.join(region_env.dir, "config.toml"), `[transport]\nregion = "${region}"\n`);

// ---------------------------------------------------------------------------
// Root option removal
// ---------------------------------------------------------------------------

describe("TestRootOptionRemoved", () => {
  // The root `abx` group must not expose a global --region.

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_root_help_has_no_region", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).not.toContain("--region");
  });

  it("test_old_global_region_fails_with_click_error", async () => {
    // `abx --region ... list` now fails with the standard Click error.
    const result = await runner().invoke(cli, ["--region", "cn-shanghai", "list"]);
    expect(result.exit_code).toBe(2);
    expect(combinedOutput(result)).toContain("No such option");
  });

  it("test_old_global_short_flag_fails", async () => {
    const result = await runner().invoke(cli, ["-r", "cn-shanghai", "list"]);
    expect(result.exit_code).toBe(2);
    expect(combinedOutput(result)).toContain("No such option");
  });
});

// ---------------------------------------------------------------------------
// Which commands expose --region
// ---------------------------------------------------------------------------

const REGIONAL_COMMANDS: string[][] = [
  ["list", "--help"],
  ["kill", "--help"],
  ["sandbox", "list", "--help"],
  ["sandbox", "kill", "--help"],
  ["template", "list", "--help"],
  ["template", "info", "--help"],
  ["template", "from-image", "--help"],
  ["template", "push", "--help"],
  ["template", "build", "--help"],
  ["template", "install", "--help"],
  ["template", "delete", "--help"],
  ["template", "deploy", "--help"], // alias inherits build's params
  ["template", "install", "--help"], // top-level shortcut
  ["deploy", "--help"], // top-level shortcut of the template build pipeline
  ["mcp", "deploy", "--help"],
];

const LOCAL_COMMANDS: string[][] = [
  ["create", "--help"],
  ["exec", "--help"],
  ["connect", "--help"],
  ["upload", "--help"],
  ["download", "--help"],
  ["run", "--help"],
  ["config", "--help"],
  ["template", "search", "--help"],
  ["template", "scaffold", "--help"],
  ["mcp", "start", "--help"],
  ["mcp", "install", "--help"],
  ["mcp", "status", "--help"],
  ["sandbox", "create", "--help"],
  ["sandbox", "files", "--help"],
];

const LOCAL_REJECTS: string[][] = [
  ["create", "--template", "base", "--region", "cn-shanghai"],
  ["exec", "sbx-1", "true", "--region", "cn-shanghai"],
  ["connect", "sbx-1", "--region", "cn-shanghai"],
  ["config", "--region", "cn-shanghai"],
  ["template", "search", "python", "--region", "cn-shanghai"],
  ["template", "scaffold", "--region", "cn-shanghai"],
  ["mcp", "start", "--region", "cn-shanghai"],
  ["mcp", "status", "--region", "cn-shanghai"],
  ["mcp", "install", "--target", "cursor", "--region", "cn-shanghai"],
];

describe("TestRegionOptionPlacement", () => {
  // Only commands that talk to a regional control plane accept --region.

  // BLOCKED-ON: cli/commands/* (every command module)
  it.skipIf(!ALL_COMMANDS).each(REGIONAL_COMMANDS.map((argv) => [argv.join("-"), argv] as [string, string[]]))(
    "test_regional_command_help_shows_region [%s]",
    async (_id, argv) => {
      const result = await runner().invoke(cli, argv);
      expect(result.exit_code, result.output).toBe(0);
      expect(result.output, `${argv} should expose --region`).toContain("--region");
    },
  );

  // BLOCKED-ON: cli/commands/* (every command module)
  it.skipIf(!ALL_COMMANDS).each(LOCAL_COMMANDS.map((argv) => [argv.join("-"), argv] as [string, string[]]))(
    "test_local_command_help_hides_region [%s]",
    async (_id, argv) => {
      const result = await runner().invoke(cli, argv);
      expect(result.exit_code, result.output).toBe(0);
      expect(result.output, `${argv} must not expose --region`).not.toContain("--region");
    },
  );

  // BLOCKED-ON: cli/commands/* (every command module)
  it.skipIf(!ALL_COMMANDS).each(LOCAL_REJECTS.map((argv) => [argv.join("-"), argv] as [string, string[]]))(
    "test_local_command_rejects_region_flag [%s]",
    async (_id, argv) => {
      // Passing --region to a purely local command is a usage error.
      const result = await runner().invoke(cli, argv);
      expect(result.exit_code).toBe(2);
      expect(combinedOutput(result)).toContain("No such option");
    },
  );
});

// ---------------------------------------------------------------------------
// Region reaches the transport config (spy on loadConfig)
// ---------------------------------------------------------------------------

/**
 * The Python tests patch `transport.config.load_config`, `transport.auth.create_auth_provider`,
 * `transport.http.HttpClient`, `protocol.sandbox.SandboxProtocol` and `utils.async_bridge.run_sync` (the sync/async
 * bridge does not exist in TypeScript: the commands simply await). The same seams are the module exports below.
 */
function patchTransport(opts: { protocol?: boolean; loadConfig?: boolean } = {}) {
  const { protocol = true, loadConfig = true } = opts;
  const spies: { loadCfg?: ReturnType<typeof vi.fn>; httpCls: ReturnType<typeof vi.fn> } = { httpCls: vi.fn() };
  const spyAny = (o: object, k: string) => vi.spyOn(o as Record<string, (...a: unknown[]) => unknown>, k);
  if (loadConfig) {
    const observed = vi.fn();
    const legacyLoad = transportConfig.loadConfig;
    const providerLoad = layered.loadLayeredConfig;
    vi.spyOn(transportConfig, "loadConfig").mockImplementation((options) => {
      observed(options);
      return legacyLoad(options);
    });
    vi.spyOn(layered, "loadLayeredConfig").mockImplementation((options = {}) => {
      const own = options["provider_options"] as Record<string, unknown> | undefined;
      observed({ region: own?.["region"] ?? options["region"] ?? null });
      return providerLoad(options);
    });
    spies.loadCfg = observed;
  }
  spyAny(transportAuth, "createAuthProvider").mockReturnValue({} as never);
  spies.httpCls = spyAny(transportHttp, "HttpClient").mockImplementation(function () {
    return { close: async () => undefined };
  } as never) as never;
  if (protocol) spyAny(protocolSandbox, "SandboxProtocol").mockImplementation(function () {
      return { list: async () => [] };
    } as never);
  return spies;
}

/** `patch("agent_sandbox.utils.async_bridge.run_sync", return_value=[])` for `template list`: the platform call yields `[]`. */
function platformReturnsEmptyList(httpCls: ReturnType<typeof vi.fn>): void {
  httpCls.mockImplementation(function () {
    return { platformRequest: async () => ({ json: () => [] }), close: async () => undefined };
  } as never);
}

const regionOf = (spy: ReturnType<typeof vi.fn> | undefined): unknown => (spy?.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined)?.["region"];

describe("TestRegionReachesTransportConfig", () => {
  // Command --region must be forwarded to loadConfig / the HTTP client.

  it.each([
    [["list", "--region", "cn-shanghai"], "cn-shanghai"],
    [["list", "-r", "cn-shenzhen"], "cn-shenzhen"],
    [["list"], null],
    [["sandbox", "list", "--region", "cn-shanghai"], "cn-shanghai"],
  ] as Array<[string[], string | null]>)("test_list_forwards_region_to_load_config [%j-%s]", async (argv, expected) => {
    const { loadCfg } = patchTransport();
    const result = await runner().invoke(cli, argv);
    expect(result.exit_code, result.output).toBe(0);
    expect(regionOf(loadCfg) ?? null).toBe(expected);
  });

  it("test_kill_all_forwards_region_to_load_config", async () => {
    const { loadCfg } = patchTransport();
    const result = await runner().invoke(cli, ["kill", "--all", "--yes", "--region", "cn-shanghai"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(regionOf(loadCfg)).toBe("cn-shanghai");
  });

  it("test_template_list_forwards_region_to_load_config", async () => {
    const { loadCfg, httpCls } = patchTransport({ protocol: false });
    platformReturnsEmptyList(httpCls);
    const result = await runner().invoke(cli, ["template", "list", "--region", "cn-shanghai"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(regionOf(loadCfg)).toBe("cn-shanghai");
  });

  it("test_sandbox_list_command_region_reaches_http_client", async () => {
    // End-to-end: command --region wins over a persisted config value.
    writeConfig("cn-beijing");
    const { httpCls } = patchTransport({ loadConfig: false });
    const result = await runner().invoke(cli, ["list", "--region", "cn-shanghai"]);
    expect(result.exit_code, result.output).toBe(0);
    const configArg = httpCls.mock.calls.at(-1)![0] as { region: string };
    expect(configArg.region).toBe("cn-shanghai");
  });

  it("test_sandbox_list_falls_back_to_config_file", async () => {
    // Without --region the persisted config value is used.
    writeConfig("cn-beijing");
    const { httpCls } = patchTransport({ loadConfig: false });
    const result = await runner().invoke(cli, ["list"]);
    expect(result.exit_code, result.output).toBe(0);
    const configArg = httpCls.mock.calls.at(-1)![0] as { region: string };
    expect(configArg.region).toBe("cn-beijing");
  });

  it("test_template_list_default_region", async () => {
    // Without any configuration the default cn-hangzhou is used.
    const { httpCls } = patchTransport({ protocol: false, loadConfig: false });
    platformReturnsEmptyList(httpCls);
    const result = await runner().invoke(cli, ["template", "list"]);
    expect(result.exit_code, result.output).toBe(0);
    const configArg = httpCls.mock.calls.at(-1)![0] as { region: string };
    expect(configArg.region).toBe("cn-hangzhou");
  });
});

// ---------------------------------------------------------------------------
// resolveRegion priority (shared helper)
// ---------------------------------------------------------------------------

describe("TestResolveRegionPriority", () => {
  // Command > env / config file > default, implemented once for all commands.

  it("test_cli_region_beats_config_file", () => {
    writeConfig("cn-beijing");
    expect(resolveRegion("cn-shanghai")).toBe("cn-shanghai");
  });

  it("test_config_file_fallback", () => {
    writeConfig("cn-beijing");
    expect(resolveRegion(null)).toBe("cn-beijing");
  });

  it("test_env_var_fallback", () => {
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    expect(resolveRegion(null)).toBe("cn-shenzhen");
  });

  it("test_cli_region_beats_env_var", () => {
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    expect(resolveRegion("cn-shanghai")).toBe("cn-shanghai");
  });

  it("test_env_var_beats_config_file", () => {
    writeConfig("cn-beijing");
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    expect(resolveRegion(null)).toBe("cn-shenzhen");
  });

  it("test_default_when_nothing_configured", () => {
    expect(resolveRegion(null)).toBe("cn-hangzhou");
  });
});

// ---------------------------------------------------------------------------
// mcp deploy no longer has a second region semantic
// ---------------------------------------------------------------------------

describe("TestMcpDeployRegionSemantics", () => {
  // `mcp deploy` shares the unified region priority (no hardcoded default).

  async function deploy(tmpPath: string, ...extra: string[]): Promise<Record<string, unknown>> {
    const out = path.join(tmpPath, "artifact");
    const mcpMod = (await import(/* @vite-ignore */ "../../src/cli/commands/mcp.js" as string)) as Record<string, unknown>;
    vi.spyOn(mcpMod as Record<string, (...a: unknown[]) => unknown>, "_readApiKey").mockReturnValue("k");
    const result = await runner().invoke(cli, ["mcp", "deploy", "--output-dir", out, "--generate-token", ...extra]);
    expect(result.exit_code, result.output).toBe(0);
    return yamlParse(fs.readFileSync(path.join(out, "config.yaml"), "utf8")) as Record<string, unknown>;
  }

  it("test_cli_region_overrides_config_file", async () => {
    writeConfig("cn-beijing");
    const cfg = await deploy(region_env.dir, "--region", "cn-shanghai");
    expect(cfg["region"]).toBe("cn-shanghai");
  });

  it("test_falls_back_to_config_file", async () => {
    writeConfig("cn-beijing");
    const cfg = await deploy(region_env.dir);
    expect(cfg["region"]).toBe("cn-beijing");
  });

  it("test_falls_back_to_env_var", async () => {
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    const cfg = await deploy(region_env.dir);
    expect(cfg["region"]).toBe("cn-shenzhen");
  });

  it("test_default_region", async () => {
    // No flag, no config, no env -> cn-hangzhou.
    const cfg = await deploy(region_env.dir);
    expect(cfg["region"]).toBe("cn-hangzhou");
  });

  it("test_explicit_region_still_wins_over_env", async () => {
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    const cfg = await deploy(region_env.dir, "--region", "cn-shanghai");
    expect(cfg["region"]).toBe("cn-shanghai");
  });
});

// ---------------------------------------------------------------------------
// Shortcuts and aliases forward region to the final command
// ---------------------------------------------------------------------------

describe("TestShortcutForwarding", () => {
  // Top-level shortcuts / group aliases must keep --region working.

  it("test_top_level_install_accepts_region", async () => {
    // `abx template install ./missing --region ...` parses (fails on the path, not the flag).
    const result = await runner().invoke(cli, ["template", "install", "./definitely-missing", "--region", "cn-shanghai"]);
    // EXIT_NOT_FOUND from install's early local-path validation.
    expect(result.exit_code).toBe(4);
    expect(combinedOutput(result)).not.toContain("No such option");
  });

  it("test_top_level_install_forwards_region_to_template_install", async () => {
    const tpl = (await import(/* @vite-ignore */ "../../src/providers/alicloud_express/cli/template.js" as string)) as {
      install: { callback: (...a: unknown[]) => unknown };
    };
    const installCmd = vi.spyOn(tpl.install, "callback").mockResolvedValue(undefined as never);
    const result = await runner().invoke(cli, ["template", "install", "owner/repo", "--yes", "--region", "cn-shanghai"]);
    expect(result.exit_code, result.output).toBe(0);
    const params = installCmd.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(params["region"]).toBe("cn-shanghai");
  });

  it("test_template_deploy_alias_inherits_region_param", async () => {
    const tpl = (await import(/* @vite-ignore */ "../../src/providers/alicloud_express/cli/template.js" as string)) as {
      deploy: { params: Array<{ name: string }> };
    };
    expect(tpl.deploy.params.some((p) => p.name === "region")).toBe(true);
  });

  it("test_kill_all_accepts_region_flag", async () => {
    // `abx kill --all --yes --region ...` is accepted (mocked transport).
    patchTransport();
    const result = await runner().invoke(cli, ["kill", "--all", "--yes", "--region", "cn-shanghai"]);
    expect(result.exit_code, result.output).toBe(0);
  });
});

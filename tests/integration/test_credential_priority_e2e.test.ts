/**
 * End-to-end check that every credential consumer uses one order (port of
 * `tests/integration/test_credential_priority_e2e.py`).
 *
 * The order is: explicit argument, process environment, `./.env`, `~/.abx`, then a built-in default. `.env` files merge
 * per key, so a project file that omits a key does not hide `~/.abx`.
 *
 * Consumers covered here:
 *
 * - `abx config list`
 * - `loadConfig` (`Sandbox.create` and the other SDK clients)
 * - the coding agent used by natural-language `abx create`
 * - `resolveGithubToken` (template install / search)
 * - `abx mcp install` via `_readApiKey` and `_buildMcpServerConfig`
 * - `resolveRegion` (command `--region`)
 * - ACR namespace (`--acr-namespace` / `ACR_NAMESPACE` / `./.env` / `~/.abx`)
 *
 * Python's `resolve_llm_env` (`Sandbox.deploy`, the SDK's in-sandbox agent deployment) is SDK-only and not part of the
 * CLI port (see parity/KNOWN-GAPS.md); its assertions are covered by `python-sdk/client-sdk/tests/test_api/test_deploy.py`.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QwenCodeBackend } from "../../src/agent/coding_agent.js";
import { resolveCodingAgentCredentials } from "../../src/cli/commands/_coding_agent.js";
import { resolveGithubToken } from "../../src/cli/commands/config_cmd.js";
import { _buildMcpServerConfig, _readApiKey } from "../../src/cli/commands/mcp.js";
import { _resolveAcrNamespace } from "../../src/cli/commands/template.js";
import { cli } from "../../src/cli/main.js";
import { resolveRegion } from "../../src/cli/region.js";
import { Command, Context } from "../../src/cli/kit.js";
import {
  _CONFIG_FILE,
  _ENV_FILE_CANDIDATES,
  _PROJECT_ENV_FILE,
  _setConfigFile,
  _setEnvFileCandidates,
  _setProjectEnvFile,
  loadConfig,
  resetConfig,
} from "../../src/transport/config.js";
import { useIsolatedEnv } from "../_support/env.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { patchConfig, storagePatch } from "../helpers/configSupport.js";

const iso = useIsolatedEnv();
const runner = (): CliRunner => new CliRunner();

const _STORED_SANDBOX = "e2b-stored-sandbox-aaa";
const _ENV_SANDBOX = "e2b-env-sandbox-bbb";
const _PROJECT_SANDBOX = "e2b-project-sandbox-ccc";
const _STORED_LLM = "sk-stored-llm-aaa111";
const _ENV_LLM = "sk-env-llm-key-bbb222";
const _STORED_GITHUB = "ghp-stored-token-111";
const _ENV_GITHUB = "ghp-env-token-222";
const _ALIAS_SANDBOX = "e2b-alias-sandbox-ddd";
const _VENDOR_LLM = "sk-vendor-llm-ddd444";
const _LEGACY_LLM = "sk-legacy-qwen-eee555";
const _FILE_QWEN = "sk-file-qwen-fff666";

const _ISOLATED_ENV = [
  "E2B_API_KEY",
  "E2B_API_URL",
  "ABX_LLM_API_KEY",
  "ABX_LLM_BASE_URL",
  "ABX_LLM_MODEL",
  "ALIBABA_CLOUD_REGION_ID",
  "ALICLOUD_ACCESS_KEY_ID",
  "ALICLOUD_ACCESS_KEY_SECRET",
  "ACR_NAMESPACE",
  "GITHUB_TOKEN",
  "ABX_HTTP_TIMEOUT",
  "E2B_API_KEY",
  "SANDBOX_API_KEY",
  "SANDBOX_REGION",
  "AccessKey",
];

interface CredentialHome {
  abx: string;
  project: string;
}

let home: CredentialHome = { abx: "", project: "" };
let undoConfig: (() => void) | null = null;
let savedTransport: { config: string; candidates: string[]; project: string } | null = null;

/** Point every credential reader at one temporary home and project file (`credential_home` fixture). */
beforeEach(() => {
  const abx = path.join(iso.tmp_path, "abx");
  fs.mkdirSync(abx);
  const project = path.join(iso.tmp_path, "project.env");
  home = { abx, project };
  undoConfig = patchConfig(storagePatch(abx, { env: true }));
  savedTransport = { config: _CONFIG_FILE, candidates: _ENV_FILE_CANDIDATES, project: _PROJECT_ENV_FILE };
  _setConfigFile(path.join(abx, "config.toml"));
  _setEnvFileCandidates([project, path.join(abx, ".env")]);
  _setProjectEnvFile(project);
  for (const name of _ISOLATED_ENV) iso.monkeypatch.delenv(name);
  resetConfig();
});

afterEach(() => {
  resetConfig();
  undoConfig?.();
  if (savedTransport) {
    _setConfigFile(savedTransport.config);
    _setEnvFileCandidates(savedTransport.candidates);
    _setProjectEnvFile(savedTransport.project);
  }
});

function _write_system(abx: string): void {
  fs.writeFileSync(
    path.join(abx, ".env"),
    `E2B_API_KEY=${_STORED_SANDBOX}\n` +
      "ALICLOUD_ACCESS_KEY_ID=stored-ak-id\n" +
      "ALICLOUD_ACCESS_KEY_SECRET=stored-ak-secret\n" +
      `ABX_LLM_API_KEY=${_STORED_LLM}\n` +
      `GITHUB_TOKEN=${_STORED_GITHUB}\n` +
      "ACR_NAMESPACE=ns-stored\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(abx, "config.toml"),
    '[transport]\nllm_base_url = "https://stored.example/v1"\nllm_model = "stored-model"\nregion = "cn-beijing"\n',
    "utf-8",
  );
}

async function _agent_env(): Promise<Record<string, string>> {
  const ctx = new Context(new Command("abx"));
  const creds = await resolveCodingAgentCredentials(ctx, { yes: true, backend: new QwenCodeBackend() });
  return creds.asEnv();
}

const embeddedEnv = (embedded: Map<string, unknown>): Map<string, string> => embedded.get("env") as Map<string, string>;

describe("TestCredentialPriorityEndToEnd", () => {
  it("test_process_env_beats_system_config", async () => {
    _write_system(home.abx);
    iso.monkeypatch.setenv("E2B_API_KEY", _ENV_SANDBOX);
    iso.monkeypatch.setenv("ABX_LLM_API_KEY", _ENV_LLM);
    iso.monkeypatch.setenv("ABX_LLM_BASE_URL", "https://env.example/v1");
    iso.monkeypatch.setenv("ABX_LLM_MODEL", "env-model");
    iso.monkeypatch.setenv("GITHUB_TOKEN", _ENV_GITHUB);
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    iso.monkeypatch.setenv("ALICLOUD_ACCESS_KEY_ID", "env-ak-id");
    resetConfig();

    const listed = await runner().invoke(cli, ["config", "list"]);
    expect(listed.exit_code).toBe(0);
    expect(listed.output).toContain("e2b***bbb (env)");
    expect(listed.output).toContain("sk-***222 (env)");
    expect(listed.output).toContain("https://env.example/v1 (env)");
    expect(listed.output).toContain("env-model (env)");
    expect(listed.output).toContain("ghp***222 (env)");
    expect(listed.output).toContain("cn-shenzhen (env)");
    expect(listed.output).not.toContain(_STORED_SANDBOX);
    expect(listed.output).not.toContain("stored-model");

    resetConfig();
    expect(loadConfig().api_key).toBe(_ENV_SANDBOX);
    expect(loadConfig().access_key_id).toBe("env-ak-id");
    expect(loadConfig().region).toBe("cn-shenzhen");
    expect(_readApiKey()).toBe(_ENV_SANDBOX);

    expect((await _agent_env())["OPENAI_API_KEY"]).toBe(_ENV_LLM);
    expect((await _agent_env())["OPENAI_BASE_URL"]).toBe("https://env.example/v1");
    expect(resolveGithubToken()).toBe(_ENV_GITHUB);

    // A one-off argument still beats the environment.
    expect(resolveGithubToken("ghp-explicit")).toBe("ghp-explicit");
  });

  it("test_system_config_when_env_and_project_file_omit_the_key", async () => {
    _write_system(home.abx);
    // The project file exists and sets an unrelated key. That must not hide the sandbox key, LLM key, or GitHub token
    // saved in ~/.abx.
    fs.writeFileSync(home.project, "ABX_HTTP_TIMEOUT=15\n", "utf-8");
    resetConfig();

    const listed = await runner().invoke(cli, ["config", "list"]);
    expect(listed.exit_code).toBe(0);
    expect(listed.output).toContain("e2b***aaa (user)");
    expect(listed.output).toContain("sk-***111 (user)");
    expect(listed.output).toContain("https://stored.example/v1 (user)");
    expect(listed.output).toContain("stored-model (user)");
    expect(listed.output).toContain("ghp***111 (user)");
    expect(listed.output).toContain("cn-beijing (user)");
    expect(listed.output).toContain("ns-stored (user)");

    resetConfig();
    const loaded = loadConfig();
    expect(loaded.api_key).toBe(_STORED_SANDBOX);
    expect(loaded.access_key_id).toBe("stored-ak-id");
    expect(loaded.access_key_secret).toBe("stored-ak-secret");
    expect(loaded.region).toBe("cn-beijing");
    expect(loaded.http_timeout).toBe(15.0);
    expect(_readApiKey()).toBe(_STORED_SANDBOX);

    expect((await _agent_env())["OPENAI_API_KEY"]).toBe(_STORED_LLM);
    expect((await _agent_env())["OPENAI_MODEL"]).toBe("stored-model");
    expect(resolveGithubToken()).toBe(_STORED_GITHUB);
    expect(resolveRegion(null)).toBe("cn-beijing");

    // The editor config copies the resolved sandbox key. Region saved only in config.toml is not frozen into that file.
    const embedded = _buildMcpServerConfig() as Map<string, unknown>;
    expect(embeddedEnv(embedded).get("E2B_API_KEY")).toBe(_STORED_SANDBOX);
    expect(embeddedEnv(embedded).has("ALIBABA_CLOUD_REGION_ID")).toBe(false);
  });

  it("test_project_dotenv_beats_system_and_loses_to_process_env", async () => {
    _write_system(home.abx);
    fs.writeFileSync(
      home.project,
      `E2B_API_KEY=${_PROJECT_SANDBOX}\nABX_LLM_API_KEY=sk-project-llm-ccc333\nABX_LLM_BASE_URL=https://project.example/v1\n`,
      "utf-8",
    );
    resetConfig();

    const listed = await runner().invoke(cli, ["config", "list"]);
    expect(listed.exit_code).toBe(0);
    expect(listed.output).toContain("e2b***ccc (user)");
    expect(listed.output).toContain("sk-***333 (user)");
    expect(listed.output).toContain("https://project.example/v1 (user)");
    // The model was not in the project file, so ~/.abx still supplies it.
    expect(listed.output).toContain("stored-model (user)");

    resetConfig();
    expect(loadConfig().api_key).toBe(_PROJECT_SANDBOX);
    expect(_readApiKey()).toBe(_PROJECT_SANDBOX);
    expect((await _agent_env())["OPENAI_API_KEY"]).toBe("sk-project-llm-ccc333");

    iso.monkeypatch.setenv("E2B_API_KEY", _ENV_SANDBOX);
    iso.monkeypatch.setenv("ABX_LLM_API_KEY", _ENV_LLM);
    resetConfig();
    expect(loadConfig().api_key).toBe(_ENV_SANDBOX);
    expect(_readApiKey()).toBe(_ENV_SANDBOX);
    const listed_env = await runner().invoke(cli, ["config", "list"]);
    expect(listed_env.output).toContain("e2b***bbb (env)");
    expect(listed_env.output).toContain("sk-***222 (env)");
  });

  it("test_same_layer_order_explicit_region_and_mcp_region", async () => {
    _write_system(home.abx);
    iso.monkeypatch.setenv("E2B_API_KEY", _ENV_SANDBOX);
    iso.monkeypatch.setenv("SANDBOX_API_KEY", _ALIAS_SANDBOX);
    iso.monkeypatch.setenv("ABX_SANDBOX_API_KEY", _ALIAS_SANDBOX);
    iso.monkeypatch.setenv("ABX_LLM_API_KEY", _ENV_LLM);
    iso.monkeypatch.setenv("DASHSCOPE_API_KEY", _VENDOR_LLM);
    iso.monkeypatch.setenv("ALICLOUD_ACCESS_KEY_ID", "env-alicld-ak");
    iso.monkeypatch.setenv("AccessKey", "env-legacy-ak");
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    iso.monkeypatch.setenv("SANDBOX_REGION", "cn-hongkong");
    resetConfig();

    // Each key has exactly one environment name; other spellings are never read.
    expect(loadConfig().api_key).toBe(_ENV_SANDBOX);
    expect(loadConfig().access_key_id).toBe("env-alicld-ak");
    expect((await _agent_env())["OPENAI_API_KEY"]).toBe(_ENV_LLM);
    expect(resolveRegion("cn-shanghai")).toBe("cn-shanghai");
    expect(resolveRegion(null)).toBe("cn-shenzhen");

    const embedded = _buildMcpServerConfig() as Map<string, unknown>;
    expect(embeddedEnv(embedded).get("E2B_API_KEY")).toBe(_ENV_SANDBOX);
    expect(embeddedEnv(embedded).get("ALIBABA_CLOUD_REGION_ID")).toBe("cn-shenzhen");
    expect(embeddedEnv(embedded).has("E2B_API_URL")).toBe(false);
  });

  it("test_blank_values_fall_through", () => {
    _write_system(home.abx);
    iso.monkeypatch.setenv("E2B_API_KEY", "   ");
    iso.monkeypatch.setenv("GITHUB_TOKEN", "   ");
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "   ");
    resetConfig();

    expect(loadConfig().api_key).toBe(_STORED_SANDBOX);
    expect(loadConfig().region).toBe("cn-beijing");
    expect(resolveGithubToken("   ")).toBe(_STORED_GITHUB);
    expect(resolveRegion("   ")).toBe("cn-beijing");

    iso.monkeypatch.setenv("SANDBOX_API_KEY", _ALIAS_SANDBOX);
    resetConfig();
    expect(loadConfig().api_key).toBe(_STORED_SANDBOX);
  });

  it("test_abx_qwen_code_api_key_is_not_read", async () => {
    const abx = home.abx;
    fs.writeFileSync(path.join(abx, ".env"), `E2B_API_KEY=${_STORED_SANDBOX}\nABX_QWEN_CODE_API_KEY=${_FILE_QWEN}\n`, "utf-8");
    iso.monkeypatch.setenv("ABX_QWEN_CODE_API_KEY", _LEGACY_LLM);
    resetConfig();

    await expect(_agent_env()).rejects.toThrow(/no model credentials/);
    const listed = await runner().invoke(cli, ["config", "get", "llm_api_key"]);
    expect(listed.output).not.toContain("eee555");
    expect(listed.output).not.toContain("fff666");
  });

  it("test_acr_namespace_follows_the_same_order", () => {
    const home_ = path.join(iso.tmp_path, "home");
    const abx = path.join(home_, ".abx");
    fs.mkdirSync(abx, { recursive: true });
    fs.writeFileSync(path.join(abx, ".env"), "ACR_NAMESPACE=ns-stored\n", "utf-8");
    const work = path.join(iso.tmp_path, "work");
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, ".env"), "ACR_NAMESPACE=ns-project\n", "utf-8");
    iso.monkeypatch.setenv("HOME", home_);
    iso.monkeypatch.setenv("USERPROFILE", home_);
    iso.monkeypatch.delenv("ACR_NAMESPACE");
    iso.monkeypatch.chdir(work);

    expect(_resolveAcrNamespace(null)).toBe("ns-project");
    iso.monkeypatch.setenv("ACR_NAMESPACE", "ns-env");
    expect(_resolveAcrNamespace(null)).toBe("ns-env");
    expect(_resolveAcrNamespace("ns-flag")).toBe("ns-flag");
    iso.monkeypatch.setenv("ACR_NAMESPACE", "   ");
    expect(_resolveAcrNamespace("   ")).toBe("ns-project");
  });
});

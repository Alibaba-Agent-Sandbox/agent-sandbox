/** Tests for LLM-related config commands: llm_api_key, llm_model, llm_base_url (port of `tests/test_cli/test_config_llm.py`). */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cli } from "../../src/cli/main.js";
import * as qwen from "../../src/agent/qwen_code.js";
import { _businessDefault } from "../../src/cli/commands/config_cmd.js";
import { useIsolatedEnv } from "../_support/env.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { exists, readText, storagePatch, withConfig } from "../helpers/configSupport.js";

const iso = useIsolatedEnv();

const runner = (): CliRunner => new CliRunner();
const tmpPath = (): string => iso.tmp_path;

describe("TestConfigLLMApiKey", () => {
  // Tests for llm_api_key config set/get (secure ~/.abx/.env storage).

  it("test_set_llm_api_key", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const envFile = path.join(tmp, ".env");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["config", "set", "llm_api_key", "sk-test123"]),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("llm_api_key");
    // Value should be masked in output
    expect(result.output).not.toContain("sk-test123");
    expect(result.output).toContain("***");
    // The key is stored in ~/.abx/.env as ABX_LLM_API_KEY (never TOML).
    expect(readText(envFile)).toBe("ABX_LLM_API_KEY=sk-test123\n");
    expect(exists(configFile)).toBe(false);
    // The env file holds credentials, so it stays owner-only.
    if (process.platform !== "win32") expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);
  });

  it("test_get_ignores_retired_toml_copy", async () => {
    // Retired plaintext storage is not read.
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, "config.toml"), '[transport]\nllm_api_key = "sk-placeholder-legacy456"\n');
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "get", "llm_api_key"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).not.toContain("sk-placeholder-legacy456");
    expect(result.output).toContain("(not set)");
  });

  it("test_secure_storage_wins_over_legacy_toml", async () => {
    // ~/.abx/.env (and the process env) outrank the legacy TOML copy.
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, "config.toml"), '[transport]\nllm_api_key = "sk-placeholder-legacy456"\n');
    fs.writeFileSync(path.join(tmp, ".env"), "ABX_LLM_API_KEY=sk-secure-key-654321\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["--json", "config", "get", "llm_api_key"]),
    );

    expect(result.exit_code).toBe(0);
    // The masked value derives from the secure copy, not the legacy one.
    expect(result.output).toContain("sk-***321");
    expect(result.output).not.toContain("456");
  });

  it("test_get_llm_api_key_masked", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), "ABX_LLM_API_KEY=sk-test123abcdef\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "get", "llm_api_key"]));

    expect(result.exit_code).toBe(0);
    // Should show masked value
    expect(result.output).toContain("***");
    // Full key should NOT be shown
    expect(result.output).not.toContain("sk-test123abcdef");
  });

  it("test_get_llm_api_key_not_set", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "get", "llm_api_key"]));

    expect(result.exit_code).toBe(0);
  });
});

describe("TestConfigLLMModel", () => {
  // Tests for llm_model config set/get.

  it("test_set_llm_model", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "llm_model", "qwen-plus"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("qwen-plus");
    expect(readText(configFile)).toContain("qwen-plus");
  });

  it("test_get_llm_model", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, "config.toml"), '[transport]\nllm_model = "qwen-plus"\n');
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "get", "llm_model"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("qwen-plus");
  });
});

describe("TestConfigLLMBaseURL", () => {
  // Tests for llm_base_url config set/get.

  it("test_set_llm_base_url", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const result = await withConfig(storagePatch(tmp), () =>
      runner().invoke(cli, ["config", "set", "llm_base_url", "https://example.com/v1"]),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("https://example.com/v1");
    expect(readText(configFile)).toContain("https://example.com/v1");
  });

  it("test_get_llm_base_url", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, "config.toml"), '[transport]\nllm_base_url = "https://example.com/v1"\n');
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "get", "llm_base_url"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("https://example.com/v1");
  });
});

describe("TestConfigListLLM", () => {
  // Tests for `config list` including LLM keys.

  it("test_list_includes_llm_keys", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("llm_api_key");
    expect(result.output).toContain("llm_model");
    expect(result.output).toContain("llm_base_url");
  });

  it("test_list_shows_user_llm_values", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(
      path.join(tmp, "config.toml"),
      '[transport]\nllm_api_key = "sk-test999abc"\nllm_model = "qwen-plus"\nllm_base_url = "https://example.com/v1"\n',
    );
    fs.writeFileSync(path.join(tmp, ".env"), "ABX_LLM_API_KEY=sk-test999abc\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code).toBe(0);
    // llm_api_key should be masked
    expect(result.output).toContain("***");
    expect(result.output).not.toContain("sk-test999abc");
    // llm_model and llm_base_url should be visible
    expect(result.output).toContain("qwen-plus");
    expect(result.output).toContain("https://example.com/v1");
    // All should show "(user)" label
    expect(result.output).toContain("user");
  });
});

describe("TestCredentialPriority", () => {
  // Process environment wins over ~/.abx; the stored value is the fallback.

  it("test_env_api_key_beats_stored_file", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), "ABX_LLM_API_KEY=sk-stored-key-aaa111\n");
    iso.monkeypatch.setenv("ABX_LLM_API_KEY", "sk-env-key-bbb222");
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("sk-***222 (env)");
    expect(result.output).not.toContain("sk-***111");
  });

  it("test_stored_api_key_when_env_unset", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), "ABX_LLM_API_KEY=sk-stored-key-aaa111\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("sk-***111 (user)");
  });

  it("test_env_base_url_and_model_beat_stored", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(
      path.join(tmp, "config.toml"),
      '[transport]\nllm_base_url = "https://stored.example/v1"\nllm_model = "stored-model"\n',
    );
    iso.monkeypatch.setenv("ABX_LLM_BASE_URL", "https://env.example/v1");
    iso.monkeypatch.setenv("ABX_LLM_MODEL", "env-model");
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("https://env.example/v1 (env)");
    expect(result.output).toContain("env-model (env)");
    expect(result.output).not.toContain("stored.example");
    expect(result.output).not.toContain("stored-model");
  });
});

describe("ConfigDefaultsGuard", () => {
  it("llm defaults come from the single qwen_code constants", () => {
    expect(_businessDefault("llm_base_url")).toBe(qwen._DEFAULT_OPENAI_BASE_URL);
    expect(_businessDefault("llm_model")).toBe(qwen._DEFAULT_OPENAI_MODEL);
    expect(qwen._DEFAULT_OPENAI_BASE_URL).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(qwen._DEFAULT_OPENAI_MODEL).toBe("qwen3-coder-plus");
  });
});

/**
 * Tests for the `abx config init` guided wizard (port of `tests/test_cli/test_config_init.py`).
 *
 * Covers the TTY wizard (asterisk-masked / fallback secret input, stored locations) and the non-interactive fallback
 * that must never block in CI.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { cli } from "../../src/cli/main.js";
import { useIsolatedEnv } from "../_support/env.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { exists, fakeTtySys, readText, storagePatch, withConfig } from "../helpers/configSupport.js";

const iso = useIsolatedEnv();

const runner = (): CliRunner => new CliRunner();
const tmpPath = (): string => iso.tmp_path;

/** `result.stderr or ""` (the Python helper also guards the Click versions that do not capture stderr). */
const _stderr = (result: { stderr: string }): string => result.stderr || "";

const lines = (output: string): string[] => output.split("\n");

describe("TestConfigInitNonInteractive", () => {
  it("test_non_tty_prints_credentials_and_region_only_by_default", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "init"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Non-interactive setup");
    expect(result.output).toContain("abx config set sandbox_api_key");
    expect(result.output).toContain("abx config set region");
    expect(result.output).not.toContain("abx config set llm_api_key");
    expect(result.output).not.toContain("abx config set acr_namespace");
    expect(result.output).not.toContain("abx config set access_key_id");
    expect(result.output).toContain("abx config init --build");
    expect(result.output).toContain("abx config init --llm");
    // Nothing may be written without explicit user input.
    expect(exists(path.join(tmp, ".env"))).toBe(false);
  });

  it("test_non_tty_with_build_and_llm_prints_all_sections", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["config", "init", "--build", "--llm"]),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("abx config set sandbox_api_key");
    expect(result.output).toContain("abx config set region");
    expect(result.output).toContain("abx config set llm_api_key");
    expect(result.output).toContain("abx config set acr_namespace");
    expect(result.output).toContain("abx config set access_key_id");
    expect(result.output).toContain("abx config set access_key_secret");
    expect(result.output).not.toContain("qwen_code_");
    expect(result.output).not.toContain("More settings:");
    expect(exists(path.join(tmp, ".env"))).toBe(false);
  });

  it("test_yes_flag_behaves_like_non_tty", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "init", "--yes"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Non-interactive setup");
    expect(exists(path.join(tmp, ".env"))).toBe(false);
  });
});

describe("TestConfigInitWizard", () => {
  it("test_wizard_stores_platform_and_qwen_keys", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const envFile = path.join(tmp, ".env");
    const result = await withConfig({ ...storagePatch(tmp, { env: true }), sys: fakeTtySys() }, () =>
      runner().invoke(cli, ["config", "init", "--build", "--llm"], {
        input: "sk-platform\ncn-shanghai\nmy-ns\nLTAIexampleAk\nSecretValue123456\nsk-qwen\n",
      }),
    );

    expect(result.exit_code, result.output).toBe(0);
    const envContent = readText(envFile);
    expect(envContent).toContain("ABX_SANDBOX_API_KEY=sk-platform");
    expect(envContent).toContain("ABX_LLM_API_KEY=sk-qwen");
    expect(envContent).toContain("ACR_NAMESPACE=my-ns");
    expect(envContent).toContain("ALICLOUD_ACCESS_KEY_ID=LTAIexampleAk");
    expect(envContent).toContain("ALICLOUD_ACCESS_KEY_SECRET=SecretValue123456");
    expect(result.output).toContain("Set acr_namespace = my-ns");
    expect(result.output).toContain("Stored access_key_id");
    expect(result.output).toContain("Stored access_key_secret");
    expect(result.output).not.toContain("SecretValue123456");
    expect(envContent).not.toContain("ABX_QWEN_CODE_API_KEY");
    const configContent = readText(configFile);
    expect(configContent).toContain('region = "cn-shanghai"');
    expect(result.output).toContain("Stored sandbox_api_key");
    expect(result.output).toContain("Stored llm_api_key");
    expect(result.output).toContain("Configuration complete");
  });

  it("test_default_wizard_asks_only_credentials_and_region", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    const result = await withConfig({ ...storagePatch(tmp, { env: true }), sys: fakeTtySys() }, () =>
      runner().invoke(cli, ["config", "init"], { input: "sk-platform\ncn-shanghai\n" }),
    );

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("1/2 ");
    expect(result.output).toContain("2/2 ");
    expect(result.output).not.toContain("ACR namespace");
    expect(result.output).not.toContain("LLM API key");
    expect(result.output).toContain("abx config init --build");
    expect(result.output).toContain("abx config init --llm");
    expect(readText(envFile)).toBe("ABX_SANDBOX_API_KEY=sk-platform\n");
  });

  it("test_llm_section_only", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    const result = await withConfig({ ...storagePatch(tmp, { env: true }), sys: fakeTtySys() }, () =>
      runner().invoke(cli, ["config", "init", "--llm"], { input: "\n\nsk-qwen\n" }),
    );

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("3/3 ");
    expect(result.output).not.toContain("ACR namespace");
    expect(result.output).toContain("abx config init --build");
    expect(result.output).not.toContain("abx config init --llm");
    expect(readText(envFile)).toContain("ABX_LLM_API_KEY=sk-qwen");
  });

  it("test_sensitive_values_are_not_echoed", async () => {
    const tmp = tmpPath();
    const result = await withConfig({ ...storagePatch(tmp, { env: true }), sys: fakeTtySys() }, () =>
      runner().invoke(cli, ["config", "init", "--build", "--llm"], { input: "sk-platform-secret\n\n\n\nsk-cloud-secret\nsk-qwen-secret\n" }),
    );

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("sk-platform-secret");
    expect(result.output).not.toContain("sk-qwen-secret");
    expect(result.output).not.toContain("sk-cloud-secret");
  });

  it("test_empty_inputs_skip_secrets_and_keep_default_region", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const envFile = path.join(tmp, ".env");
    const result = await withConfig({ ...storagePatch(tmp, { env: true }), sys: fakeTtySys() }, () =>
      runner().invoke(cli, ["config", "init", "--build", "--llm"], { input: "\n\n\n\n\n\n" }),
    );

    expect(result.exit_code, result.output).toBe(0);
    // No secrets were typed → the .env file must not be created.
    expect(exists(envFile)).toBe(false);
    // The region prompt accepts its default and persists it.
    expect(readText(configFile)).toContain('region = "cn-hangzhou"');
  });

  it("test_existing_region_becomes_default", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    fs.writeFileSync(configFile, '[transport]\nregion = "cn-shanghai"\n', "utf-8");
    const result = await withConfig({ ...storagePatch(tmp, { env: true }), sys: fakeTtySys() }, () =>
      runner().invoke(cli, ["config", "init"], { input: "\n\n\n\n\n\n" }),
    );

    expect(result.exit_code, result.output).toBe(0);
    expect(readText(configFile)).toContain('region = "cn-shanghai"');
  });
});

describe("TestConfigInitMaskedInput", () => {
  // Secret prompts: asterisk masking when supported, safe fallback otherwise.

  it("test_fallback_notice_when_masking_unsupported", async () => {
    // _FakeSys reports a TTY but has no fileno() → no-echo fallback + notice.
    const tmp = tmpPath();
    const result = await withConfig({ ...storagePatch(tmp, { env: true }), sys: fakeTtySys() }, () =>
      runner().invoke(cli, ["config", "init"], { input: "sk-a\n\n" }),
    );

    expect(result.exit_code, result.output).toBe(0);
    expect(_stderr(result)).toContain("asterisk masking is not supported");
  });

  it("test_init_uses_masked_prompt_when_supported", async () => {
    // The wizard must route the three secrets through _prompt_secret.
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    const answers = ["sk-platform", "sk-cloud", "sk-qwen"];
    const mockPrompt = vi.fn(async (_text: string) => answers.shift()!);
    const result = await withConfig({ ...storagePatch(tmp, { env: true }), sys: fakeTtySys(), _promptSecret: mockPrompt }, () =>
      runner().invoke(cli, ["config", "init", "--build", "--llm"], { input: "\nmy-ns\nLTAIexample\n" }),
    );

    expect(result.exit_code, result.output).toBe(0);
    expect(mockPrompt).toHaveBeenCalledTimes(3);
    const envContent = readText(envFile);
    expect(envContent).toContain("ABX_SANDBOX_API_KEY=sk-platform");
    expect(envContent).toContain("ABX_LLM_API_KEY=sk-qwen");
    expect(envContent).toContain("ACR_NAMESPACE=my-ns");
    expect(envContent).toContain("ALICLOUD_ACCESS_KEY_ID=LTAIexample");
    expect(envContent).toContain("ALICLOUD_ACCESS_KEY_SECRET=sk-cloud");
  });
});

describe("TestLegacyQwenConfig", () => {
  // Older qwen_code_* storage is read as the unified llm_* profile.

  it("test_legacy_endpoint_is_listed_as_llm_base_url", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    fs.writeFileSync(
      configFile,
      '[transport]\nqwen_code_base_url = "https://example.test/v1"\nqwen_code_model = "qwen3.8-plus"\n',
      "utf-8",
    );
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("qwen_code_");
    const base = lines(result.output).find((ln) => ln.startsWith("llm_base_url"))!;
    const model = lines(result.output).find((ln) => ln.startsWith("llm_model"))!;
    expect(base).toContain("https://example.test/v1 (user)");
    expect(model).toContain("qwen3.8-plus (user)");
  });

  it("test_removed_qwen_key_points_at_llm_api_key", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["config", "set", "qwen_code_api_key", "sk-old"]),
    );

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("was removed");
    expect(result.output).toContain("llm_api_key");
    expect(exists(path.join(tmp, ".env"))).toBe(false);
  });
});

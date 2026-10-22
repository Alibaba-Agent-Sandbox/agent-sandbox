/** Tests for config CLI commands: get, set, list (plus reset removal) (port of `tests/test_cli/test_config_commands.py`). */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { cli } from "../../src/cli/main.js";
import { resolveGithubToken } from "../../src/cli/commands/config_cmd.js";
import { Abort } from "../../src/cli/errors.js";
import { _ENV_VAR_MAP } from "../../src/transport/config.js";
import { useIsolatedEnv } from "../_support/env.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { cleanEnv, exists, fakeTtySys, readText, storagePatch, withConfig, withEnv } from "../helpers/configSupport.js";

const iso = useIsolatedEnv();

const runner = (): CliRunner => new CliRunner();
const tmpPath = (): string => iso.tmp_path;

/** `result.output.splitlines()` */
const lines = (output: string): string[] => output.split(/\r\n|\r|\n/).filter((_l, i, a) => i < a.length - (a[a.length - 1] === "" ? 1 : 0));

describe("TestConfigGet", () => {
  it("test_get_default_region", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "get", "region"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("cn-hangzhou");
  });

  it("test_get_unknown_key", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "get", "nonexistent"]));

    expect(result.exit_code).toBe(2);
  });

  it("test_get_json_mode", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["--json", "config", "get", "region"]));

    expect(result.exit_code).toBe(0);
    // JSON output
    expect(result.output).toContain("cn-hangzhou");
  });
});

describe("TestConfigSet", () => {
  it("test_set_region", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "region", "cn-shanghai"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("cn-shanghai");
    expect(fs.statSync(configFile).isFile()).toBe(true);
    expect(readText(configFile)).toContain("cn-shanghai");
  });

  it("test_set_unknown_key", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "badkey", "value"]));

    expect(result.exit_code).toBe(2);
  });

  it("test_set_numeric_value", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "http_timeout", "60.0"]));

    expect(result.exit_code).toBe(0);
    expect(readText(configFile)).toContain("60.0");
  });

  it("test_set_invalid_numeric", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "http_timeout", "not_a_number"]));

    expect(result.exit_code).toBe(2);
  });

  it("test_set_http2_false", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "http2", "false"]));

    expect(result.exit_code).toBe(0);
    // Serialised as a TOML boolean, not a quoted string.
    expect(readText(configFile)).toContain("http2 = false");
  });

  it("test_set_http2_true_accepts_yes", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "http2", "yes"]));

    expect(result.exit_code).toBe(0);
    expect(readText(configFile)).toContain("http2 = true");
  });

  it("test_set_http2_invalid", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "http2", "maybe"]));

    expect(result.exit_code).toBe(2);
  });
});

describe("TestConfigList", () => {
  it("test_list_defaults", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("region");
    expect(result.output).toContain("default");
  });

  it("test_list_json_mode", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["--json", "config", "list"]));

    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data).toHaveProperty("region");
  });
});

describe("TestConfigApiKey", () => {
  // Tests for api_key config (get/set via .env file).

  it("test_set_api_key", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["config", "set", "sandbox_api_key", "e2b_test1234abcdc1"]),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("sandbox_api_key");
    // Key should be masked
    expect(result.output).not.toContain("e2b_test1234abcdc1");
    expect(result.output).toContain("***");
    // Env file should contain the key
    expect(fs.statSync(envFile).isFile()).toBe(true);
    expect(readText(envFile)).toContain("ABX_SANDBOX_API_KEY=e2b_test1234abcdc1");
  });

  it("test_get_api_key_from_env_file", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    fs.writeFileSync(envFile, "ABX_SANDBOX_API_KEY=e2b_mykey12345dc1\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "get", "sandbox_api_key"]));

    expect(result.exit_code).toBe(0);
    // Should show masked value
    expect(result.output).toContain("***");
    // Full key should NOT be shown
    expect(result.output).not.toContain("e2b_mykey12345dc1");
  });

  it("test_get_api_key_not_set", async () => {
    const tmp = tmpPath();
    const env = { ...process.env } as Record<string, string>;
    delete env["ABX_SANDBOX_API_KEY"];
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(env, () => runner().invoke(cli, ["config", "get", "sandbox_api_key"])),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("not set");
  });

  it("test_list_shows_masked_api_key", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    fs.writeFileSync(envFile, "ABX_SANDBOX_API_KEY=e2b_testkey123dc1\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("sandbox_api_key");
    expect(result.output).toContain("***");
    expect(result.output).not.toContain("e2b_testkey123dc1");
  });
});

describe("TestConfigAlicloudCredentials", () => {
  // Tests for Alibaba Cloud AK/SK config (stored in .env).

  const EXAMPLE_ACCESS_KEY_ID = "LTAI" + "5tExampleAkId";

  it("test_set_access_key_id_plain", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const envFile = path.join(tmp, ".env");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["config", "set", "access_key_id", EXAMPLE_ACCESS_KEY_ID]),
    );

    expect(result.exit_code).toBe(0);
    // AK id is not sensitive: shown in full, written to .env, not config.toml.
    expect(result.output).toContain(EXAMPLE_ACCESS_KEY_ID);
    expect(fs.statSync(envFile).isFile()).toBe(true);
    expect(readText(envFile)).toContain("ALICLOUD_ACCESS_KEY_ID=" + EXAMPLE_ACCESS_KEY_ID);
    expect(exists(configFile)).toBe(false);
  });

  it("test_set_acr_namespace_writes_env", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    const [result, listed] = await withConfig(storagePatch(tmp, { env: true }), async () => [
      await runner().invoke(cli, ["config", "set", "acr_namespace", "serverless-sandbox"]),
      await runner().invoke(cli, ["config", "get", "acr_namespace"]),
    ]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Set acr_namespace = serverless-sandbox");
    expect(readText(envFile)).toContain("ACR_NAMESPACE=serverless-sandbox");
    expect(listed!.exit_code).toBe(0);
    expect(listed!.output).toContain("serverless-sandbox");
  });

  it("test_set_access_key_secret_masked", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["config", "set", "access_key_secret", "SecretValue1234567890"]),
    );

    expect(result.exit_code).toBe(0);
    // SK is sensitive: masked in output but written verbatim to .env.
    expect(result.output).not.toContain("SecretValue1234567890");
    expect(result.output).toContain("***");
    expect(fs.statSync(envFile).isFile()).toBe(true);
    expect(readText(envFile)).toContain("ALICLOUD_ACCESS_KEY_SECRET=SecretValue1234567890");
  });

  it("test_get_access_key_id_plain", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), `ALICLOUD_ACCESS_KEY_ID=${EXAMPLE_ACCESS_KEY_ID}\n`);
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "get", "access_key_id"]));

    expect(result.exit_code).toBe(0);
    // Not sensitive: full value shown.
    expect(result.output).toContain(EXAMPLE_ACCESS_KEY_ID);
  });

  it("test_get_access_key_secret_masked", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), "ALICLOUD_ACCESS_KEY_SECRET=SecretValue1234567890\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["config", "get", "access_key_secret"]),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("***");
    expect(result.output).not.toContain("SecretValue1234567890");
  });

  it("test_get_access_key_secret_not_set", async () => {
    const tmp = tmpPath();
    const env = { ...process.env } as Record<string, string>;
    delete env["ALICLOUD_ACCESS_KEY_SECRET"];
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(env, () => runner().invoke(cli, ["config", "get", "access_key_secret"])),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("not set");
  });

  it("test_list_masks_access_key_secret", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(
      path.join(tmp, ".env"),
      `ALICLOUD_ACCESS_KEY_ID=${EXAMPLE_ACCESS_KEY_ID}\nALICLOUD_ACCESS_KEY_SECRET=SecretValue1234567890\n`,
    );
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("access_key_id");
    expect(result.output).toContain("access_key_secret");
    // AK id shown in full, SK masked.
    expect(result.output).toContain(EXAMPLE_ACCESS_KEY_ID);
    expect(result.output).not.toContain("SecretValue1234567890");
    expect(result.output).toContain("***");
  });

  it("test_set_get_round_trip_env_var_names", async () => {
    // config set must write the env-var names the transport layer reads.
    const envVars = new Set(_ENV_VAR_MAP.map(([ev]) => ev));
    expect(envVars.has("ALICLOUD_ACCESS_KEY_ID")).toBe(true);
    expect(envVars.has("ALICLOUD_ACCESS_KEY_SECRET")).toBe(true);

    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    await withConfig(storagePatch(tmp, { env: true }), async () => {
      await runner().invoke(cli, ["config", "set", "access_key_id", "Ak1"]);
      await runner().invoke(cli, ["config", "set", "access_key_secret", "Sk1"]);
    });

    const content = readText(envFile);
    expect(content).toContain("ALICLOUD_ACCESS_KEY_ID=Ak1");
    expect(content).toContain("ALICLOUD_ACCESS_KEY_SECRET=Sk1");
  });
});

describe("TestConfigSetEmpty", () => {
  // `abx config set KEY ""` clears the stored value (empty is never stored).

  it("test_clear_toml_value_falls_back_to_default", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    fs.writeFileSync(configFile, '[transport]\nregion = "cn-shanghai"\n');
    const result = await withConfig(storagePatch(tmp), () => withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "set", "region", ""])));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Cleared region");
    expect(result.output).toContain("cn-hangzhou"); // falls back to the built-in default
    expect(exists(configFile)).toBe(false);
  });

  it("test_clear_then_get_falls_back_to_default", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, "config.toml"), '[transport]\nregion = "cn-shanghai"\n');
    const result = await withConfig(storagePatch(tmp), () =>
      withEnv(cleanEnv(), async () => {
        await runner().invoke(cli, ["config", "set", "region", ""]);
        return await runner().invoke(cli, ["config", "get", "region"]);
      }),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output.trim()).toBe("cn-hangzhou");
  });

  it("test_clear_value_without_default_becomes_not_set", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, "config.toml"), '[transport]\nllm_model = "qwen-plus"\n');
    const result = await withConfig(storagePatch(tmp), () => withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "set", "llm_model", ""])));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Cleared llm_model");
    expect(result.output).toContain("falls back to default: qwen3-coder-plus");
  });

  it("test_clear_credential_removes_env_entry", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    fs.writeFileSync(envFile, "ABX_SANDBOX_API_KEY=sk-test-abcdef123456\n");
    const [result, getResult] = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(cleanEnv(), async () => [
        await runner().invoke(cli, ["config", "set", "sandbox_api_key", ""]),
        await runner().invoke(cli, ["config", "get", "sandbox_api_key"]),
      ]),
    );

    expect(result!.exit_code).toBe(0);
    expect(result!.output).toContain("Cleared sandbox_api_key");
    expect(result!.output).not.toContain("sk-test-abcdef123456");
    // The key truly returns to not-set: no empty-string credential remains.
    expect(getResult!.output).toContain("not set");
    expect(exists(envFile)).toBe(false);
  });

  it("test_clear_keeps_other_env_entries", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    fs.writeFileSync(envFile, "ABX_SANDBOX_API_KEY=sk-test-abcdef123456\nGITHUB_TOKEN=gh-token-12345678\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "set", "sandbox_api_key", ""])),
    );

    expect(result.exit_code).toBe(0);
    const content = readText(envFile);
    expect(content).not.toContain("ABX_SANDBOX_API_KEY");
    expect(content).toContain("GITHUB_TOKEN=gh-token-12345678");
  });

  it("test_clear_without_stored_value", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "set", "region", ""])));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("No stored value for region");
  });

  it("test_clear_reports_env_override_without_value", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, "config.toml"), '[transport]\nregion = "cn-shanghai"\n');
    const result = await withConfig(storagePatch(tmp), () =>
      withEnv(cleanEnv({ ALIBABA_CLOUD_REGION_ID: "cn-zhangjiakou" }), () => runner().invoke(cli, ["config", "set", "region", ""])),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Cleared region");
    expect(result.output).toContain("ALIBABA_CLOUD_REGION_ID still overrides");
    // The env value itself must never be printed.
    expect(result.output).not.toContain("cn-zhangjiakou");
  });
});

describe("TestConfigResetRemoved", () => {
  it("test_reset_subcommand_is_gone", async () => {
    const result = await runner().invoke(cli, ["config", "reset", "--yes"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such command");
  });
});

describe("TestConfigDelete", () => {
  // ``abx config delete KEY`` removes one stored value.

  it("test_delete_removes_one_credential_and_keeps_the_rest", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    fs.writeFileSync(envFile, "ABX_SANDBOX_API_KEY=sk-test-abcdef123456\nACR_NAMESPACE=my-ns\n");
    const [result, remaining] = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(cleanEnv(), async () => [
        await runner().invoke(cli, ["config", "delete", "sandbox_api_key"]),
        await runner().invoke(cli, ["config", "get", "acr_namespace"]),
      ]),
    );

    expect(result!.exit_code, result!.output).toBe(0);
    expect(result!.output).toContain("Cleared sandbox_api_key");
    expect(result!.output).not.toContain("sk-test-abcdef123456");
    expect(readText(envFile)).not.toContain("ABX_SANDBOX_API_KEY");
    expect(readText(envFile)).toContain("ACR_NAMESPACE=my-ns");
    expect(remaining!.output).toContain("my-ns");
  });

  it("test_delete_region_falls_back_to_the_default", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    fs.writeFileSync(configFile, '[transport]\nregion = "cn-shanghai"\n');
    const [result, got] = await withConfig(storagePatch(tmp), () =>
      withEnv(cleanEnv(), async () => [
        await runner().invoke(cli, ["config", "delete", "region"]),
        await runner().invoke(cli, ["config", "get", "region"]),
      ]),
    );

    expect(result!.exit_code, result!.output).toBe(0);
    expect(result!.output).toContain("Cleared region");
    expect(got!.output).toContain("cn-hangzhou");
    // The file held only the region, so removing it deletes the file.
    expect(exists(configFile)).toBe(false);
  });

  it("test_delete_unknown_key_is_rejected", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "delete", "not_a_key"]));

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Unknown config key");
  });

  it("test_delete_reports_an_env_override_without_its_value", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, "config.toml"), '[transport]\nregion = "cn-shanghai"\n');
    const result = await withConfig(storagePatch(tmp), () =>
      withEnv(cleanEnv({ ALIBABA_CLOUD_REGION_ID: "cn-zhangjiakou" }), () => runner().invoke(cli, ["config", "delete", "region"])),
    );

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("ALIBABA_CLOUD_REGION_ID still overrides");
    expect(result.output).not.toContain("cn-zhangjiakou");
  });
});

describe("TestConfigListSources", () => {
  // config list shows effective values and their sources; secrets masked.

  it("test_list_groups_keys_by_function", async () => {
    // config list renders the functional groups in a stable order.
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp, { env: true }), () => withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "list"])));

    expect(result.exit_code).toBe(0);
    const titles = lines(result.output).filter((ln) => ln.startsWith("── "));
    const expectedTitles = ["Sandbox authentication", "Alibaba Cloud credentials", "Connection", "LLM", "Integrations"];
    expect(titles.map((t) => t.slice(3).replace(/─+$/, "").trim())).toEqual(expectedTitles);
    // Every group header renders as a full 64-character rule.
    expect(titles.every((t) => [...t].length === 64)).toBe(true);
    // No qwen_code_* keys remain on the config surface.
    expect(result.output).not.toContain("qwen_code_");
    // Grouped key order: connection keys follow the cloud credentials.
    const all = lines(result.output);
    const regionIdx = all.findIndex((ln) => ln.startsWith("region"));
    const domainIdx = all.findIndex((ln) => ln.startsWith("sandbox_domain"));
    expect(regionIdx).toBeLessThan(domainIdx);
  });

  it("test_list_shows_not_set_for_keys_without_default", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp, { env: true }), () => withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "list"])));

    expect(result.exit_code).toBe(0);
    const line = lines(result.output).find((ln) => ln.startsWith("llm_api_key"))!;
    expect(line).toContain("(not set)");
    for (const [key, dflt] of [
      ["llm_base_url", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
      ["llm_model", "qwen3-coder-plus"],
    ] as const) {
      const row = lines(result.output).find((ln) => ln.startsWith(key))!;
      expect(row).toContain(`${dflt} (default)`);
    }
  });

  it("test_list_marks_env_source", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () =>
      withEnv(cleanEnv({ ALIBABA_CLOUD_REGION_ID: "cn-shanghai" }), () => runner().invoke(cli, ["config", "list"])),
    );

    expect(result.exit_code).toBe(0);
    const line = lines(result.output).find((ln) => ln.startsWith("region"))!;
    expect(line).toContain("cn-shanghai (env)");
  });

  it("test_list_masks_secret_with_user_source", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), "ABX_SANDBOX_API_KEY=sk-test-abcdef123456\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () => withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "list"])));

    expect(result.exit_code).toBe(0);
    const line = lines(result.output).find((ln) => ln.startsWith("sandbox_api_key"))!;
    expect(line).toContain("***");
    expect(line).toContain("(user)");
    expect(result.output).not.toContain("sk-test-abcdef123456");
  });
});

describe("TestConfigGithubToken", () => {
  // github_token: env-stored, masked, clearable, mapped to GITHUB_TOKEN (206).

  it("test_set_writes_env_file_and_masks_output", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const envFile = path.join(tmp, ".env");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["config", "set", "github_token", "ghp_test1234567890"]),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("github_token");
    // Sensitive: masked in output, stored verbatim under the env-var name.
    expect(result.output).not.toContain("ghp_test1234567890");
    expect(result.output).toContain("***");
    expect(readText(envFile)).toBe("GITHUB_TOKEN=ghp_test1234567890\n");
    expect(exists(configFile)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("test_set_restricts_env_file_permissions", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      runner().invoke(cli, ["config", "set", "github_token", "ghp_test1234567890"]),
    );

    expect(result.exit_code).toBe(0);
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);
  });

  it("test_get_masks_stored_token", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), "GITHUB_TOKEN=ghp_stored1234567890\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "get", "github_token"])),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("***");
    expect(result.output).not.toContain("ghp_stored1234567890");
  });

  it("test_get_prefers_process_env_and_masks_both", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), "GITHUB_TOKEN=ghp_stored1234567890\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(cleanEnv({ GITHUB_TOKEN: "ghp_placeholder_token" }), () => runner().invoke(cli, ["config", "get", "github_token"])),
    );

    expect(result.exit_code).toBe(0);
    // The process environment wins; neither value is ever printed.
    expect(result.output).not.toContain("ghp_placeholder_token");
    expect(result.output).not.toContain("ghp_stored1234567890");
    expect(result.output).toContain("***");
  });

  it("test_get_not_set", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "get", "github_token"])),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("not set");
  });

  it("test_list_masks_github_token", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), "GITHUB_TOKEN=ghp_stored1234567890\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () => withEnv(cleanEnv(), () => runner().invoke(cli, ["config", "list"])));

    expect(result.exit_code).toBe(0);
    const line = lines(result.output).find((ln) => ln.startsWith("github_token"))!;
    expect(line).toContain("***");
    expect(line).toContain("(user)");
    expect(result.output).not.toContain("ghp_stored1234567890");
  });

  it("test_clear_removes_stored_token_but_keeps_others", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    fs.writeFileSync(envFile, "GITHUB_TOKEN=ghp_stored1234567890\nABX_SANDBOX_API_KEY=sk-test-abcdef123456\n");
    const [result, getResult] = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(cleanEnv(), async () => [
        await runner().invoke(cli, ["config", "set", "github_token", ""]),
        await runner().invoke(cli, ["config", "get", "github_token"]),
      ]),
    );

    expect(result!.exit_code).toBe(0);
    expect(result!.output).toContain("Cleared github_token");
    expect(result!.output).not.toContain("ghp_stored1234567890");
    expect(getResult!.output).toContain("not set");
    const content = readText(envFile);
    expect(content).not.toContain("GITHUB_TOKEN");
    expect(content).toContain("ABX_SANDBOX_API_KEY=sk-test-abcdef123456");
  });

  it("test_clear_reports_env_override_without_value", async () => {
    const tmp = tmpPath();
    fs.writeFileSync(path.join(tmp, ".env"), "GITHUB_TOKEN=ghp_stored1234567890\n");
    const result = await withConfig(storagePatch(tmp, { env: true }), () =>
      withEnv(cleanEnv({ GITHUB_TOKEN: "ghp_placeholder_token" }), () => runner().invoke(cli, ["config", "set", "github_token", ""])),
    );

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("GITHUB_TOKEN still overrides");
    expect(result.output).not.toContain("ghp_placeholder_token");
  });
});

describe("TestResolveGithubToken", () => {
  // Precedence: --token > process GITHUB_TOKEN > ./.env > stored github_token.

  /** Patch the .env file (optionally pre-seeded) and the process env; the returned runner wraps one assertion block. */
  async function withPatches<T>(tmp: string, opts: { stored?: string; env?: string }, fn: () => T): Promise<T> {
    const envFile = path.join(tmp, ".env");
    if (opts.stored !== undefined) fs.writeFileSync(envFile, `GITHUB_TOKEN=${opts.stored}\n`);
    const overrides = opts.env !== undefined ? cleanEnv({ GITHUB_TOKEN: opts.env }) : cleanEnv();
    return await withConfig({ _ABX_DIR: tmp, _ENV_FILE: envFile }, () => withEnv(overrides, fn));
  }

  it("test_explicit_flag_beats_env_and_stored", async () => {
    await withPatches(tmpPath(), { stored: "stored-token", env: "env-token" }, () => {
      expect(resolveGithubToken("explicit-token")).toBe("explicit-token");
    });
  });

  it("test_process_env_beats_stored", async () => {
    await withPatches(tmpPath(), { stored: "stored-token", env: "env-token" }, () => {
      expect(resolveGithubToken()).toBe("env-token");
    });
  });

  it("test_stored_token_is_used_as_last_resort", async () => {
    await withPatches(tmpPath(), { stored: "stored-token" }, () => {
      expect(resolveGithubToken()).toBe("stored-token");
    });
  });

  it("test_no_token_returns_none", async () => {
    await withPatches(tmpPath(), {}, () => {
      expect(resolveGithubToken(null)).toBeNull();
    });
  });

  it("test_blank_values_are_ignored", async () => {
    await withPatches(tmpPath(), { stored: "stored-token", env: "   " }, () => {
      // A whitespace-only --token must not shadow the stored token.
      expect(resolveGithubToken("  ")).toBe("stored-token");
      // …and the returned value is stripped.
      expect(resolveGithubToken(" explicit ")).toBe("explicit");
    });
  });
});

describe("TestConfigSetMissingValue", () => {
  // ``abx config set KEY`` without VALUE: masked prompt in a TTY, exit 2 otherwise.

  it("test_non_tty_exits_2_with_ci_secret_hint", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp, { env: true }), () => runner().invoke(cli, ["config", "set", "github_token"]));

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Missing VALUE");
    const stderr = result.stderr || "";
    expect(stderr).toContain("abx config set github_token <VALUE>");
    // Env-stored keys point CI users at secret injection.
    expect(stderr).toContain("GITHUB_TOKEN");
    expect(stderr.toLowerCase()).toContain("secret");
    expect(exists(path.join(tmp, ".env"))).toBe(false);
  });

  it("test_non_tty_plain_key_omits_secret_hint", async () => {
    const tmp = tmpPath();
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "region"]));

    expect(result.exit_code).toBe(2);
    const stderr = result.stderr || "";
    expect(stderr).toContain("abx config set region <VALUE>");
    expect(stderr.toLowerCase()).not.toContain("secret");
  });

  it("test_tty_sensitive_key_reuses_masked_prompt", async () => {
    const tmp = tmpPath();
    const envFile = path.join(tmp, ".env");
    const mockPrompt = vi.fn(async (_text: string) => "ghp_masked1234567890");
    const result = await withConfig({ ...storagePatch(tmp, { env: true }), sys: fakeTtySys(), _promptSecret: mockPrompt }, () =>
      runner().invoke(cli, ["config", "set", "github_token"]),
    );

    expect(result.exit_code, result.output).toBe(0);
    // The task-201 asterisk input is reused, not re-implemented.
    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(readText(envFile)).toBe("GITHUB_TOKEN=ghp_masked1234567890\n");
    expect(result.output).not.toContain("ghp_masked1234567890");
    expect(result.output).toContain("***");
  });

  it("test_tty_empty_input_changes_nothing", async () => {
    const tmp = tmpPath();
    const result = await withConfig(
      { ...storagePatch(tmp, { env: true }), sys: fakeTtySys(), _promptSecret: async () => "   " },
      () => runner().invoke(cli, ["config", "set", "github_token"]),
    );

    expect(result.exit_code, result.output).toBe(0);
    // Enter means "cancel", never "clear" - clearing needs the explicit "".
    expect(result.output).toContain("No value entered");
    expect(exists(path.join(tmp, ".env"))).toBe(false);
  });

  it("test_tty_abort_exits_without_writing", async () => {
    const tmp = tmpPath();
    const result = await withConfig(
      {
        ...storagePatch(tmp, { env: true }),
        sys: fakeTtySys(),
        _promptSecret: async () => {
          throw new Abort();
        },
      },
      () => runner().invoke(cli, ["config", "set", "github_token"]),
    );

    expect(result.exit_code).toBe(1);
    expect(exists(path.join(tmp, ".env"))).toBe(false);
  });

  it("test_tty_plain_key_prompts_visibly", async () => {
    const tmp = tmpPath();
    const configFile = path.join(tmp, "config.toml");
    const result = await withConfig({ ...storagePatch(tmp), sys: fakeTtySys() }, () =>
      runner().invoke(cli, ["config", "set", "region"], { input: "cn-shanghai\n" }),
    );

    expect(result.exit_code, result.output).toBe(0);
    expect(readText(configFile)).toContain('region = "cn-shanghai"');
    expect(result.output).toContain("cn-shanghai");
  });
});

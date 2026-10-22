/** Tests for transport.config module. */

import fs from "node:fs";
import path from "node:path";

import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { ValidationError } from "../../src/models/base.js";
import {
  TransportConfig,
  _setConfigFile,
  _setEnvFileCandidates,
  httpTimeoutConfigured as http_timeout_configured,
  loadConfig as load_config,
  resetConfig as reset_config,
} from "../../src/transport/config.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";

// Autouse fixtures: tests/conftest.py + tests/test_transport/conftest.py
const iso = useIsolatedEnv();
useTransportIsolation(iso);

describe("TestTransportConfigDefaults", () => {
  // Test default values of TransportConfig.

  it("test_default_api_url", () => {
    const cfg = new TransportConfig();
    expect(cfg.domain).toBe("cn-hangzhou.e2b.fc.aliyuncs.com");
    expect(cfg.api_url).toBe("https://api.cn-hangzhou.e2b.fc.aliyuncs.com");
    // backward-compat property still works
  });

  it("test_default_region", () => {
    const cfg = new TransportConfig();
    expect(cfg.region).toBe("cn-hangzhou");
  });

  it("test_default_auth_fields_none", () => {
    const cfg = new TransportConfig();
    expect(cfg.api_key).toBeNull();
    expect(cfg.access_key_id).toBeNull();
    expect(cfg.access_key_secret).toBeNull();
  });

  it("test_default_http_settings", () => {
    const cfg = new TransportConfig();
    expect(cfg.http_timeout).toBe(30.0);
    expect(cfg.max_connections).toBe(100);
    expect(cfg.max_keepalive_connections).toBe(20);
    expect(cfg.keepalive_expiry).toBe(30.0);
    expect(cfg.http2).toBe(true);
  });

  it("test_default_ws_settings", () => {
    const cfg = new TransportConfig();
    expect(cfg.ws_ping_interval).toBe(30.0);
  });

});

describe("TestTransportConfigValidation", () => {
  // Test field validation constraints.

  it("test_http_timeout_minimum", () => {
    expect(() => new TransportConfig({ http_timeout: 0.5 })).toThrow(ValidationError);
  });

  it("test_max_connections_minimum", () => {
    expect(() => new TransportConfig({ max_connections: 0 })).toThrow(ValidationError);
  });

  it("test_ws_ping_interval_minimum", () => {
    expect(() => new TransportConfig({ ws_ping_interval: 0.5 })).toThrow(ValidationError);
  });



  it("test_extra_fields_ignored", () => {
    const cfg = new TransportConfig({ unknown_field: "value" });
    expect("unknown_field" in cfg).toBe(false);
  });

  it("test_valid_custom_values", () => {
    const cfg = new TransportConfig({
      api_url: "https://custom.example.com",
      region: "us-west-1",
      http_timeout: 60.0,
    });
    expect(cfg.api_url).toBe("https://custom.example.com");
    expect(cfg.region).toBe("us-west-1");
    expect(cfg.http_timeout).toBe(60.0);
  });
});

describe("TestLoadConfig", () => {
  // Test load_config with various layers.

  beforeEach(() => {
    reset_config();
  });
  afterEach(() => {
    reset_config();
  });

  it("test_load_default_config", () => {
    const cfg = load_config();
    expect(cfg.api_url).toBe("https://api.cn-hangzhou.e2b.fc.aliyuncs.com");
    expect(cfg.region).toBe("cn-hangzhou");
  });

  it("test_load_config_with_overrides", () => {
    const cfg = load_config({ region: "us-east-1", http_timeout: 60.0 });
    expect(cfg.region).toBe("us-east-1");
    expect(cfg.http_timeout).toBe(60.0);
  });

  it("test_load_config_caching", () => {
    const cfg1 = load_config();
    const cfg2 = load_config();
    expect(cfg1).toBe(cfg2);
  });

  it("test_load_config_no_cache_with_overrides", () => {
    const cfg1 = load_config();
    const cfg2 = load_config({ region: "us-west-1" });
    expect(cfg1).not.toBe(cfg2);
    expect(cfg2.region).toBe("us-west-1");
  });

  it("test_reset_config_clears_cache", () => {
    const cfg1 = load_config();
    reset_config();
    const cfg2 = load_config();
    expect(cfg1).not.toBe(cfg2);
  });

  it("test_env_var_api_key", () => {
    reset_config();
    iso.monkeypatch.setenv("ABX_SANDBOX_API_KEY", "test-key-from-env");
    const cfg = load_config();
    expect(cfg.api_key).toBe("test-key-from-env");
  });

  it("test_env_var_region", () => {
    reset_config();
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "ap-southeast-1");
    const cfg = load_config();
    expect(cfg.region).toBe("ap-southeast-1");
  });

  it("test_env_var_base_url", () => {
    reset_config();
    iso.monkeypatch.setenv("ABX_SANDBOX_BASE_URL", "https://custom.api.com");
    const cfg = load_config();
    expect(cfg.api_url).toBe("https://custom.api.com");
  });

  it("test_env_var_http_timeout", () => {
    reset_config();
    iso.monkeypatch.setenv("ABX_HTTP_TIMEOUT", "45.0");
    const cfg = load_config();
    expect(cfg.http_timeout).toBe(45.0);
  });

  it("test_env_var_ak_sk", () => {
    reset_config();
    iso.monkeypatch.setenv("ALICLOUD_ACCESS_KEY_ID", "ak-test");
    iso.monkeypatch.setenv("ALICLOUD_ACCESS_KEY_SECRET", "sk-test");
    const cfg = load_config();
    expect(cfg.access_key_id).toBe("ak-test");
    expect(cfg.access_key_secret).toBe("sk-test");
  });

  it("test_code_override_beats_env", () => {
    reset_config();
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "from-env");
    const cfg = load_config({ region: "from-code" });
    expect(cfg.region).toBe("from-code");
  });

  it("test_none_override_does_not_clobber", () => {
    reset_config();
    iso.monkeypatch.setenv("ABX_SANDBOX_API_KEY", "env-key");
    const cfg = load_config({ api_key: null });
    expect(cfg.api_key).toBe("env-key");
  });

  it("test_retired_api_key_names_are_ignored", () => {
    reset_config();
    iso.monkeypatch.setenv("E2B_API_KEY", "e2b-test-key");
    iso.monkeypatch.setenv("SANDBOX_API_KEY", "sandbox-key");
    const cfg = load_config();
    expect(cfg.api_key).toBeNull();
  });

  it("test_retired_url_and_domain_names_are_ignored", () => {
    reset_config();
    iso.monkeypatch.setenv("E2B_API_URL", "https://e2b-custom.api.com");
    iso.monkeypatch.setenv("SANDBOX_API_BASE_URL", "https://sandbox.api.com");
    iso.monkeypatch.setenv("E2B_DOMAIN", "custom.e2b.domain");
    const cfg = load_config();
    expect(cfg.api_url).toBe("https://api.cn-hangzhou.e2b.fc.aliyuncs.com");
    expect(cfg.domain).toBe("cn-hangzhou.e2b.fc.aliyuncs.com");
  });

  it("test_canonical_names_win_over_retired_ones", () => {
    reset_config();
    iso.monkeypatch.setenv("SANDBOX_API_KEY", "sandbox-key");
    iso.monkeypatch.setenv("E2B_API_KEY", "e2b-key");
    iso.monkeypatch.setenv("ABX_SANDBOX_API_KEY", "canon-key");
    iso.monkeypatch.setenv("E2B_API_URL", "https://e2b.api.com");
    iso.monkeypatch.setenv("ABX_SANDBOX_BASE_URL", "https://canon.api.com");
    const cfg = load_config();
    expect(cfg.api_key).toBe("canon-key");
    expect(cfg.api_url).toBe("https://canon.api.com");
  });
});

describe("TestDotenvIsolation", () => {
  // Regression tests for the .env / process-env isolation contract.
  //
  // Guards against the real repository `.env` (discovered via the CWD-relative `Path(".env")` candidate) leaking real
  // credentials into tests, while confirming that explicit dotenv paths still load and that process env keeps
  // priority over `.env` values. All values used here are fabricated fakes.

  beforeEach(() => {
    reset_config();
  });
  afterEach(() => {
    reset_config();
  });

  it("test_repo_dotenv_in_cwd_is_not_read", () => {
    // A `.env` sitting in the CWD must not leak into the loaded config.
    //
    // Simulates running the suite from a directory that contains a real `.env` full of credentials; the autouse
    // isolation fixture must keep those values out of `load_config()`.
    const tmp_path = iso.tmp_path;
    const cwd_env = path.join(tmp_path, ".env");
    fs.writeFileSync(
      cwd_env,
      "ABX_SANDBOX_API_KEY=fake-should-not-load\n" + "ALICLOUD_ACCESS_KEY_ID=fake-ak\n" + "ALICLOUD_ACCESS_KEY_SECRET=fake-sk\n",
      "utf-8",
    );
    iso.monkeypatch.chdir(tmp_path);
    // Sanity: the CWD-relative candidate would resolve to our fake file.
    expect(path.resolve(".env")).toBe(path.resolve(cwd_env));

    const cfg = load_config();
    expect(cfg.api_key).toBeNull();
    expect(cfg.access_key_id).toBeNull();
    expect(cfg.access_key_secret).toBeNull();
  });

  it("test_explicit_dotenv_path_is_loaded", () => {
    // Pointing the candidate list at an explicit `.env` still works.
    const explicit_env = path.join(iso.tmp_path, "explicit.env");
    fs.writeFileSync(explicit_env, "ALIBABA_CLOUD_REGION_ID=explicit-region\n", "utf-8");
    _setEnvFileCandidates([explicit_env]);
    reset_config();

    const cfg = load_config();
    expect(cfg.region).toBe("explicit-region");
  });

  it("test_project_dotenv_falls_through_to_system_file", () => {
    // A project .env that omits a key must not hide ~/.abx/.env.
    const project = path.join(iso.tmp_path, "project.env");
    const system = path.join(iso.tmp_path, "system.env");
    fs.writeFileSync(project, "ALIBABA_CLOUD_REGION_ID=from-project\n", "utf-8");
    fs.writeFileSync(system, "ABX_SANDBOX_API_KEY=from-system\n", "utf-8");
    _setEnvFileCandidates([project, system]);
    reset_config();

    const cfg = load_config();
    expect(cfg.api_key).toBe("from-system");
    expect(cfg.region).toBe("from-project");
  });

  it("test_project_dotenv_key_beats_system_file", () => {
    const project = path.join(iso.tmp_path, "project.env");
    const system = path.join(iso.tmp_path, "system.env");
    fs.writeFileSync(project, "ABX_SANDBOX_API_KEY=from-project\n", "utf-8");
    fs.writeFileSync(system, "ABX_SANDBOX_API_KEY=from-system\n", "utf-8");
    _setEnvFileCandidates([project, system]);
    reset_config();

    const cfg = load_config();
    expect(cfg.api_key).toBe("from-project");
  });

  it("test_process_env_beats_dotenv", () => {
    // Process env vars (layer 2) keep priority over `.env` (layer 3).
    const explicit_env = path.join(iso.tmp_path, "explicit.env");
    fs.writeFileSync(explicit_env, "ALIBABA_CLOUD_REGION_ID=from-dotenv\n", "utf-8");
    _setEnvFileCandidates([explicit_env]);
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "from-env");
    reset_config();

    const cfg = load_config();
    expect(cfg.region).toBe("from-env");
  });

  it("test_blank_process_env_and_override_fall_through", () => {
    // Whitespace does not hide a key stored in .env or config.toml.
    const dotenv = path.join(iso.tmp_path, "system.env");
    fs.writeFileSync(dotenv, "ABX_SANDBOX_API_KEY=from-dotenv\n", "utf-8");
    const toml = path.join(iso.tmp_path, "config.toml");
    fs.writeFileSync(toml, '[transport]\nregion = "cn-beijing"\n', "utf-8");
    _setEnvFileCandidates([dotenv]);
    _setConfigFile(toml);
    iso.monkeypatch.setenv("ABX_SANDBOX_API_KEY", "   ");
    iso.monkeypatch.setenv("ALIBABA_CLOUD_REGION_ID", "  ");
    reset_config();

    const cfg = load_config({ api_key: "  ", region: "   " });
    expect(cfg.api_key).toBe("from-dotenv");
    expect(cfg.region).toBe("cn-beijing");
  });
});

describe("TestHttpTimeoutConfigured", () => {
  // Test http_timeout_configured() source detection (no defaults applied).

  /** Point all config sources at empty temp locations. */
  const _isolate = (): string => {
    iso.monkeypatch.delenv("ABX_HTTP_TIMEOUT");
    iso.monkeypatch.delenv("SANDBOX_HTTP_TIMEOUT");
    _setEnvFileCandidates([]);
    const cfg_file = path.join(iso.tmp_path, "config.toml");
    _setConfigFile(cfg_file);
    return cfg_file;
  };

  it("test_false_when_nothing_set", () => {
    _isolate();
    expect(http_timeout_configured()).toBe(false);
  });

  it("test_true_when_env_var_set", () => {
    _isolate();
    iso.monkeypatch.setenv("ABX_HTTP_TIMEOUT", "60");
    expect(http_timeout_configured()).toBe(true);
  });

  it("test_true_when_toml_has_key", () => {
    const cfg_file = _isolate();
    fs.writeFileSync(cfg_file, "[transport]\nhttp_timeout = 90.0\n", "utf-8");
    expect(http_timeout_configured()).toBe(true);
  });

  it("test_true_when_dotenv_has_key", () => {
    _isolate();
    const dotenv = path.join(iso.tmp_path, ".env");
    fs.writeFileSync(dotenv, "ABX_HTTP_TIMEOUT=75\n", "utf-8");
    _setEnvFileCandidates([dotenv]);
    expect(http_timeout_configured()).toBe(true);
  });
});

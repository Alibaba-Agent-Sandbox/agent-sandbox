import * as settings from "../../src/providers/settings.js";
/** Public setup contract: actual layered/legacy consumers, storage, cancellation and safe continuation. */
import "../_support/isolatedHome.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { withGuidedConfiguration, guidanceSeams } from "../../src/cli/config_guidance.js";
import { _effectiveValue, configSeams } from "../../src/cli/commands/config_cmd.js";
import { getOperationConfig } from "../../src/utils/operation_config.js";
import { loadLayeredConfig } from "../../src/transport/config_layers.js";
import * as transport from "../../src/transport/config.js";
import { Provider, type ConfigField, type ProviderInfra } from "../../src/providers/base.js";
import { registerProvider } from "../../src/providers/registry.js";
import { dotenvValues } from "../../src/utils/_dotenv.js";
import { Abort } from "../../src/cli/errors.js";
import { useIso } from "../_support/iso.js";
import { storagePatch } from "../helpers/configSupport.js";
import { useCapsys } from "./conftest.js";

const iso = useIso();
const cap = useCapsys();
let restore = (): void => undefined;
beforeEach(() => {
  const config = { ...configSeams };
  const old = { directory: transport._ABX_DIR, file: transport._CONFIG_FILE, env: transport._ENV_FILE_CANDIDATES, project: transport._PROJECT_ENV_FILE };
  Object.assign(configSeams, storagePatch(iso.home, { env: true }));
  transport._setAbxDir(iso.home); transport._setConfigFile(iso.toml);
  transport._setEnvFileCandidates([iso.env]); transport._setProjectEnvFile(path.join(iso.root, ".env"));
  transport.resetConfig();
  vi.spyOn(guidanceSeams, "interactive").mockReturnValue(true);
  restore = () => {
    Object.assign(configSeams, config);
    transport._setAbxDir(old.directory); transport._setConfigFile(old.file);
    transport._setEnvFileCandidates(old.env); transport._setProjectEnvFile(old.project);
    transport.resetConfig();
  };
});
afterEach(() => { restore(); vi.restoreAllMocks(); });

function answers(...values: string[]): MockInstance<typeof guidanceSeams.ask> {
  const remaining = [...values];
  return vi.spyOn(guidanceSeams, "ask").mockImplementation(async () => {
    if (!remaining.length) throw new Error("Unexpected additional configuration question");
    return remaining.shift()!;
  });
}

function example(fields: ConfigField[], groups: readonly (readonly string[])[] = []): Provider {
  class GuidanceProvider extends Provider {
    readonly id = "guidance-example";
    override async buildInfra(): Promise<ProviderInfra> { throw new Error("setup must not create a network client"); }
  }
  const provider = new GuidanceProvider();
  provider.configFields = fields;
  provider.authAnyOf = groups;
  registerProvider(provider);
  return provider;
}

const request = (requirements: readonly string[] = []) => ({ operation: "test operation", provider: "alicloud-express", requirements });
const unchanged = (): void => {
  expect(fs.existsSync(iso.env)).toBe(false);
  expect(fs.existsSync(iso.toml)).toBe(false);
  expect(getOperationConfig()).toBeUndefined();
};

describe("one-operation configuration", () => {
  it("reaches both real consumers and profile readers without files or environment changes", async () => {
    answers("1", "placeholder-api", "placeholder-namespace", "placeholder-ak", "placeholder-sk");
    const environment = { ...process.env };
    await withGuidedConfiguration(undefined, request(["sandbox_api_key", "acr_namespace", "access_key_id", "access_key_secret"]), async () => {
      const layered = loadLayeredConfig();
      const legacy = transport.loadConfig();
      expect(layered.sandbox_api_key).toBe("placeholder-api");
      expect(legacy.api_key).toBe("placeholder-api");
      expect(layered.access_key_id).toBe("placeholder-ak");
      expect(legacy.access_key_secret).toBe("placeholder-sk");
      expect(_effectiveValue("acr_namespace")[0]).toBe("placeholder-namespace");
      expect(fs.existsSync(iso.env)).toBe(false);
      expect(process.env).toEqual(environment);
    });
    unchanged();
    expect(transport.loadConfig().api_key).toBeNull();
    expect(loadLayeredConfig().sandbox_api_key).toBeNull();
    expect(process.env).toEqual(environment);
    const { out, err } = cap.readouterr();
    expect(out + err).not.toContain("placeholder-api");
    expect(out + err).not.toContain("placeholder-sk");
  });

  it("keeps nested safe stages on the same temporary identity without asking twice", async () => {
    const ask = answers("1", "placeholder-api");
    await withGuidedConfiguration(undefined, request(["sandbox_api_key"]), async () => {
      await withGuidedConfiguration(undefined, request(["sandbox_api_key"]), async () => {
        expect(transport.loadConfig().api_key).toBe("placeholder-api");
      });
      expect(transport.loadConfig().api_key).toBe("placeholder-api");
    });
    expect(ask).toHaveBeenCalledTimes(2);
    unchanged();
  });

  it("prefers the current Provider-scoped snapshot over stale adapter values", async () => {
    iso.setenv("ABX_ALICLOUD_EXPRESS_SANDBOX_API_KEY", "placeholder-current");
    const ask = answers();
    await withGuidedConfiguration(undefined, { ...request(["sandbox_api_key"]), values: { sandbox_api_key: "placeholder-stale" } }, async () => {
      expect(transport.loadConfig().api_key).toBe("placeholder-current");
      expect(loadLayeredConfig().sandbox_api_key).toBe("placeholder-current");
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("does not satisfy a dynamic required http2 field using the transport default", async () => {
    const provider = example([{ key: "http2", type: "bool", required: true }]);
    vi.mocked(guidanceSeams.interactive).mockReturnValue(false);
    const ask = answers();
    const action = vi.fn(async () => undefined);
    await expect(withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, action)).rejects.toThrow("http2");
    expect(action).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    unchanged();
  });

  it("uses an explicitly configured Provider region without asking or borrowing the global region", async () => {
    const provider = example([{ key: "region", required: true }]);
    iso.setenv("ALIBABA_CLOUD_REGION_ID", "global-west");
    iso.setenv("ABX_GUIDANCE_EXAMPLE_REGION", "own-east");
    const ask = answers();
    await withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, async () => {
      expect(loadLayeredConfig({ provider: provider.id }).provider_options["region"]).toBe("own-east");
    });
    expect(ask).not.toHaveBeenCalled();
    unchanged();
  });

  it("requires a dynamic Provider region when only the unrelated global region is set", async () => {
    const provider = example([{ key: "region", required: true }]);
    iso.setenv("ALIBABA_CLOUD_REGION_ID", "global-west");
    vi.mocked(guidanceSeams.interactive).mockReturnValue(false);
    const action = vi.fn(async () => undefined);
    await expect(withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, action)).rejects.toThrow("region");
    expect(action).not.toHaveBeenCalled();
    unchanged();
  });

  it("does not borrow an identically named Express secret for another Provider", async () => {
    const provider = example([{ key: "access_key_secret", required: true, secret: true, credential: true }]);
    iso.setenv("ALICLOUD_ACCESS_KEY_SECRET", "placeholder-other-provider");
    answers("1", "placeholder-own-provider");
    await withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, async () => {
      expect(loadLayeredConfig({ provider: provider.id }).provider_options["access_key_secret"]).toBe("placeholder-own-provider");
      expect(process.env["ALICLOUD_ACCESS_KEY_SECRET"]).toBe("placeholder-other-provider");
    });
    unchanged();
  });
});

describe("persistent configuration", () => {
  it("persists global LLM credentials and reports the true destination without echoing the value", async () => {
    answers("2", "placeholder-llm");
    await withGuidedConfiguration(undefined, request(["llm_api_key"]), async () => {
      expect(_effectiveValue("llm_api_key")[0]).toBe("placeholder-llm");
    });
    expect(dotenvValues(iso.env).get("ABX_LLM_API_KEY")).toBe("placeholder-llm");
    const { out, err } = cap.readouterr();
    expect(out + err).toContain(iso.env);
    expect(out + err).toContain("abx config set llm_api_key");
    expect(out + err).not.toContain("placeholder-llm");
  });

  it("persists inherited API credentials using a consumable Provider-scoped variable", async () => {
    answers("2", "placeholder-api");
    await withGuidedConfiguration(undefined, request(["sandbox_api_key"]), async () => {
      expect(transport.loadConfig().api_key).toBe("placeholder-api");
      expect(loadLayeredConfig().sandbox_api_key).toBe("placeholder-api");
    });
    expect(dotenvValues(iso.env).get("ABX_ALICLOUD_EXPRESS_SANDBOX_API_KEY")).toBe("placeholder-api");
    expect(loadLayeredConfig().sandbox_api_key).toBe("placeholder-api");
  });

  it("persists dynamic Provider fields through their own schema and reads them back", async () => {
    const provider = example([{ key: "token", required: true, secret: true }]);
    answers("2", "placeholder-provider");
    await withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, async () => {
      expect(loadLayeredConfig({ provider: provider.id }).provider_options["token"]).toBe("placeholder-provider");
    });
    expect(dotenvValues(iso.env).get("ABX_GUIDANCE_EXAMPLE_TOKEN")).toBe("placeholder-provider");
    expect(loadLayeredConfig({ provider: provider.id }).provider_options["token"]).toBe("placeholder-provider");
  });

  it("never starts an operation after a failed persistent write", async () => {
    answers("2", "placeholder-llm");
    vi.spyOn(settings, "setEnvValue").mockImplementation(() => { throw new Error("not writable"); });
    const action = vi.fn(async () => undefined);
    await expect(withGuidedConfiguration(undefined, request(["llm_api_key"]), action)).rejects.toThrow("Could not finish saving");
    expect(action).not.toHaveBeenCalled();
    unchanged();
  });

  it("stops if a newly appearing environment override prevents the saved value from taking effect", async () => {
    let calls = 0;
    vi.spyOn(guidanceSeams, "ask").mockImplementation(async () => {
      if (++calls === 1) return "2";
      iso.setenv("ABX_LLM_API_KEY", "placeholder-environment");
      return "placeholder-entered";
    });
    const action = vi.fn(async () => undefined);
    await expect(withGuidedConfiguration(undefined, request(["llm_api_key"]), action)).rejects.toThrow("overridden");
    expect(action).not.toHaveBeenCalled();
    expect(dotenvValues(iso.env).get("ABX_LLM_API_KEY")).toBe("placeholder-entered");
    const { out, err } = cap.readouterr();
    expect(out + err).not.toContain("placeholder-entered");
    expect(out + err).not.toContain("placeholder-environment");
  });
});

describe("authentication groups and typed fields", () => {
  it("asks for one chosen complete authentication combination", async () => {
    const provider = example([{ key: "token", secret: true }, { key: "client_id" }, { key: "client_secret", secret: true }], [["token"], ["client_id", "client_secret"]]);
    const ask = answers("2", "1", "placeholder-id", "placeholder-secret");
    await withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, async () => {
      expect(loadLayeredConfig({ provider: provider.id }).provider_options).toMatchObject({ client_id: "placeholder-id", client_secret: "placeholder-secret" });
      expect(loadLayeredConfig({ provider: provider.id }).provider_options["token"]).toBeUndefined();
    });
    expect(ask.mock.calls.slice(1).some(([label]) => label.includes("token"))).toBe(false);
    unchanged();
  });

  it("does not ask for another method if one authentication group is already complete", async () => {
    const provider = example([{ key: "token", secret: true }, { key: "client_id" }, { key: "client_secret", secret: true }], [["token"], ["client_id", "client_secret"]]);
    iso.setenv("ABX_GUIDANCE_EXAMPLE_TOKEN", "placeholder-existing");
    const ask = answers();
    await withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, async () => {
      expect(loadLayeredConfig({ provider: provider.id }).provider_options["token"]).toBe("placeholder-existing");
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks only for a missing half of the selected credential pair", async () => {
    const provider = example([{ key: "client_id" }, { key: "client_secret", secret: true }], [["client_id", "client_secret"]]);
    iso.setenv("ABX_GUIDANCE_EXAMPLE_CLIENT_ID", "placeholder-existing-id");
    const ask = answers("1", "placeholder-new-secret");
    await withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, async () => {
      expect(loadLayeredConfig({ provider: provider.id }).provider_options).toMatchObject({ client_id: "placeholder-existing-id", client_secret: "placeholder-new-secret" });
    });
    expect(ask.mock.calls.some(([label]) => label.startsWith("client_id"))).toBe(false);
    unchanged();
  });

  it("rejects an unusable authentication contract before asking or executing", async () => {
    const provider = example([], [["sandbox_api_key"]]);
    const ask = answers();
    const action = vi.fn(async () => undefined);
    await expect(withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, action)).rejects.toThrow("no usable authentication");
    expect(ask).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    unchanged();
  });

  it("repeats invalid typed input without echoing it or abandoning the command", async () => {
    const provider = example([{ key: "mode", type: "enum", choices: ["FAST", "SAFE"], required: true }]);
    const ask = answers("1", "placeholder-invalid", "safe");
    await withGuidedConfiguration(undefined, { operation: "provider operation", provider: provider.id }, async () => {
      expect(loadLayeredConfig({ provider: provider.id }).provider_options["mode"]).toBe("SAFE");
    });
    expect(ask).toHaveBeenCalledTimes(3);
    const { out, err } = cap.readouterr();
    expect(out + err).toContain("Invalid value");
    expect(out + err).not.toContain("placeholder-invalid");
    unchanged();
  });
});

describe("abort and error boundaries", () => {
  it("cancels before persistence or action, including after collecting another secret", async () => {
    answers("2", "placeholder-api", "");
    const action = vi.fn(async () => undefined);
    await expect(withGuidedConfiguration(undefined, request(["sandbox_api_key", "llm_api_key"]), action)).rejects.toBeInstanceOf(Abort);
    expect(action).not.toHaveBeenCalled();
    unchanged();
  });

  it("preserves an action failure and never repeats a submitted operation", async () => {
    answers("1", "placeholder-api");
    const submittedError = new Error("submitted operation timed out");
    const action = vi.fn(async () => { throw submittedError; });
    await expect(withGuidedConfiguration(undefined, request(["sandbox_api_key"]), action)).rejects.toBe(submittedError);
    expect(action).toHaveBeenCalledOnce();
    unchanged();
  });

  it("reports invalid explicit sources before asking or executing", async () => {
    iso.setenv("ABX_HTTP2", "placeholder-invalid");
    const ask = answers();
    const action = vi.fn(async () => undefined);
    await expect(withGuidedConfiguration(undefined, request(), action)).rejects.toThrow("ABX_HTTP2");
    expect(ask).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    unchanged();
  });

  it("reports malformed source files without exposing their contents or asking for replacement values", async () => {
    const malformed = '[transport]\nsecret = "placeholder-private\n';
    iso.writeToml(malformed);
    const ask = answers();
    const action = vi.fn(async () => undefined);
    await expect(withGuidedConfiguration(undefined, request(), action)).rejects.toThrow("Cannot parse configuration");
    expect(ask).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(fs.readFileSync(iso.toml, "utf8")).toBe(malformed);
  });
});

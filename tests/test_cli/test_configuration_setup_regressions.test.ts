/** Regressions for configuration persistence, cancellation and automation-safe input. */
import "../_support/isolatedHome.js";
import * as fs from "node:fs";
import realFs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli, main } from "../../src/cli/main.js";
import { sys } from "../../src/cli/io.js";
import { configSeams, saveGuidedValue } from "../../src/cli/commands/config_cmd.js";
import { useCapsys } from "./conftest.js";
import { Abort } from "../../src/cli/errors.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIso } from "../_support/iso.js";
import { fakeTtySys, storagePatch, withConfig } from "../helpers/configSupport.js";
import { loadLayeredConfig, collectSources } from "../../src/transport/config_layers.js";
import { CORE_KEYS } from "../../src/utils/config_keys.js";
import { assertConfigFilesReadable, assertConfigValuesValid } from "../../src/utils/config_diagnostics.js";
import { dotenvValues } from "../../src/utils/_dotenv.js";
import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import { registerProvider } from "../../src/providers/registry.js";
import { setEnvValue } from "../../src/providers/settings.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const iso = useIso();
const cap = useCapsys();
async function terminal(...args: string[]): Promise<{ exit_code: number; stdout: string; output: string }> {
  const exit_code = await main({ args });
  const { out, err } = cap.readouterr();
  return { exit_code, stdout: out, output: out + err };
}
const abx = (...args: string[]) => new CliRunner().invoke(cli, args);
let restore = (): void => undefined;
beforeEach(() => {
  vi.mocked(fs.renameSync).mockImplementation(realFs.renameSync);
  const previous = { ...configSeams };
  Object.assign(configSeams, storagePatch(iso.home, { env: true }));
  restore = () => Object.assign(configSeams, previous);
});
afterEach(() => { restore(); vi.restoreAllMocks(); });

describe("guided configuration persistence", () => {
  it.each([
    ["config", "list"],
    ["--json", "config", "list"],
    ["config", "get", "access_key_id"],
    ["config", "get", "providers.alicloud-express.access_key_id"],
    ["provider", "config", "alicloud-express", "list"],
    ["provider", "config", "alicloud-express", "get", "access_key_id"],
    ["config", "set", "access_key_id"],
    ["config", "set", "providers.alicloud-express.access_key_id"],
  ])("masks an AccessKey identifier across configuration commands: %j", async (...args) => {
    const identifier = "EXAMPLE-ACCESS-IDENTIFIER-SENTINEL";
    iso.writeEnv(`ALICLOUD_ACCESS_KEY_ID=${identifier}\n`);
    loadLayeredConfig({ provider: "alicloud-express" });
    const command = args.includes("set") ? [...args, identifier] : args;
    const result = await abx(...command);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain(identifier);
    expect(result.output).toContain("***");
    expect(fs.readFileSync(iso.env, "utf8")).toContain(`ALICLOUD_ACCESS_KEY_ID=${identifier}`);
    expect(loadLayeredConfig({ provider: "alicloud-express" }).access_key_id).toBe(identifier);
  });

  it.each([
    ["config", "set", "access_key_id"],
    ["provider", "config", "alicloud-express", "set", "access_key_id"],
  ])("uses hidden input for an AccessKey identifier: %j", async (...args) => {
    const identifier = "EXAMPLE-ACCESS-IDENTIFIER-HIDDEN";
    vi.spyOn(sys.stdin, "isatty").mockReturnValue(true);
    vi.spyOn(sys.stderr, "isatty").mockReturnValue(true);
    vi.spyOn(sys.stdout, "isatty").mockReturnValue(true);
    const prompt = vi.fn(async () => identifier);
    const result = await withConfig({ _promptSecret: prompt }, () => terminal(...args));
    expect(result.exit_code, result.output).toBe(0);
    expect(prompt).toHaveBeenCalledOnce();
    expect(result.output).not.toContain(identifier);
    expect(loadLayeredConfig({ provider: "alicloud-express" }).access_key_id).toBe(identifier);
  });

  it("stores built-in Provider secrets under their real schema name and consumes them immediately", async () => {
    loadLayeredConfig({ provider: "alicloud-express" });
    const result = await abx("provider", "config", "alicloud-express", "set", "access_key_secret", "placeholder-secret");
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("placeholder-secret");
    const stored = fs.readFileSync(iso.env, "utf8");
    expect(stored).toContain("ALICLOUD_ACCESS_KEY_SECRET=placeholder-secret");
    expect(stored).not.toContain("ABX_ALICLOUD_EXPRESS_ACCESS_KEY_SECRET");
    expect(loadLayeredConfig({ provider: "alicloud-express" }).access_key_secret).toBe("placeholder-secret");
    expect(result.output).toContain(iso.env);
    const shown = await abx("provider", "config", "alicloud-express", "get", "access_key_secret");
    expect(shown.stdout.trim()).toBe("********");
    expect(result.output).toContain("abx provider config alicloud-express set access_key_secret");
  });

  it("preserves an existing secret on empty interactive input; only explicit unset removes it", async () => {
    await abx("provider", "config", "alicloud-express", "set", "access_key_secret", "placeholder-secret");
    const previous = fs.readFileSync(iso.env, "utf8");
    vi.spyOn(sys.stdin, "isatty").mockReturnValue(true);
    vi.spyOn(sys.stderr, "isatty").mockReturnValue(true);
    vi.spyOn(sys.stdout, "isatty").mockReturnValue(true);
    const prompt = vi.fn(async () => "");
    const result = await withConfig({ _promptSecret: prompt }, () => terminal("provider", "config", "alicloud-express", "set", "access_key_secret"));
    expect(result.exit_code, result.output).toBe(0);
    expect(prompt).toHaveBeenCalledOnce();
    expect(fs.readFileSync(iso.env, "utf8")).toBe(previous);
    expect(result.output).toContain("was not changed");
    await abx("provider", "config", "alicloud-express", "unset", "access_key_secret");
    expect(fs.existsSync(iso.env)).toBe(false);
  });

  it("uses the same writer for global LLM values even when the operation names a Provider", () => {
    const destination = saveGuidedValue("llm_api_key", "placeholder-llm", "alicloud-express");
    expect(destination).toEqual({ path: iso.env, key: "ABX_LLM_API_KEY" });
    expect(dotenvValues(iso.env).get("ABX_LLM_API_KEY")).toBe("placeholder-llm");
  });

  it("stores an inherited Provider-scoped API key in its real scoped dotenv variable", () => {
    const destination = saveGuidedValue("sandbox_api_key", "placeholder-api", "alicloud-express");
    expect(destination).toEqual({ path: iso.env, key: "ABX_ALICLOUD_EXPRESS_SANDBOX_API_KEY" });
    expect(loadLayeredConfig({ provider: "alicloud-express" }).sandbox_api_key).toBe("placeholder-api");
    expect(fs.existsSync(iso.toml)).toBe(false);
  });

  it("collects configuration before saving so cancellation does not leave partial secrets or defaults", async () => {
    let calls = 0;
    const result = await withConfig({ sys: fakeTtySys(), _promptSecret: async () => {
      if (++calls === 1) return "placeholder-api";
      throw new Abort();
    } }, () => new CliRunner().invoke(cli, ["config", "init", "--build"], { input: "cn-shanghai\nplaceholder-namespace\n" }));
    expect(result.exit_code).not.toBe(0);
    expect(fs.existsSync(iso.env)).toBe(false);
    expect(fs.existsSync(iso.toml)).toBe(false);
    expect(result.output).not.toContain("Configuration complete");
  });

  it("reports higher-priority environment values after saving rather than claiming the saved value took effect", async () => {
    iso.setenv("ALIBABA_CLOUD_REGION_ID", "cn-beijing");
    const result = await withConfig({ sys: fakeTtySys(), _promptSecret: async () => "placeholder-api" }, () =>
      new CliRunner().invoke(cli, ["config", "init"], { input: "cn-shanghai\n" }));
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(iso.toml, "utf8")).toContain('region = "cn-shanghai"');
    expect(result.output).toContain("Saved values overridden");
    expect(result.output).toContain("ALIBABA_CLOUD_REGION_ID");
  });

  it("round trips spaces, hashes, quotes, backslashes and multiline values without damaging unrelated entries", () => {
    iso.writeEnv("# preserved comment\nOTHER='existing\nmultiline'\n");
    const value = 'placeholder with # hash "quotes" \\ path\nand newline';
    setEnvValue("ABX_LLM_API_KEY", value, iso.env);
    expect(dotenvValues(iso.env).get("ABX_LLM_API_KEY")).toBe(value);
    expect(dotenvValues(iso.env).get("OTHER")).toBe("existing\nmultiline");
    expect(fs.readFileSync(iso.env, "utf8")).toContain("# preserved comment");
    expect(fs.statSync(iso.env).mode & 0o777).toBe(0o600);
  });

  it("rejects unsupported interpolation before touching the existing file", () => {
    iso.writeEnv("OTHER=preserve\n");
    expect(() => setEnvValue("ABX_LLM_API_KEY", "placeholder-${MISSING_VALUE}", iso.env)).toThrow("losslessly");
    expect(fs.readFileSync(iso.env, "utf8")).toBe("OTHER=preserve\n");
  });

  it("retains the old credential when the new canonical destination cannot be committed", () => {
    iso.writeToml('[providers.alicloud-express]\nsandbox_api_key = "placeholder-old"\n');
    const previous = fs.readFileSync(iso.toml, "utf8");
    const rename = realFs.renameSync;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (to === iso.env) throw new Error("destination is not writable");
      rename(from, to);
    });
    expect(() => saveGuidedValue("sandbox_api_key", "placeholder-new", "alicloud-express")).toThrow();
    expect(fs.readFileSync(iso.toml, "utf8")).toBe(previous);
    expect(fs.existsSync(iso.env)).toBe(false);
    expect(fs.readdirSync(iso.home).some((file) => file.endsWith(".tmp"))).toBe(false);
  });

  it("preserves a legacy flat TOML configuration if committing its serialized replacement fails", async () => {
    const previous = '# keep original\nregion = "cn-beijing"\nmax_retries = 2\n[unrelated]\nkeep = true\n';
    iso.writeToml(previous);
    const rename = realFs.renameSync;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (to === iso.toml) throw new Error("replacement cannot be committed");
      rename(from, to);
    });
    const result = await abx("config", "set", "region", "cn-shanghai");
    expect(result.exit_code).not.toBe(0);
    expect(fs.readFileSync(iso.toml, "utf8")).toBe(previous);
    expect(fs.readdirSync(iso.home).some((file) => file.endsWith(".tmp"))).toBe(false);
  });

  it("initializes one satisfied authentication group without asking for the other group's secret", async () => {
    class SetupProvider extends Provider {
      readonly id = "setup-example";
      override async buildInfra(): Promise<ProviderInfra> { throw new Error("setup must not create a client"); }
    }
    const provider = new SetupProvider();
    provider.configFields = [{ key: "token", secret: true, credential: true }];
    provider.inherit = new Set(["sandbox_api_key"]);
    provider.authAnyOf = [["token"], ["sandbox_api_key"]];
    registerProvider(provider);
    iso.setenv("ABX_SETUP_EXAMPLE_SANDBOX_API_KEY", "placeholder-current");
    iso.setenv("ABX_PROVIDER", provider.id);
    const questions: string[] = [];
    const result = await withConfig({ sys: fakeTtySys(), _promptSecret: async (label) => { questions.push(label); return ""; } }, () =>
      abx("config", "init"));
    expect(result.exit_code, result.output).toBe(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain("API");
    expect(result.output).not.toContain("Choose an authentication method");
    expect([...dotenvValues(iso.env).keys()]).toEqual(["ABX_SERVER_TOKEN"]);
  });

  it("accepts required false and zero values as configured during generic init", async () => {
    class FalseyProvider extends Provider {
      readonly id = "falsey-example";
      override async buildInfra(): Promise<ProviderInfra> { throw new Error("setup must not create a client"); }
    }
    const provider = new FalseyProvider();
    provider.configFields = [{ key: "enabled", type: "bool", required: true, default: false }, { key: "count", type: "int", required: true, default: 0 }];
    registerProvider(provider);
    iso.setenv("ABX_PROVIDER", provider.id);
    const result = await withConfig({ sys: fakeTtySys() }, () => new CliRunner().invoke(cli, ["config", "init"], { input: "\n\n" }));
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Configuration complete");
    expect(loadLayeredConfig({ provider: provider.id }).provider_options).toMatchObject({ enabled: false, count: 0 });
  });

  it("deletes an exported multiline secret without damaging comments or another multiline entry", async () => {
    iso.writeEnv("# preserve comment\nexport ABX_LLM_API_KEY='placeholder-secret\ncontinued'\nOTHER='keep\nmultiline'\n");
    const result = await abx("config", "delete", "llm_api_key");
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("placeholder-secret");
    const text = fs.readFileSync(iso.env, "utf8");
    expect(text).toContain("# preserve comment");
    expect(text).not.toContain("ABX_LLM_API_KEY");
    expect(text).not.toContain("continued");
    expect(dotenvValues(iso.env).get("OTHER")).toBe("keep\nmultiline");
    expect(() => assertConfigFilesReadable(iso.toml, [iso.env])).not.toThrow();
  });

  it("removes the dotenv file after explicitly deleting its last exported multiline value", async () => {
    iso.writeEnv("export ABX_LLM_API_KEY='placeholder-secret\ncontinued'\n");
    const result = await abx("config", "delete", "llm_api_key");
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(iso.env)).toBe(false);
  });

  it("preserves comments and other Provider settings while updating core values", async () => {
    iso.writeToml('# preserved header\n[transport]\n# keep timeout\nhttp_timeout = 30.0\n[providers.other]\nflag = true\n');
    const result = await abx("config", "set", "region", "cn-shanghai");
    expect(result.exit_code, result.output).toBe(0);
    const text = fs.readFileSync(iso.toml, "utf8");
    expect(text).toContain("# preserved header");
    expect(text).toContain("# keep timeout");
    expect(text).toContain("[providers.other]\nflag = true");
    expect(text).toContain('region = "cn-shanghai"');
  });
});

describe("noninteractive configuration", () => {
  for (const flag of ["--json", "--ci", "--quiet"]) {
    it(`does not ask for init/set values in ${flag} mode even with terminal streams`, async () => {
      const prompt = vi.fn(async () => { throw new Error("must not prompt"); });
      for (const command of [["config", "init"], ["config", "set", "sandbox_api_key"]]) {
        const result = await withConfig({ sys: fakeTtySys(), _promptSecret: prompt }, () => abx(flag, ...command));
        expect(prompt).not.toHaveBeenCalled();
        if (flag === "--json") expect(() => JSON.parse(result.stdout)).not.toThrow();
      }
      expect(fs.existsSync(iso.env)).toBe(false);
    });

    it(`does not ask for Provider init/set values in ${flag} mode even with terminal streams`, async () => {
      vi.spyOn(sys.stdin, "isatty").mockReturnValue(true);
      vi.spyOn(sys.stderr, "isatty").mockReturnValue(true);
    vi.spyOn(sys.stdout, "isatty").mockReturnValue(true);
      const prompt = vi.fn(async () => { throw new Error("must not prompt"); });
      const result = await withConfig({ _promptSecret: prompt }, () => terminal(flag, "provider", "config", "alicloud-express", "set", "access_key_secret"));
      expect(prompt).not.toHaveBeenCalled();
      expect(result.exit_code).toBe(2);
      if (flag === "--json") expect(() => JSON.parse(result.stdout)).not.toThrow();
    });
  }
});

describe("configuration source diagnostics", () => {
  it("diagnoses malformed TOML safely and refuses to replace it", async () => {
    const malformed = '[transport]\nsecret = "placeholder-secret\n';
    iso.writeToml(malformed);
    const result = await abx("config", "set", "region", "cn-shanghai");
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("Cannot parse configuration");
    expect(result.output).not.toContain("placeholder-secret");
    expect(fs.readFileSync(iso.toml, "utf8")).toBe(malformed);
  });

  it("identifies malformed dotenv by file and line without exposing the input", () => {
    iso.writeEnv('ABX_LLM_API_KEY="placeholder-secret\n');
    let message = "";
    try { assertConfigFilesReadable(iso.toml, [iso.env]); } catch (error) { message = String(error); }
    expect(message).toContain(iso.env);
    expect(message).toContain("line 1");
    expect(message).not.toContain("placeholder-secret");
  });

  it("rejects invalid explicit booleans and URLs before lower-priority fallback", () => {
    for (const [name, value] of [["ABX_HTTP2", "invalid-boolean"], ["ABX_SANDBOX_BASE_URL", "invalid-endpoint"]]) {
      const sources = { ...collectSources(), environ: { [name]: value } };
      expect(() => assertConfigValuesValid(CORE_KEYS, sources, "alicloud-express")).toThrow(name);
      try { assertConfigValuesValid(CORE_KEYS, sources, "alicloud-express"); } catch (error) { expect(String(error)).not.toContain(value); }
    }
  });
});

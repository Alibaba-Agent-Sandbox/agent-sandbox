/** Real SDK models, durable cache/consent semantics and provider-only credential management. */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { managedKeySeams, prepareManagedApiKey, resolveSandboxApiKey, ManagedKeyConsentRequiredError } from "../../src/providers/alicloud_express/managed_api_key.js";
import { CONFIGURATION_UI } from "../../src/providers/alicloud_express/cli/configuration.js";
import { LayeredConfig } from "../../src/transport/config_layers.js";
import { listProviderCommands, runProviderCommand } from "../../src/providers/commands.js";
import { withGuidedConfiguration, guidanceSeams } from "../../src/cli/config_guidance.js";
import { useIso } from "../_support/iso.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = useIso();
const original = { ...managedKeySeams };
const official = original.loadSdk();
let current: Record<string, unknown>;
let create: ReturnType<typeof vi.fn>, describeKey: ReturnType<typeof vi.fn>, update: ReturnType<typeof vi.fn>;
const config = (overrides = {}) => new LayeredConfig({ access_key_id: "placeholder-ak", access_key_secret: "placeholder-secret", ...overrides });
beforeEach(() => {
  current = {};
  create = vi.fn(async (request: any) => {
    current = { ...request.body, apiKeyID: "key-owned", apiKeyValue: "placeholder-managed", teamID: request.body.teamID ?? "team-default", status: "active" };
    return { body: { code: "200", apiKey: current } };
  });
  describeKey = vi.fn(async () => ({ body: { code: "200", apiKey: { ...current, apiKeyValue: undefined } } }));
  update = vi.fn(async (_id: string, request: any) => { current.expireTime = request.body.expireTime; return { body: { code: "200", apiKey: current } }; });
  managedKeySeams.loadSdk = () => ({ ...official, Client: class {
    createApiKeyWithOptions = create; describeApiKeyWithOptions = describeKey; updateApiKeyWithOptions = update;
  } as any });
});
afterEach(() => { Object.assign(managedKeySeams, original); vi.restoreAllMocks(); });

describe("Express managed API keys", () => {
  it("discovers without loading an SDK; resolution is read-only and preparation is a write", () => {
    const load = vi.spyOn(managedKeySeams, "loadSdk");
    const commands = listProviderCommands("alicloud-express");
    expect(commands.find(c => c.id === "api-key.resolve")?.effect).toBe("read");
    expect(commands.find(c => c.id === "api-key.prepare")?.effect).toBe("write");
    expect(load).not.toHaveBeenCalled();
  });
  it("requires explicit consent before loading the cloud SDK or creating a pending record", async () => {
    const load = vi.spyOn(managedKeySeams, "loadSdk");
    await expect(prepareManagedApiKey(config())).rejects.toBeInstanceOf(ManagedKeyConsentRequiredError);
    expect(load).not.toHaveBeenCalled();
    expect(fs.readdirSync(managedKeySeams.directory())).toEqual([]);
  });
  it("creates with official request models and a real 30-day resource expiry, then reuses the same secret", async () => {
    const now = Date.now(); managedKeySeams.now = () => now;
    const result = await prepareManagedApiKey(config(), {}, true);
    expect(create.mock.calls[0][0]).toBeInstanceOf(official.models.CreateApiKeyRequest);
    expect(create.mock.calls[0][0].body).toBeInstanceOf(official.models.CreateApiKeyInput);
    expect(create.mock.calls[0][0].body.teamID).toBeUndefined();
    expect(Date.parse(result.expire_time) - now).toBe(30 * 24 * 3600_000);
    expect(JSON.stringify(result)).not.toContain("placeholder-managed");
    expect(await resolveSandboxApiKey(config())).toBe("placeholder-managed");
    expect(create).toHaveBeenCalledTimes(1);
    expect(describeKey).toHaveBeenCalledTimes(1);
    if (process.platform !== "win32") {
      expect(fs.statSync(result.secret_file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(result.secret_file)).mode & 0o777).toBe(0o700);
    }
  });
  it("explicit API keys bypass all management, even with a configured AccessKey", async () => {
    const load = vi.spyOn(managedKeySeams, "loadSdk");
    expect(await resolveSandboxApiKey(config({ sandbox_api_key: "placeholder-explicit" }))).toBe("placeholder-explicit");
    expect(load).not.toHaveBeenCalled();
  });
  it.each(["environment", "toml"])("uses the existing Express Team setting from %s", async source => {
    if (source === "environment") iso.setenv("ABX_ALICLOUD_EXPRESS_TEAM_ID", "team-selected");
    else iso.writeToml('[providers.alicloud-express]\nteam_id = "team-selected"\n');
    const prepared = await prepareManagedApiKey(config(), {}, true);
    expect(prepared.team_id).toBe("team-selected");
    expect(create.mock.calls[0][0].body.teamID).toBe("team-selected");
  });
  it("isolates Team, region and AccessKey identity, and coalesces concurrent preparation", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => prepareManagedApiKey(config(), {}, true)));
    expect(new Set(results.map(r => r.secret_file)).size).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    const otherTeam = await prepareManagedApiKey(config(), { team_id: "team-other" }, true);
    const otherRegion = await prepareManagedApiKey(config({ region: "cn-shanghai" }), {}, true);
    const otherIdentity = await prepareManagedApiKey(config({ access_key_id: "placeholder-other" }), {}, true);
    expect(new Set([results[0].secret_file, otherTeam.secret_file, otherRegion.secret_file, otherIdentity.secret_file]).size).toBe(4);
  });
  it("serializes independent processes so simultaneous first use creates one cloud key", async () => {
    const source = `
      import fs from 'node:fs';
      import {managedKeySeams, prepareManagedApiKey} from ${JSON.stringify(new URL("../../src/providers/alicloud_express/managed_api_key.ts", import.meta.url).href)};
      import {LayeredConfig} from ${JSON.stringify(new URL("../../src/transport/config_layers.ts", import.meta.url).href)};
      const directory = ${JSON.stringify(path.join(iso.home, "credentials", "alicloud-express"))};
      const remote = ${JSON.stringify(path.join(iso.root, "remote.json"))};
      const writes = ${JSON.stringify(path.join(iso.root, "writes"))};
      const sdk = managedKeySeams.loadSdk();
      managedKeySeams.directory = () => directory;
      managedKeySeams.loadSdk = () => ({...sdk, Client: class {
        async createApiKeyWithOptions(request) {
          fs.appendFileSync(writes, 'create\\n');
          await new Promise(r => setTimeout(r, 200));
          const key = {...request.body, apiKeyID:'owned', apiKeyValue:'placeholder-managed', teamID:'default', status:'active'};
          fs.writeFileSync(remote, JSON.stringify(key));
          return {body:{code:'200', apiKey:key}};
        }
        async describeApiKeyWithOptions() {return {body:{code:'200', apiKey:JSON.parse(fs.readFileSync(remote,'utf8'))}};}
      }});
      const metadata = await prepareManagedApiKey(new LayeredConfig({access_key_id:'placeholder-ak', access_key_secret:'placeholder-secret'}), {}, true);
      console.log(JSON.stringify(metadata));
    `;
    const run = () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url).href, "--input-type=module", "-e", source], { cwd: iso.root, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
      child.on("error", reject); child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    });
    const [first, second] = await Promise.all([run(), run()]);
    expect(JSON.parse(first)).toEqual(JSON.parse(second));
    expect(fs.readFileSync(path.join(iso.root, "writes"), "utf8")).toBe("create\n");
  }, 15_000);
  it("requires a separate confirmation for renewal and extends the existing resource without replacing its secret", async () => {
    const result = await prepareManagedApiKey(config(), {}, true);
    current.expireTime = new Date(Date.now() + 1000).toISOString();
    await expect(resolveSandboxApiKey(config())).rejects.toMatchObject({ operation: "renewal" });
    expect(update).not.toHaveBeenCalled();
    const renewed = await prepareManagedApiKey(config(), {}, true);
    expect(renewed.api_key_id).toBe(result.api_key_id);
    expect(update).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(await resolveSandboxApiKey(config())).toBe("placeholder-managed");
  });
  it("does not reset or replace a disabled key", async () => {
    await prepareManagedApiKey(config(), {}, true); current.status = "inactive";
    await expect(prepareManagedApiKey(config(), {}, true)).rejects.toThrow("disabled");
    expect(update).not.toHaveBeenCalled(); expect(create).toHaveBeenCalledOnce();
  });
  it("keeps an incomplete renewal response pending instead of assuming success or replaying it", async () => {
    await prepareManagedApiKey(config(), {}, true); current.expireTime = new Date().toISOString();
    update.mockResolvedValueOnce({ body: { code: "200" } });
    await expect(prepareManagedApiKey(config(), {}, true)).rejects.toThrow("renewal returned incomplete");
    await expect(prepareManagedApiKey(config(), {}, true)).rejects.toThrow("unknown outcome");
    expect(update).toHaveBeenCalledOnce();
  });
  it("does not repeat an uncertain write, including after starting again", async () => {
    create.mockRejectedValueOnce(new Error("unknown response including placeholder-secret"));
    await expect(prepareManagedApiKey(config(), {}, true)).rejects.toThrow("creation failed");
    await expect(prepareManagedApiKey(config(), {}, true)).rejects.toThrow("unknown outcome");
    expect(create).toHaveBeenCalledOnce();
  });
  it("names required permissions and permits retry after a definite authorization rejection", async () => {
    create.mockRejectedValueOnce({ statusCode: 403, message: "private-cloud-response-placeholder-secret" });
    try { await prepareManagedApiKey(config(), {}, true); expect.fail("must reject"); }
    catch (error: any) {
      expect(error.message).toContain("permission denied"); expect(error.suggestion).toContain("sandbox:CreateApiKey");
      expect(JSON.stringify(error)).not.toContain("private-cloud-response");
    }
    await prepareManagedApiKey(config(), {}, true); expect(create).toHaveBeenCalledTimes(2);
  });
  it("refuses symlink credential storage", async () => {
    fs.mkdirSync(path.join(iso.home, "credentials"));
    fs.symlinkSync(iso.root, managedKeySeams.directory(), "dir");
    await expect(prepareManagedApiKey(config(), {}, true)).rejects.toThrow("symbolic links");
    expect(create).not.toHaveBeenCalled();
  });
  it("the resolve catalog entry cannot mutate a credential", async () => {
    await expect(runProviderCommand("alicloud-express", "api-key.resolve", {}, { access_key_id: "placeholder-ak", access_key_secret: "placeholder-secret" })).rejects.toMatchObject({ code: "E8012" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("Express confirmation experience", () => {
  it("declining does not create anything; explicit --ci authorizes preparation", async () => {
    const ask = vi.fn(async (_message: string) => false);
    await expect(CONFIGURATION_UI.runtimeAuthentication!.resolve(config(), { ci: false, confirm: ask })).rejects.toMatchObject({ code: "E8012" });
    expect(ask.mock.calls[0][0]).toContain("30-day"); expect(create).not.toHaveBeenCalled();
    expect(await CONFIGURATION_UI.runtimeAuthentication!.resolve(config(), { ci: true, confirm: ask })).toBe("placeholder-managed");
    expect(ask).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
  });
  it("a positive confirmation prepares once and later commands do not prompt again", async () => {
    const ask = vi.fn(async () => true);
    await CONFIGURATION_UI.runtimeAuthentication!.resolve(config(), { ci: false, confirm: ask });
    await CONFIGURATION_UI.runtimeAuthentication!.resolve(config(), { ci: false, confirm: ask });
    expect(ask).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
  });
  it("operation guidance accepts AK/SK, prepares with --ci and passes a resolved key to the original action", async () => {
    iso.setenv("ALICLOUD_ACCESS_KEY_ID", "placeholder-ak"); iso.setenv("ALICLOUD_ACCESS_KEY_SECRET", "placeholder-secret");
    const action = vi.fn(async values => values.sandbox_api_key);
    expect(await withGuidedConfiguration(undefined, { operation: "create", provider: "alicloud-express", requirements: ["sandbox_api_key"], ci: true }, action)).toBe("placeholder-managed");
    expect(action).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
  });
  it("automation without --ci neither prompts nor creates a key", async () => {
    iso.setenv("ALICLOUD_ACCESS_KEY_ID", "placeholder-ak"); iso.setenv("ALICLOUD_ACCESS_KEY_SECRET", "placeholder-secret");
    vi.spyOn(guidanceSeams, "interactive").mockReturnValue(false);
    const action = vi.fn();
    await expect(withGuidedConfiguration(undefined, { operation: "create", requirements: ["sandbox_api_key"] }, action)).rejects.toMatchObject({ code: "E8012" });
    expect(action).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it("ambient CI does not authorize credential writes; the explicit native --ci flag does", async () => {
    iso.setenv("CI", "true");
    iso.setenv("ALICLOUD_ACCESS_KEY_ID", "placeholder-ak"); iso.setenv("ALICLOUD_ACCESS_KEY_SECRET", "placeholder-secret");
    const runner = new CliRunner();
    const args = ["provider", "command", "run", "alicloud-express", "api-key.prepare"];
    const refused = await runner.invoke(cli, args);
    expect(refused.exit_code).not.toBe(0); expect(create).not.toHaveBeenCalled();
    const accepted = await runner.invoke(cli, ["--ci", ...args]);
    expect(accepted.exit_code, accepted.output).toBe(0);
    expect(accepted.stderr).toContain("--ci authorized");
    expect(accepted.stdout).not.toContain("placeholder-managed");
    expect(create).toHaveBeenCalledOnce();
  });
});

/** Official Template Cache mappings, honest status, strict scope and safe failure semantics. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CACHE_COMMANDS, _templateCacheSdkLoader, runTemplateCacheCommand } from "../../src/providers/alicloud_express/template_cache_commands.js";
import { getProviderCommand, listProviderCommands, runProviderCommand } from "../../src/providers/commands.js";
import { parseCommandSection, validateCommandInput, validateCommandOutput } from "../../src/providers/command_contract.js";
import { _sdkLoader as fcLoader } from "../../src/providers/alicloud_express/sdk.js";
import { LayeredConfig } from "../../src/transport/config_layers.js";
import { SandboxError } from "../../src/models/errors.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIso } from "../_support/iso.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
useIso();
const original = _templateCacheSdkLoader.load;
const official = original();
const config = new LayeredConfig({ access_key_id: "placeholder-cache-ak", access_key_secret: "placeholder-cache-secret", sandbox_api_key: "placeholder-runtime-key",
  region: "cn-hangzhou", sandbox_base_url: "https://unrelated.example.test", http_timeout: 7 });
const ref = { team_id: "team-1", template_id: "template-1" };
const wire = { teamID: "team-1", templateID: "template-1", status: "loading", progress: 12, imageSizeMB: 584 };
const signal = () => new AbortController().signal;
function fake(method: string, body: Record<string, unknown> = { templateCache: wire }) {
  const call = vi.fn().mockResolvedValue({ body: { code: "200", requestId: "req-1", ...body } });
  const makeClient = vi.fn(function (_config: unknown) { return { [method]: call }; });
  _templateCacheSdkLoader.load = () => ({ ...official, Client: makeClient as any });
  return { call, makeClient };
}
afterEach(() => { _templateCacheSdkLoader.load = original; vi.restoreAllMocks(); });

describe("Template Cache command discovery", () => {
  it("discovers four strict commands without loading the official SDK or consulting the cloud", () => {
    const loader = vi.fn(() => { throw new Error("private SDK must not load for help"); });
    _templateCacheSdkLoader.load = loader;
    const commands = parseCommandSection({ protocol: "provider-commands/1", entries: TEMPLATE_CACHE_COMMANDS }, "builtin");
    expect(commands.map(command => command.id)).toEqual(["template-cache.create", "template-cache.delete", "template-cache.get", "template-cache.list"]);
    for (const command of commands) {
      expect(getProviderCommand("alicloud-express", command.id)).toEqual(command);
      expect(command.input_schema.additionalProperties).toBe(false);
      expect(command.output_schema.additionalProperties).toBe(false);
      expect(command.effect).toBe(command.id.endsWith("create") ? "write" : command.id.endsWith("delete") ? "delete" : "read");
      expect(command.idempotent).toBe(!command.id.endsWith("create"));
    }
    expect(listProviderCommands("alicloud-express")).toHaveLength(32);
    expect(loader).not.toHaveBeenCalled();
  });

  it.each([
    ["template-cache.create", { template_id: "template-1" }],
    ["template-cache.create", { ...ref, endpoint: "https://attacker.example.test" }],
    ["template-cache.get", { ...ref, team_id: "" }],
    ["template-cache.delete", { ...ref, template_id: "../not-owned" }],
    ["template-cache.list", { team_id: "team-1", max_results: 101 }],
    ["template-cache.list", { team_id: "team-1", max_results: "20" }],
    ["template-cache.list", { team_id: "team-1", next_token: "" }],
    ["template-cache.list", { team_id: "team-1", unknown: true }],
  ])("rejects invalid %s before SDK loading %#", async (id, input) => {
    const loader = vi.fn(original); _templateCacheSdkLoader.load = loader;
    await expect(runTemplateCacheCommand(config, id as string, input, signal())).rejects.toMatchObject({ code: "E8002" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("requires the explicit Team in the generic command schema as well", () => {
    expect(() => validateCommandInput(getProviderCommand("alicloud-express", "template-cache.list"), {})).toThrow();
    expect(() => validateCommandInput(getProviderCommand("alicloud-express", "template-cache.create"), ref)).not.toThrow();
  });

  it.each(["template-cache.create", "template-cache.delete"])("requires CLI confirmation for %s before SDK I/O", async id => {
    const loader = vi.fn(original); _templateCacheSdkLoader.load = loader;
    const result = await new CliRunner().invoke(cli, ["--json", "provider", "command", "run", "alicloud-express", id, "--input", JSON.stringify(ref)]);
    expect(result.exit_code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "E8012" });
    expect(loader).not.toHaveBeenCalled();
  });
});

describe("official Template Cache requests", () => {
  it.each([
    { id: "template-cache.create", method: "createTemplateCacheWithOptions", input: ref, args: [{ body: { teamID: "team-1", templateID: "template-1" } }] },
    { id: "template-cache.get", method: "describeTemplateCacheWithOptions", input: ref, args: ["template-1", { teamID: "team-1" }] },
    { id: "template-cache.delete", method: "deleteTemplateCacheWithOptions", input: ref, args: ["template-1", { teamID: "team-1" }] },
    { id: "template-cache.list", method: "listTemplateCacheWithOptions", input: { ...ref, status: "loading", max_results: 2, next_token: "page-one+/=" },
      args: [{ teamID: "team-1", templateID: "template-1", status: "loading", maxResults: 2, nextToken: "page-one+/=" }] },
  ])("maps $id to exact generated models, locked region endpoint and AK/SK", async ({ id, method, input, args }) => {
    const { call, makeClient } = fake(method, { templateCache: wire, templateCaches: [wire], maxResults: 2 });
    const result = await runTemplateCacheCommand(config, id, input, signal());
    validateCommandOutput(getProviderCommand("alicloud-express", id), result);
    expect(call).toHaveBeenCalledOnce();
    expect(JSON.parse(JSON.stringify(call.mock.calls[0].slice(0, args.length)))).toEqual(args);
    for (const argument of call.mock.calls[0].slice(0, args.length)) if (typeof argument === "object") expect(argument.constructor.name).toMatch(/Request$/);
    expect(call.mock.calls[0].slice(args.length)).toEqual([{}, { autoretry: false, maxAttempts: 1, readTimeout: 7000, connectTimeout: 7000 }]);
    expect(makeClient.mock.calls[0][0]).toMatchObject({ accessKeyId: config.access_key_id, accessKeySecret: config.access_key_secret,
      regionId: "cn-hangzhou", endpoint: "sandbox.cn-hangzhou.aliyuncs.com", retryOptions: { retryable: false } });
    expect(JSON.stringify(makeClient.mock.calls)).not.toContain(config.sandbox_api_key);
    expect(JSON.stringify(makeClient.mock.calls)).not.toContain("unrelated.example.test");
  });

  it("routes the generic provider runner to the new SDK without touching the older FC SDK", async () => {
    const { call } = fake("describeTemplateCacheWithOptions");
    const oldLoader = vi.spyOn(fcLoader, "load");
    const result = await runProviderCommand("alicloud-express", "template-cache.get", ref,
      { access_key_id: config.access_key_id, access_key_secret: config.access_key_secret, region: "cn-hangzhou" });
    expect(result).toMatchObject({ data: { template_id: "template-1", status: "loading", progress: 12 } });
    expect(call).toHaveBeenCalledOnce(); expect(oldLoader).not.toHaveBeenCalled();
  });

  it("returns actual status/progress, projects declared fields and redacts credentials in metadata", async () => {
    fake("createTemplateCacheWithOptions", { templateCache: { ...wire, statusReason: `pending ${config.access_key_secret}`, apiKeyValue: "placeholder-unknown-secret" } });
    const result = await runTemplateCacheCommand(config, "template-cache.create", ref, signal());
    expect(result).toEqual({ request_id: "req-1", data: { ...ref, status: "loading", progress: 12, image_size_mb: 584, status_reason: "pending [REDACTED]" } });
    expect(JSON.stringify(result)).not.toContain("ready"); expect(JSON.stringify(result)).not.toContain("placeholder-unknown-secret");
  });

  it("leaves missing status and progress unknown instead of manufacturing readiness", async () => {
    fake("createTemplateCacheWithOptions", { templateCache: { teamID: "team-1", templateID: "template-1" } });
    expect(await runTemplateCacheCommand(config, "template-cache.create", ref, signal())).toEqual({ request_id: "req-1", data: ref });
  });

  it("returns each cursor unchanged, treats empty/absent final cursor as null and never auto-fetches another page", async () => {
    const { call } = fake("listTemplateCacheWithOptions");
    call.mockResolvedValueOnce({ body: { templateCaches: [wire], maxResults: 1, nextToken: "opaque+/=" } })
      .mockResolvedValueOnce({ body: { templateCaches: [], maxResults: 1, nextToken: "" } })
      .mockResolvedValueOnce({ body: { templateCaches: [] } });
    const first = await runTemplateCacheCommand(config, "template-cache.list", { team_id: "team-1", max_results: 1 }, signal());
    expect(first).toMatchObject({ data: { next_token: "opaque+/=", max_results: 1 } }); expect(call).toHaveBeenCalledTimes(1);
    const last = await runTemplateCacheCommand(config, "template-cache.list", { team_id: "team-1", next_token: "opaque+/=" }, signal());
    expect(last).toEqual({ request_id: null, data: { template_caches: [], max_results: 1, next_token: null } });
    const empty = await runTemplateCacheCommand(config, "template-cache.list", { team_id: "team-1" }, signal());
    expect(empty).toEqual({ request_id: null, data: { template_caches: [], max_results: null, next_token: null } });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it.each([
    {}, { templateCache: {} }, { templateCache: { ...wire, progress: 101 } }, { templateCache: { ...wire, imageSizeMB: -1 } },
    { templateCache: { ...wire, teamID: "another-team" } }, { templateCache: { ...wire, templateID: "another-template" } },
  ])("rejects malformed or wrong-scope response without declaring ready %#", async body => {
    const { call } = fake("createTemplateCacheWithOptions", body);
    await expect(runTemplateCacheCommand(config, "template-cache.create", ref, signal())).rejects.toMatchObject({ code: "E8020" });
    expect(call).toHaveBeenCalledOnce();
  });
});

describe("Template Cache safe errors and deadlines", () => {
  it.each([[401, "Unauthorized", "E1000"], [403, "Forbidden", "E1000"], [404, "TemplateCacheNotFound", "E8005"],
    [409, "Conflict", "E8003"], [429, "Throttling", "E2002"], [503, "ServiceUnavailable", "E0000"], [0, "ReadTimeout", "E8022"]])(
    "maps service HTTP%d %s without leaking response text or retrying", async (statusCode, code, expected) => {
      const { call } = fake("createTemplateCacheWithOptions");
      call.mockRejectedValue({ statusCode, code, message: `private ${config.access_key_secret}`, data: { apiKey: config.sandbox_api_key } });
      let result: any; try { await runTemplateCacheCommand(config, "template-cache.create", ref, signal()); } catch (error) { result = error; }
      // Base SandboxError and AuthenticationError codes follow the central model definitions.
      if (expected === "E0000") expect(result).toBeInstanceOf(SandboxError);
      else expect(result).toMatchObject({ code: expected });
      expect(String(result.message) + JSON.stringify(result)).not.toContain("private");
      expect(String(result.message) + JSON.stringify(result)).not.toContain(config.access_key_secret);
      expect(String(result.message) + JSON.stringify(result)).not.toContain(config.sandbox_api_key);
      expect(result.suggestion).toContain("No automatic retry"); expect(call).toHaveBeenCalledOnce();
    });

  it("treats delete404 as an idempotent absence while get404 remains not-found", async () => {
    const deleted = fake("deleteTemplateCacheWithOptions"); deleted.call.mockRejectedValue({ statusCode: 404, code: "TemplateCacheNotFound" });
    expect(await runTemplateCacheCommand(config, "template-cache.delete", ref, signal())).toEqual({ request_id: null, data: { deleted: false } });
    const got = fake("describeTemplateCacheWithOptions"); got.call.mockRejectedValue({ statusCode: 404, code: "TemplateCacheNotFound" });
    await expect(runTemplateCacheCommand(config, "template-cache.get", ref, signal())).rejects.toMatchObject({ code: "E8005" });
  });

  it("handles a service-level error in a successful HTTP response without assuming success", async () => {
    fake("createTemplateCacheWithOptions", { code: "Forbidden", message: "placeholder-private-response" });
    await expect(runTemplateCacheCommand(config, "template-cache.create", ref, signal())).rejects.toMatchObject({ code: "E1000" });
  });

  it("rejects invalid region, missing AK/SK and an already cancelled call before SDK I/O", async () => {
    const loader = vi.fn(original); _templateCacheSdkLoader.load = loader;
    await expect(runTemplateCacheCommand(new LayeredConfig({ sandbox_api_key: "placeholder-runtime-key" }), "template-cache.get", ref, signal())).rejects.toThrow(/both access_key/);
    await expect(runTemplateCacheCommand(new LayeredConfig({ access_key_id: "placeholder-ak", access_key_secret: "placeholder-sk", region: "cn-hangzhou.attacker.test" }), "template-cache.get", ref, signal())).rejects.toMatchObject({ code: "E8002" });
    const controller = new AbortController(); controller.abort();
    await expect(runTemplateCacheCommand(config, "template-cache.create", ref, controller.signal)).rejects.toMatchObject({ code: "E8022" });
    await expect(runTemplateCacheCommand(config, "arbitrary-sdk-method", ref, signal())).rejects.toMatchObject({ code: "E8004" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("reports a missing official dependency without exposing its loader exception", async () => {
    _templateCacheSdkLoader.load = () => { throw Error("placeholder-private-loader-response"); };
    const task = runTemplateCacheCommand(config, "template-cache.get", ref, signal());
    await expect(task).rejects.toMatchObject({ code: "E8002" }); await expect(task).rejects.not.toThrow("placeholder-private-loader-response");
  });
});

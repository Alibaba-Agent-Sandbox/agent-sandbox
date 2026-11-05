/** Current API contracts checked through real generated serializers without cloud requests. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayeredConfig } from "../../src/transport/config_layers.js";
import { ALICLOUD_COMMANDS, runAlicloudCommand } from "../../src/providers/alicloud_express/commands.js";
import { _sdkLoader, _legacySdkLoader } from "../../src/providers/alicloud_express/sdk.js";
import * as template from "../../src/providers/alicloud_express/fc_template.js";
import { validateCommandInput, validateCommandOutput } from "../../src/providers/command_contract.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const load = _sdkLoader.load;
const loadLegacy = _legacySdkLoader.load;
const loadTemplate = template._sdkLoader.load;
const cfg = () => new LayeredConfig({ access_key_id: "placeholder-ak", access_key_secret: "placeholder-sk", region: "cn-hangzhou", http_timeout: 7 });
const oss = { bucket_name: "example-bucket", bucket_path: "/", endpoint: "https://oss-cn-hangzhou.aliyuncs.com", read_only: false };

function capture(body: Record<string, unknown> = {}) {
  const real = load();
  const call = vi.fn().mockResolvedValue({ body });
  const config = vi.fn();
  class Client extends real.Client {
    constructor(options: any) { super(options); config(options); this.callApi = call; }
  }
  _sdkLoader.load = () => ({ ...real, Client });
  return { call, config };
}
afterEach(() => { _legacySdkLoader.load = loadLegacy; _sdkLoader.load = load; template._sdkLoader.load = loadTemplate; vi.restoreAllMocks(); });

describe("current Express native API completion", () => {
  it("passes the selected STS triple to native management without returning its token", async () => {
    const { config, call } = capture({ volumes: [], maxResults: 1 });
    const result = await runAlicloudCommand(new LayeredConfig({ access_key_id: "placeholder-ak", access_key_secret: "placeholder-sk", security_token: "placeholder-sts-token" }), "volume.list", {});
    expect(config.mock.calls[0][0]).toMatchObject({ accessKeyId: "placeholder-ak", accessKeySecret: "placeholder-sk", securityToken: "placeholder-sts-token" });
    expect(call).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("placeholder-sts-token");
  });
  it("creates JuiceFS with current API and redacts its token in results", async () => {
    const { call } = capture({ volume: { volumeID: "vol-1", juiceFSVolumeConfig: { baseURL: "https://juice.example.invalid", token: "placeholder-juice-token", volumeName: "workspace", remoteDir: "/" } } });
    const result = await runAlicloudCommand(cfg(), "volume.create", {
      team_id: "team-1", volume_name: "workspace", juice_fs_volume_config: { base_url: "https://juice.example.invalid", token: "placeholder-juice-token", volume_name: "workspace", remote_dir: "/", args: ["--cache-size", "10"] },
    });
    expect(call).toHaveBeenCalledOnce();
    const [params, request] = call.mock.calls[0];
    expect(params).toMatchObject({ version: "2026-08-20", pathname: "/pop/2026-08-20/volumes", authType: "AK" });
    expect(request.body.juiceFSVolumeConfig).toMatchObject({ baseURL: "https://juice.example.invalid", token: "placeholder-juice-token", volumeName: "workspace", remoteDir: "/" });
    expect(result).toMatchObject({ data: { juice_fs_volume_config: { token: "[REDACTED]" } } });
    expect(JSON.stringify(result)).not.toContain("placeholder-juice-token");
    validateCommandOutput(ALICLOUD_COMMANDS.find(c => c.id === "volume.create")!, result);
  });

  it("updates current volume config with Team in query and preserves storage-class filtering", async () => {
    const { call } = capture({ volume: { volumeID: "vol-1", agenticFSVolumeConfig: { accessPointID: "ap-1", agenticSpaceID: "space-1", fileSystemID: "fs-1" } } });
    const result = await runAlicloudCommand(cfg(), "volume.update", { team_id: "team-1", volume_id: "vol-1", oss_volume_config: oss, mount_config: { role: "acs:ram::123456:role/example" } });
    expect(call.mock.calls[0][1]).toMatchObject({ query: { teamID: "team-1" }, body: { ossVolumeConfig: { bucketName: "example-bucket" }, mountConfig: { role: "acs:ram::123456:role/example" } } });
    expect(call.mock.calls[0][1].body).not.toHaveProperty("teamID");
    expect(result).toMatchObject({ data: { agentic_fs_volume_config: { access_point_id: "ap-1", agentic_space_id: "space-1", file_system_id: "fs-1" } } });
    const next = capture({ volumes: [], maxResults: 1, nextToken: "cursor" });
    await runAlicloudCommand(cfg(), "volume.list", { storage_class: "JUICE_FS", max_results: 1 });
    expect(next.call.mock.calls[0][1].query).toMatchObject({ storageClass: "JUICE_FS", maxResults: "1" });
  });

  it("accepts optional and empty native Volume VPC response fields without relaxing mutation input", async () => {
    capture({ volume: { volumeID: "vol-1", mountConfig: { vpcConfig: { vSwitchIds: [] } } } });
    expect(await runAlicloudCommand(cfg(), "volume.get", { team_id: "team-1", volume_id: "vol-1" })).toMatchObject({ data: { mount_config: { vpc_config: { v_switch_ids: [] } } } });
    await expect(runAlicloudCommand(cfg(), "volume.update", { team_id: "team-1", volume_id: "vol-1", mount_config: { vpc_config: {} } })).rejects.toThrow();
  });

  it("accepts partial native template VPC, log and registry-network response fields", async () => {
    const real = loadTemplate();
    const call = vi.fn().mockResolvedValue({ body: { templateID: "tpl-1", runtimeConfig: { vpcConfig: { role: "role" }, logConfig: { project: "logs" }, sandboxConfig: { registryConfig: { networkConfig: { vpcId: "vpc-1" } } } } } });
    class Client extends real.Client { constructor(options: any) { super(options); this.callApi = call; } }
    template._sdkLoader.load = () => ({ ...real, Client });
    const result = await runAlicloudCommand(cfg(), "template.get", { team_id: "team-1", template_id: "tpl-1" });
    expect(result).toMatchObject({ data: { runtime_config: { vpc_config: { role: "role" }, log_config: { project: "logs" }, sandbox_config: { registry_config: { network_config: { vpc_id: "vpc-1" } } } } } });
    validateCommandOutput(ALICLOUD_COMMANDS.find(c => c.id === "template.get")!, result);
  });

  it.each([-1, 0, 7])("preserves instance count quota %s and requires CPU/memory", async instance_count => {
    const { call } = capture({ quota: { tagValue: "team-1", cpuCores: 2, memoryGB: 4, instanceCount: instance_count } });
    const result = await runAlicloudCommand(cfg(), "quota.update", { team_id: "team-1", cpu_cores: 2, memory_gb: 4, instance_count });
    expect(call.mock.calls[0][1].body.instanceCount).toBe(instance_count);
    expect(result).toMatchObject({ data: { instance_count } });
    await expect(runAlicloudCommand(cfg(), "quota.update", { team_id: "team-1", instance_count })).rejects.toThrow();
  });

  it.each([
    { ip_whitelist: [{ ip_address: "2001:db8::/32" }] },
    { ip_whitelist: [{ ip_address: "192.0.2.1" }], ip_blacklist: [{ ip_address: "198.51.100.1" }] },
    { ip_whitelist: [{ ip_address: "192.0.2.1", description: "x".repeat(129) }] },
  ])("rejects incompatible API-key IP policy before loading SDK %#", async policy => {
    const loader = vi.fn(() => { throw new Error("must not load"); });
    _sdkLoader.load = loader;
    await expect(runAlicloudCommand(cfg(), "api-key.update", { api_key_id: "key-1", ...policy })).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
  });

  it("does not allow mixing legacy status and current volume configuration", async () => {
    const input = { team_id: "team-1", volume_id: "vol-1", status: "AVAILABLE", oss_volume_config: oss };
    expect(() => validateCommandInput(ALICLOUD_COMMANDS.find(c => c.id === "volume.update")!, input)).toThrow();
    await expect(runAlicloudCommand(cfg(), "volume.update", input)).rejects.toThrow();
  });

  it("preserves explicit empty API-key expiry separately from omission", async () => {
    const { call } = capture({ apiKey: { apiKeyID: "key-1" } });
    await runAlicloudCommand(cfg(), "api-key.update", { api_key_id: "key-1", expire_time: "" });
    expect(call.mock.calls[0][1].body).toEqual({ expireTime: "" });
    call.mockClear();
    await runAlicloudCommand(cfg(), "api-key.update", { api_key_id: "key-1", status: "inactive" });
    expect(call.mock.calls[0][1].body).toEqual({ status: "inactive" });
  });

  it.each(["api-key.get", "api-key.update"])("preserves top-level API-key policy on %s, including explicit clearing", async id => {
    capture({ apiKey: { apiKeyID: "key-1", ipWhitelist: [{ ipAddress: "198.51.100.1" }] }, ipWhitelist: [{ ipAddress: "192.0.2.1", description: "office" }], ipBlacklist: [] });
    const input = { api_key_id: "key-1", ...(id === "api-key.update" ? { status: "inactive" } : {}) };
    const result = await runAlicloudCommand(cfg(), id, input);
    expect(result).toMatchObject({ data: { ip_whitelist: [{ ip_address: "192.0.2.1", description: "office" }], ip_blacklist: [] } });
    capture({ apiKey: { apiKeyID: "key-1", ipWhitelist: [{ ipAddress: "198.51.100.1" }] }, ipWhitelist: [] });
    expect(await runAlicloudCommand(cfg(), id, input)).toMatchObject({ data: { ip_whitelist: [] } });
    capture({ apiKey: { apiKeyID: "key-1", ipBlacklist: [{ ipAddress: "203.0.113.1" }] } });
    expect(await runAlicloudCommand(cfg(), id, input)).toMatchObject({ data: { ip_blacklist: [{ ip_address: "203.0.113.1" }] } });
  });

  it("retains the explicit status-only legacy route without accepting a mixed update", async () => {
    const real = loadLegacy();
    const call = vi.fn().mockResolvedValue({ body: { volume: { volumeID: "vol-1", status: "AVAILABLE" } } });
    class Client extends real.Client { constructor(options: any) { super(options); this.callApi = call; } }
    _legacySdkLoader.load = () => ({ ...real, Client });
    await runAlicloudCommand(cfg(), "volume.update", { team_id: "team-1", volume_id: "vol-1", status: "AVAILABLE" });
    expect(call.mock.calls[0][0]).toMatchObject({ version: "2026-05-09", pathname: "/pop/2026-05-09/volumes/vol-1" });
    expect(call.mock.calls[0][1].body).toEqual({ teamID: "team-1", status: "AVAILABLE" });
  });

  it("never retries a rejected current configuration update through the legacy API", async () => {
    const { call } = capture(); call.mockRejectedValue(Object.assign(new Error("rejected"), { code: "InvalidParameter", statusCode: 400 }));
    const legacy = vi.fn(() => { throw new Error("legacy must not load"); }); _legacySdkLoader.load = legacy;
    await expect(runAlicloudCommand(cfg(), "volume.update", { team_id: "team-1", volume_id: "vol-1", oss_volume_config: oss })).rejects.toThrow();
    expect(call).toHaveBeenCalledOnce(); expect(legacy).not.toHaveBeenCalled();
  });

  it.each(["create", "get", "list", "update", "delete"] as const)("serializes structured template.%s through the shared current adapter", async action => {
    const real = loadTemplate();
    const metadata = { templateID: "tpl-1", teamID: "team-1", resourceTags: [{ tagKey: "project", tagValue: "demo" }], runtimeConfig: { cpu: 2, sandboxConfig: { image: "example.invalid/base:v1", generation: 2, steps: [] }, logConfig: { project: "logs", logstore: "runtime" } }, status: { state: "ready" } };
    const body = action === "list" ? { templates: [metadata], maxResults: 1, nextToken: "opaque-next" } : action === "get" ? metadata : { templateID: "tpl-1", requestId: "req-1" };
    const call = vi.fn().mockResolvedValue({ body }); const configs = vi.fn();
    class Client extends real.Client { constructor(options: any) { super(options); configs(options); this.callApi = call; } }
    template._sdkLoader.load = () => ({ ...real, Client });
    const runtime_config = { cpu: 2, memory_size: 2048, disk_size: 15360, vpc_config: { vpc_id: "vpc-1", security_group_id: "sg-1", v_switch_ids: ["vsw-1"], role: "acs:ram::123456:role/example" }, log_config: { project: "logs", logstore: "runtime" }, sandbox_config: { image: "example.invalid/base:v1", os_type: "linux-amd64", generation: 2 as const, steps: [], registry_config: { auth_config: { user_name: "registry-user", password: "placeholder-registry-token" }, cert_config: { insecure: false } } } };
    const input = action === "create" ? { team_id: "team-1", name: "example", runtime_config, build_config: { install_storage_clients: true } }
      : action === "update" ? { team_id: "team-1", template_id: "tpl-1", runtime_config: { sandbox_config: { steps: [] } }, build_config: { install_storage_clients: false } }
        : action === "list" ? { team_id: "team-1", max_results: 1, next_token: "opaque-in" } : { team_id: "team-1", template_id: "tpl-1" };
    const config = new LayeredConfig({ access_key_id: "placeholder-ak", access_key_secret: "placeholder-sk", security_token: "placeholder-sts-token", http_timeout: 7 });
    const descriptor = ALICLOUD_COMMANDS.find(c => c.id === `template.${action}`)!;
    validateCommandInput(descriptor, input);
    const result = await runAlicloudCommand(config, `template.${action}`, input);
    validateCommandOutput(descriptor, result);
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0][0]).toMatchObject({ version: "2026-08-20", action: `${action === "get" ? "Get" : action === "list" ? "List" : action[0].toUpperCase() + action.slice(1)}Template${action === "list" ? "s" : ""}` });
    expect(configs.mock.calls[0][0]).toMatchObject({ securityToken: "placeholder-sts-token", endpoint: "sandbox.cn-hangzhou.aliyuncs.com" });
    if (action === "create") {
      expect(call.mock.calls[0][1].body).toMatchObject({ teamID: "team-1", buildConfig: { installStorageClients: true }, runtimeConfig: { logConfig: { project: "logs" }, vpcConfig: { vSwitchIds: ["vsw-1"] }, sandboxConfig: { osType: "linux-amd64", registryConfig: { authConfig: { password: "placeholder-registry-token" }, certConfig: { insecure: false } } } } });
      expect(JSON.stringify(result)).not.toContain("placeholder-registry-token");
    }
    if (action === "update") {
      expect(call.mock.calls[0][1].query).toEqual({ teamID: "team-1" });
      expect(call.mock.calls[0][1].body.runtimeConfig.sandboxConfig).toEqual({ steps: [] });
    }
    if (action === "get") expect(result).toMatchObject({ data: { resource_tags: [{ tag_key: "project", tag_value: "demo" }], runtime_config: { log_config: { project: "logs" } } } });
    if (action === "list") expect(result).toMatchObject({ data: { max_results: 1, next_token: "opaque-next", templates: [{ template_id: "tpl-1", resource_tags: [{ tag_key: "project", tag_value: "demo" }] }] } });
  });

  it.each([{ steps: undefined }, { steps: [] }, { steps: [{ type: "run", args: ["echo changed"] }] }])("keeps omitted, clear, and changed steps distinct on same-name update ($steps)", async ({ steps }) => {
    const real = loadTemplate();
    const update = vi.fn().mockResolvedValue({ body: {}, statusCode: 200 });
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("TemplateAlreadyExists"), { code: "TemplateAlreadyExists", statusCode: 409 }));
    const client = {
      createTemplate: create, updateTemplate: update,
      listTemplates: vi.fn().mockResolvedValue({ body: { templates: [{ templateID: "tpl-1", name: "example" }] } }),
    };
    template._sdkLoader.load = () => ({ ...real, Client: function () { return client; } as any });
    await template.createOfficialTemplate({ name: "example", image: "example.invalid/base:v1", access_key_id: "placeholder-ak", access_key_secret: "placeholder-sk", team_id: "team-1", generation: 2, steps });
    expect(update).toHaveBeenCalledOnce();
    const body = update.mock.calls[0][1].body.toMap();
    if (steps === undefined) expect(body.runtimeConfig.sandboxConfig).not.toHaveProperty("steps");
    else expect(body.runtimeConfig.sandboxConfig.steps).toEqual(steps);
  });
});

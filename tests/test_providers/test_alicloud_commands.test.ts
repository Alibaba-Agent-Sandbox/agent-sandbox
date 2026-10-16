/** FC management protocol mappings, strict boundaries and secret-safe outputs. */
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ALICLOUD_COMMANDS, runAlicloudCommand } from "../../src/providers/alicloud_commands.js";
import { parseCommandSection, validateCommandInput, validateCommandOutput } from "../../src/providers/command_contract.js";
import { _sdkLoader } from "../../src/providers/fc_sdk.js";
import { LayeredConfig } from "../../src/transport/config_layers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const loadReal = _sdkLoader.load;
const config = new LayeredConfig({ access_key_id: "placeholder-ak", access_key_secret: "placeholder-sk", sandbox_api_key: "placeholder-runtime-key", region: "cn-hangzhou", http_timeout: 7 });
const oss = { bucket_name: "example-bucket", bucket_path: "/workspace", endpoint: "https://oss-cn-hangzhou.aliyuncs.com", read_only: false };
const secretDirectory = fs.mkdtempSync(join(tmpdir(), "abx-provider-secret-test-"));
const createFile = join(secretDirectory, "created-key");
const resetFile = join(secretDirectory, "rotated-key");

function fake(method: string, body: Record<string, unknown>): { call: ReturnType<typeof vi.fn>; makeClient: ReturnType<typeof vi.fn> } {
  const real = loadReal();
  const call = vi.fn().mockResolvedValue({ body });
  const makeClient = vi.fn(function () { return { [method]: call }; });
  _sdkLoader.load = () => ({ ...real, Client: makeClient as any });
  return { call, makeClient };
}

afterEach(() => { _sdkLoader.load = loadReal; vi.restoreAllMocks(); });
afterAll(() => { fs.rmSync(secretDirectory, { recursive: true, force: true }); });

describe("FC management descriptors", () => {
  it("discovers all 20 commands without loading SDK or credentials, with valid strict schemas", () => {
    const loader = vi.fn(() => { throw new Error("SDK must not load during discovery"); });
    _sdkLoader.load = loader;
    const commands = parseCommandSection({ protocol: "provider-commands/1", entries: ALICLOUD_COMMANDS }, "builtin");
    expect(commands).toHaveLength(20);
    expect(commands.some((entry) => entry.id.startsWith("domain."))).toBe(false);
    expect(loader).not.toHaveBeenCalled();
    for (const command of commands) {
      expect(command.input_schema.additionalProperties).toBe(false);
      expect(command.output_schema.additionalProperties).toBe(false);
      const action = command.id.split(".")[1];
      expect(command.effect).toBe(action === "get" || action === "list" ? "read" : action === "delete" ? "delete" : "write");
      expect(command.idempotent).toBe(!["create", "reset"].includes(action));
    }
  });

  it("advertises exactly one storage configuration in its input schema", () => {
    const descriptor = ALICLOUD_COMMANDS.find((entry) => entry.id === "volume.create")!;
    expect(() => validateCommandInput(descriptor, { team_id: "team-1", volume_name: "workspace" })).toThrow();
    expect(() => validateCommandInput(descriptor, { team_id: "team-1", volume_name: "workspace", oss_volume_config: oss })).not.toThrow();
    expect(() => validateCommandInput(descriptor, { team_id: "team-1", volume_name: "workspace", oss_volume_config: oss, agentic_fs_volume_config: { server_addr: "server" } })).toThrow();
  });
});

const cases: Array<{ id: string; method: string; input: Record<string, unknown>; body: Record<string, unknown>; args: unknown[]; data: unknown }> = [
  { id: "volume.create", method: "createVolumeWithOptions", input: { team_id: "team-1", volume_name: "workspace", oss_volume_config: oss }, body: { volume: { volumeID: "vol-1", volumeName: "workspace", ossVolumeConfig: { bucketName: "example-bucket", readOnly: false } } }, args: [{ body: { teamID: "team-1", volumeName: "workspace", ossVolumeConfig: { bucketName: "example-bucket", bucketPath: "/workspace", endpoint: oss.endpoint, readOnly: false } } }], data: { volume_id: "vol-1", volume_name: "workspace", oss_volume_config: { bucket_name: "example-bucket", read_only: false } } },
  { id: "volume.get", method: "getVolumeWithOptions", input: { team_id: "team-1", volume_id: "vol-1" }, body: { volume: { volumeID: "vol-1", storageClass: "OSS" } }, args: ["vol-1", { teamID: "team-1" }], data: { volume_id: "vol-1", storage_class: "OSS" } },
  { id: "volume.list", method: "listVolumesWithOptions", input: { team_id: "team-1", max_results: 3, next_token: "cursor-in" }, body: { volumes: [{ volumeID: "vol-1" }], maxResults: 3, nextToken: "cursor-out" }, args: [{ teamID: "team-1", maxResults: 3, nextToken: "cursor-in" }], data: { volumes: [{ volume_id: "vol-1" }], max_results: 3, next_token: "cursor-out" } },
  { id: "volume.update", method: "updateVolumeWithOptions", input: { team_id: "team-1", volume_id: "vol-1", status: "AVAILABLE" }, body: { volume: { volumeID: "vol-1", status: "AVAILABLE" } }, args: ["vol-1", { body: { teamID: "team-1", status: "AVAILABLE" } }], data: { volume_id: "vol-1", status: "AVAILABLE" } },
  { id: "volume.delete", method: "deleteVolumeWithOptions", input: { team_id: "team-1", volume_id: "vol-1" }, body: {}, args: ["vol-1", { teamID: "team-1" }], data: { deleted: true } },
  { id: "team.create", method: "createTeamWithOptions", input: { team_name: "dev", description: "Development", resource_group_id: "rg-1" }, body: { team: { teamID: "team-1", teamName: "dev" } }, args: [{ body: { teamName: "dev", description: "Development", resourceGroupID: "rg-1" } }], data: { team_id: "team-1", team_name: "dev" } },
  { id: "team.get", method: "getTeamWithOptions", input: { team_id: "team-1" }, body: { team: { teamID: "team-1", allowUpdateTeamName: false } }, args: ["team-1", {}], data: { team_id: "team-1", allow_update_team_name: false } },
  { id: "team.list", method: "listTeamsWithOptions", input: { page_number: 2, page_size: 10, team_name: "dev" }, body: { teams: [{ teamID: "team-1" }], pageNumber: 2, pageSize: 10, total: 13 }, args: [{ pageNumber: 2, pageSize: 10, teamName: "dev" }], data: { teams: [{ team_id: "team-1" }], page_number: 2, page_size: 10, total: 13 } },
  { id: "team.update", method: "updateTeamWithOptions", input: { team_id: "team-1", description: "Updated" }, body: { team: { teamID: "team-1", description: "Updated" } }, args: ["team-1", { body: { description: "Updated" } }], data: { team_id: "team-1", description: "Updated" } },
  { id: "team.delete", method: "deleteTeamWithOptions", input: { team_id: "team-1" }, body: {}, args: ["team-1", {}], data: { deleted: true } },
  { id: "api-key.create", method: "createApiKeyWithOptions", input: { team_id: "team-1", api_key_name: "dev", secret_file: createFile, ip_whitelist: [{ ip_address: "192.0.2.0/24" }] }, body: { apiKey: { apiKeyID: "key-1", apiKeyValue: "placeholder-created-secret" } }, args: [{ body: { teamID: "team-1", apiKeyName: "dev", ipWhitelist: [{ ipAddress: "192.0.2.0/24" }] } }], data: { api_key_id: "key-1", api_key_value: "[REDACTED]", secret_file: createFile } },
  { id: "api-key.get", method: "describeApiKeyWithOptions", input: { api_key_id: "key-1" }, body: { apiKey: { apiKeyID: "key-1", apiKeyValue: "placeholder-detail-secret" } }, args: ["key-1", {}], data: { api_key_id: "key-1", api_key_value: "[REDACTED]" } },
  { id: "api-key.list", method: "listApiKeysWithOptions", input: { team_id: "team-1", page_size: 5, status: "active" }, body: { apiKeys: [{ apiKeyID: "key-1", apiKeyValue: "placeholder-list-secret" }], pageSize: 5, total: 1 }, args: [{ teamID: "team-1", pageSize: 5, status: "active" }], data: { api_keys: [{ api_key_id: "key-1", api_key_value: "[REDACTED]" }], page_number: null, page_size: 5, total: 1 } },
  { id: "api-key.update", method: "updateApiKeyWithOptions", input: { api_key_id: "key-1", status: "inactive" }, body: { apiKey: { apiKeyID: "key-1", status: "inactive" } }, args: ["key-1", { body: { status: "inactive" } }], data: { api_key_id: "key-1", status: "inactive" } },
  { id: "api-key.reset", method: "resetApiKeyWithOptions", input: { api_key_id: "key-1", secret_file: resetFile }, body: { apiKey: { apiKeyID: "key-1", apiKeyValue: "placeholder-rotated-secret" } }, args: ["key-1", {}], data: { api_key_id: "key-1", api_key_value: "[REDACTED]", secret_file: resetFile } },
  { id: "api-key.delete", method: "deleteApiKeyWithOptions", input: { api_key_id: "key-1" }, body: {}, args: ["key-1", {}], data: { deleted: true } },
  { id: "quota.get", method: "describeQuotaWithOptions", input: { team_id: "team-1" }, body: { quota: { tagValue: "team-1", cpuCores: 2, memoryGB: 4 } }, args: [{ tagValue: "team-1" }], data: { tag_value: "team-1", cpu_cores: 2, memory_gb: 4 } },
  { id: "quota.list", method: "listQuotaWithOptions", input: { max_results: 5 }, body: { quotas: [], maxResults: 5 }, args: [{ maxResults: 5 }], data: { quotas: [], max_results: 5, next_token: null } },
  { id: "quota.update", method: "updateQuotaWithOptions", input: { team_id: "team-1", cpu_cores: 0, memory_gb: 0 }, body: { quota: { tagValue: "team-1", cpuCores: 0, memoryGB: 0 } }, args: [{ body: { tagValue: "team-1", cpuCores: 0, memoryGB: 0 } }], data: { tag_value: "team-1", cpu_cores: 0, memory_gb: 0 } },
  { id: "quota.delete", method: "deleteQuotaWithOptions", input: { team_id: "team-1" }, body: {}, args: [{ tagValue: "team-1" }], data: { deleted: true } },
];

describe("official SDK request/response mappings", () => {
  it.each(cases)("$id calls its exact method with generated models", async ({ id, method, input, body, args, data }) => {
    const { call, makeClient } = fake(method, { code: "Success", requestId: "req-1", ...body });
    const result = await runAlicloudCommand(config, id, input);
    expect(result).toEqual({ request_id: "req-1", data });
    expect(call).toHaveBeenCalledOnce();
    const actualArgs = call.mock.calls[0];
    expect(JSON.parse(JSON.stringify(actualArgs.slice(0, args.length)))).toEqual(args);
    for (const argument of actualArgs.slice(0, args.length)) if (typeof argument === "object") expect(argument.constructor.name).toMatch(/Request$/);
    expect(actualArgs.slice(args.length)).toEqual([{}, { autoretry: false, maxAttempts: 1, readTimeout: 7000, connectTimeout: 7000 }]);
    expect(makeClient.mock.calls[0][0]).toMatchObject({ accessKeyId: "placeholder-ak", accessKeySecret: "placeholder-sk", endpoint: "fcsandbox.cn-hangzhou.aliyuncs.com", retryOptions: { retryable: false } });
    expect(JSON.stringify(makeClient.mock.calls)).not.toContain("placeholder-runtime-key");
    validateCommandOutput(ALICLOUD_COMMANDS.find((entry) => entry.id === id)!, result);
  });

  it.each([
    { agentic_fs_volume_config: { server_addr: "ap.example.com:/workspace", user_id: 0, group_id: 0 } },
    { agentic_bucket_volume_config: { agentic_bucket: "agent-workspace", bucket_name: "example-bucket", bucket_path: "/", endpoint: oss.endpoint, read_only: true } },
  ])("supports remaining published storage configuration %#", async (storage) => {
    const { call } = fake("createVolumeWithOptions", { volume: { volumeID: "vol-1" } });
    const mount = "agentic_fs_volume_config" in storage ? { role: "acs:ram::123456:role/example", vpc_config: { vpc_id: "vpc-1", security_group_id: "sg-1", v_switch_ids: ["vsw-1"] } } : { role: "acs:ram::123456:role/example" };
    await runAlicloudCommand(config, "volume.create", { team_id: "team-1", volume_name: "workspace", ...storage, mount_config: mount });
    expect(call.mock.calls[0][0].body.mountConfig.role).toBe("acs:ram::123456:role/example");
    if ("agentic_fs_volume_config" in storage) expect(call.mock.calls[0][0].body.mountConfig.vpcConfig).toEqual({ vpcId: "vpc-1", securityGroupId: "sg-1", vSwitchIds: ["vsw-1"] });
  });

  it("uses the real generated client serializer, regional path and AK authentication", async () => {
    const real = loadReal();
    const callApi = vi.fn().mockResolvedValue({ body: { volume: { volumeID: "vol-1" } } });
    class Client extends real.Client { constructor(options: any) { super(options); this.callApi = callApi; } }
    _sdkLoader.load = () => ({ ...real, Client });
    await runAlicloudCommand(config, "volume.create", { team_id: "team-1", volume_name: "workspace", oss_volume_config: oss });
    const [params, request, runtime] = callApi.mock.calls[0];
    expect(params).toMatchObject({ action: "CreateVolume", version: "2026-05-09", pathname: "/pop/2026-05-09/volumes", authType: "AK", method: "POST" });
    expect(request.body).toEqual({ teamID: "team-1", volumeName: "workspace", ossVolumeConfig: { bucketName: "example-bucket", bucketPath: "/workspace", endpoint: oss.endpoint, readOnly: false } });
    expect(runtime.autoretry).toBe(false);
  });
});

describe("pre-I/O validation", () => {
  it.each([
    ["volume.create", { team_id: "team-1", volume_name: "workspace" }],
    ["volume.create", { team_id: "team-1", volume_name: "workspace", oss_volume_config: { ...oss, read_only: "false" } }],
    ["volume.create", { team_id: "team-1", volume_name: "workspace", oss_volume_config: { ...oss, bucket_path: "relative" } }],
    ["volume.create", { team_id: "team-1", volume_name: "workspace", agentic_bucket_volume_config: { agentic_bucket: "agent", bucket_name: "space", endpoint: oss.endpoint }, mount_config: { vpc_config: { vpc_id: "vpc-1", security_group_id: "sg-1", v_switch_ids: ["vsw-1"] } } }],
    ["volume.get", { team_id: "team-1", volume_id: "../other" }],
    ["volume.list", { max_results: 101 }],
    ["team.list", { page_number: 0 }],
    ["team.update", { team_id: "team-1" }],
    ["api-key.update", { api_key_id: "key-1" }],
    ["api-key.create", { team_id: "team-1", api_key_name: "test", expire_time: "yesterday" }],
    ["api-key.create", { team_id: "team-1", api_key_name: "test" }],
    ["api-key.reset", { api_key_id: "key-1" }],
    ["api-key.update", { api_key_id: "key-1", ip_whitelist: [{ ip_address: "0.0.0.0/99" }] }],
    ["quota.update", { team_id: "team-1", cpu_cores: -1, memory_gb: 4 }],
    ["volume.list", { endpoint: "https://example.com", access_key_secret: "placeholder" }],
    ["domain.list", {}],
  ])("rejects %s input %# without loading the SDK", async (id, input) => {
    const loader = vi.fn(() => { throw new Error("must not load"); });
    _sdkLoader.load = loader;
    await expect(runAlicloudCommand(config, id as string, input as any)).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
  });

  it("never substitutes the sandbox API key for AK/SK", async () => {
    const loader = vi.fn(() => { throw new Error("must not load"); });
    _sdkLoader.load = loader;
    await expect(runAlicloudCommand(new LayeredConfig({ sandbox_api_key: "placeholder-runtime-key" }), "volume.list", {})).rejects.toMatchObject({ code: "E1000" });
    expect(loader).not.toHaveBeenCalled();
  });
});

describe("response and error boundaries", () => {
  it("drops undeclared response fields including nested secret material", async () => {
    fake("getVolumeWithOptions", { volume: { volumeID: "vol-1", secret: "placeholder-private", ossVolumeConfig: { bucketName: "example", accessKeySecret: "placeholder-private" } } });
    expect(await runAlicloudCommand(config, "volume.get", { team_id: "team-1", volume_id: "vol-1" })).toEqual({ request_id: null, data: { volume_id: "vol-1", oss_volume_config: { bucket_name: "example" } } });
  });

  it.each([
    [{ code: "Forbidden", statusCode: 403, message: "placeholder-sk", data: { RequestId: "req-1", secret: "placeholder-private" } }, "E1000"],
    [{ code: "VolumeNotFound", statusCode: 404 }, "E8005"],
    [{ code: "QuotaExceeded", statusCode: 400 }, "E2002"],
  ])("maps sanitized SDK errors without retries %#", async (error, code) => {
    const { call } = fake("listVolumesWithOptions", {});
    call.mockRejectedValue(Object.assign(new Error("placeholder-sk placeholder-private"), error));
    const failure = await runAlicloudCommand(config, "volume.list", {}).catch((value) => value);
    expect((failure as { code: string }).code).toBe(code);
    expect(String(failure)).not.toMatch(/placeholder-sk|placeholder-private/);
    expect(call).toHaveBeenCalledOnce();
  });

  it.each(["exception", "envelope"])("explains inactive-key deletion without silently changing status (%s)", async (kind) => {
    const details = { code: "InvalidApiKeyStatus", statusCode: 400, message: "placeholder-existing-team placeholder-raw-secret", requestId: "request-test" };
    const { call, makeClient } = fake("deleteApiKeyWithOptions", details);
    if (kind === "exception") call.mockRejectedValue(Object.assign(new Error(details.message), details));
    const failure = await runAlicloudCommand(config, "api-key.delete", { api_key_id: "key-1" }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "E8002" });
    const message = String(failure);
    expect(message).toContain("InvalidApiKeyStatus");
    expect(message).toContain("must be inactive");
    expect(message).toContain("api-key.update");
    expect(message).toContain("status='inactive'");
    expect(message).not.toMatch(/placeholder-existing-team|placeholder-raw-secret/);
    expect(call).toHaveBeenCalledOnce();
    expect(makeClient).toHaveBeenCalledOnce();
    expect(Object.keys(makeClient.mock.results[0].value)).toEqual(["deleteApiKeyWithOptions"]);
  });

  it("rejects service-level error envelopes and malformed resource/list/pagination responses", async () => {
    for (const body of [{ code: "Forbidden", message: "placeholder-secret" }, { volume: null }, { volume: { volumeID: 123 } }]) {
      fake("getVolumeWithOptions", body);
      await expect(runAlicloudCommand(config, "volume.get", { team_id: "team-1", volume_id: "vol-1" })).rejects.toThrow();
    }
    fake("listVolumesWithOptions", { volumes: [], nextToken: 123 });
    await expect(runAlicloudCommand(config, "volume.list", {})).rejects.toMatchObject({ code: "E8020" });
  });

  it("reports SDK load failures without exposing an underlying import error", async () => {
    _sdkLoader.load = () => { throw new Error("placeholder-private"); };
    await expect(runAlicloudCommand(config, "volume.list", {})).rejects.toThrow("management SDK could not be loaded");
  });
});

describe("exclusive API key secret export", () => {
  it("rejects relative secret paths before contacting the cloud", async () => {
    const { call } = fake("resetApiKeyWithOptions", {});
    await expect(runAlicloudCommand(config, "api-key.reset", { api_key_id: "key-1", secret_file: "relative-key" })).rejects.toMatchObject({ code: "E8002" });
    expect(call).not.toHaveBeenCalled();
  });

  it("stores created and rotated secrets only in mode-0600 files", async () => {
    for (const action of ["create", "reset"]) {
      const file = join(secretDirectory, `mode-${action}`);
      fake(`${action}ApiKeyWithOptions`, { apiKey: { apiKeyID: "key-1", apiKeyValue: "placeholder-private" } });
      const input = action === "create" ? { team_id: "team-1", api_key_name: "dev", secret_file: file } : { api_key_id: "key-1", secret_file: file };
      const result = await runAlicloudCommand(config, `api-key.${action}`, input);
      expect(fs.readFileSync(file, "utf8")).toBe("placeholder-private\n");
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(JSON.stringify(result)).not.toContain("placeholder-private");
    }
  });

  it.each(["existing", "symlink"])("refuses an %s destination before contacting the cloud", async (kind) => {
    const file = join(secretDirectory, `conflict-${kind}`);
    if (kind === "existing") fs.writeFileSync(file, "original");
    else { fs.writeFileSync(join(secretDirectory, "symlink-target"), "original"); fs.symlinkSync(join(secretDirectory, "symlink-target"), file); }
    const { call } = fake("resetApiKeyWithOptions", {});
    await expect(runAlicloudCommand(config, "api-key.reset", { api_key_id: "key-1", secret_file: file })).rejects.toMatchObject({ code: "E8002" });
    expect(call).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf8")).toBe("original");
  });

  it("removes only its reserved empty file after cloud failure without leaking secret text", async () => {
    const file = join(secretDirectory, "cloud-failure");
    const { call } = fake("resetApiKeyWithOptions", {});
    call.mockImplementation(async () => {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(file, "utf8")).toBe("");
      throw new Error("placeholder-private");
    });
    const failure = await runAlicloudCommand(config, "api-key.reset", { api_key_id: "key-1", secret_file: file }).catch((error) => error);
    expect(String(failure)).not.toContain("placeholder-private");
    expect(fs.existsSync(file)).toBe(false);
    expect(call).toHaveBeenCalledOnce();
  });

  it("retains a replacement file when the reserved path was replaced during a failed request", async () => {
    const file = join(secretDirectory, "replacement");
    const { call } = fake("resetApiKeyWithOptions", {});
    call.mockImplementation(async () => {
      fs.unlinkSync(file);
      fs.writeFileSync(file, "replacement-owned-by-caller");
      throw new Error("cloud failure");
    });
    await expect(runAlicloudCommand(config, "api-key.reset", { api_key_id: "key-1", secret_file: file })).rejects.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("replacement-owned-by-caller");
  });

  it("reports missing remote secret as a changed-remote outcome and removes the empty reservation", async () => {
    const file = join(secretDirectory, "missing-remote-secret");
    fake("resetApiKeyWithOptions", { apiKey: { apiKeyID: "key-1" } });
    await expect(runAlicloudCommand(config, "api-key.reset", { api_key_id: "key-1", secret_file: file })).rejects.toThrow("changed remotely");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("reports a local write failure after remote rotation without leaking the new key or retrying", async () => {
    const file = join(secretDirectory, "write-failure");
    const { call } = fake("resetApiKeyWithOptions", { apiKey: { apiKeyID: "key-1", apiKeyValue: "placeholder-new-private" } });
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("placeholder-new-private"); });
    const failure = await runAlicloudCommand(config, "api-key.reset", { api_key_id: "key-1", secret_file: file }).catch((error) => error);
    writeSpy.mockRestore();
    expect(String(failure)).toContain("changed remotely");
    expect(String(failure)).not.toContain("placeholder-new-private");
    expect(fs.existsSync(file)).toBe(false);
    expect(call).toHaveBeenCalledOnce();
  });

  it("retains a partially written credential file for recovery with mode 0600", async () => {
    const file = join(secretDirectory, "partial-write");
    const { call } = fake("resetApiKeyWithOptions", { apiKey: { apiKeyID: "key-1", apiKeyValue: "placeholder-new-private" } });
    const write = fs.writeFileSync;
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((fd: any) => { write(fd, "placeholder-partial"); throw new Error("write interrupted"); });
    await expect(runAlicloudCommand(config, "api-key.reset", { api_key_id: "key-1", secret_file: file })).rejects.toThrow("changed remotely");
    writeSpy.mockRestore();
    expect(fs.readFileSync(file, "utf8")).toBe("placeholder-partial");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(call).toHaveBeenCalledOnce();
  });
});

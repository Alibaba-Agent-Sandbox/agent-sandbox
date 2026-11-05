import { afterEach, describe, expect, it, vi } from "vitest";
import { getProviderCommand, runProviderCommand } from "../../src/providers/commands.js";
import { HttpClient, HTTPStatusError, ReadTimeout, Request, Response } from "../../src/transport/http.js";
import { useIso } from "../_support/iso.js";
import { inspect } from "node:util";
import { Sandbox } from "../../src/api/sandbox.js";
import { SandboxConfig, SandboxInfo } from "../../src/models/sandbox.js";
import { ApiKeyAuth } from "../../src/transport/auth_contract.js";
import { LayeredConfig } from "../../src/transport/config_layers.js";
import { getProvider } from "../../src/providers/registry.js";
import { EnvdTokenManager } from "../../src/providers/shared/e2b/auth.js";
import { ExpressSandboxProtocol } from "../../src/providers/alicloud_express/sandbox.js";

useIso();
afterEach(() => vi.restoreAllMocks());
const options = { sandbox_api_key: "placeholder-runtime-key", sandbox_base_url: "https://api.example.test" };
const invoke = (id: string, input: Record<string, unknown>) => runProviderCommand("alicloud-express", id, input, options);
const mounts = {
  named_volume_mounts: [{ name: "existing-workspace", path: "/mnt/named" }],
  inline_volume_mounts: {
    oss: { mount_points: [{ bucket_name: "workspace-bucket", mount_dir: "/mnt/oss", endpoint: "oss-cn-hangzhou.aliyuncs.com", read_only: true }] },
    agentic_fs: { user_id: -1, group_id: 1000, mount_points: [{ server_addr: "ap.example.test:/data", mount_dir: "/mnt/agenticfs" }] },
    agentic_bucket: { mount_points: [{ agentic_bucket: "workspace", bucket_name: "space", endpoint: "oss-cn-hangzhou.aliyuncs.com", mount_dir: "/mnt/agenticbucket" }] },
    juice_fs: { envs: { BASE_URL: "https://juice.example.test" }, mount_points: [{ volume_name: "data", token: "placeholder-storage-secret", remote_dir: "/input", mount_dir: "/mnt/juicefs", args: ["--read-only"] }] },
  },
};

describe("Express runtime extension requests", () => {
  it("appends named and all four inline storage types in one non-replayed empty-response request", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(204));
    expect(getProviderCommand("alicloud-express", "sandbox.mounts.append")).toMatchObject({ effect: "write", idempotent: false });
    expect(await invoke("sandbox.mounts.append", { sandbox_id: "source", ...mounts })).toEqual({ sandbox_id: "source", appended: true });
    expect(call).toHaveBeenCalledExactlyOnceWith("POST", "/sandboxes/source/fc-volume-mounts", {
      json: {
        namedVolumeMounts: [{ name: "existing-workspace", path: "/mnt/named" }],
        inlineVolumeMounts: {
          oss: { mountPoints: [{ bucketName: "workspace-bucket", mountDir: "/mnt/oss", endpoint: "oss-cn-hangzhou.aliyuncs.com", readOnly: true }] },
          agenticFS: { userID: -1, groupID: 1000, mountPoints: [{ serverAddr: "ap.example.test:/data", mountDir: "/mnt/agenticfs" }] },
          agenticBucket: { mountPoints: [{ agenticBucket: "workspace", bucketName: "space", endpoint: "oss-cn-hangzhou.aliyuncs.com", mountDir: "/mnt/agenticbucket" }] },
          juiceFS: { envs: { BASE_URL: "https://juice.example.test" }, mountPoints: [{ volumeName: "data", token: "placeholder-storage-secret", remoteDir: "/input", mountDir: "/mnt/juicefs", args: ["--read-only"] }] },
        },
      }, request_timeout: 120,
    });
  });

  it.each([
    {}, { named_volume_mounts: [] }, { inline_volume_mounts: {} },
    { named_volume_mounts: [{ name: "work", path: "/var/data" }] },
    { named_volume_mounts: [{ name: "work", path: "/mnt/a" }, { name: "more", path: "/mnt/a/child" }] },
    { named_volume_mounts: [{ name: "work", path: "/mnt/a" }], inline_volume_mounts: { oss: { mount_points: [{ bucket_name: "bucket", endpoint: "example.test", mount_dir: "/mnt/a" }] } } },
    { inline_volume_mounts: { juice_fs: { mount_points: [{ volume_name: "data", token: "placeholder", mount_dir: "/mnt/data", args: ["--token=bad"] }] } } },
    { named_volume_mounts: [{ name: "work", path: "/mnt/.hidden" }] },
  ])("rejects unsafe or empty append input before I/O %#", async (input) => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest");
    await expect(invoke("sandbox.mounts.append", { sandbox_id: "source", ...input })).rejects.toMatchObject({ code: "E8002" });
    expect(call).not.toHaveBeenCalled();
  });

  it("updates network with the exact replacement object and supports explicit empty clearing", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(204));
    const network = { allow_internet_access: false, allow_out: ["api.example.test"], deny_out: ["0.0.0.0/0"], rules: { "api.example.test": [{ transform: { headers: { Authorization: "Bearer placeholder-rule-secret" } } }] } };
    expect(await invoke("sandbox.network.update", { sandbox_id: "source", network })).toEqual({ sandbox_id: "source", updated: true });
    // Both locked standard SDKs use this mixed spelling for runtime PUT:
    // allow_internet_access stays snake_case; allowOut/denyOut stay camelCase.
    expect(call).toHaveBeenLastCalledWith("PUT", "/sandboxes/source/network", { json: { allow_internet_access: false, allowOut: network.allow_out, denyOut: network.deny_out, rules: network.rules }, request_timeout: 30 });
    expect(await invoke("sandbox.network.update", { sandbox_id: "source", network: {} })).toEqual({ sandbox_id: "source", updated: true });
    expect(call).toHaveBeenLastCalledWith("PUT", "/sandboxes/source/network", { json: {}, request_timeout: 30 });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, { allow_public_traffic: false }, { mask_request_host: "a" }, { egress_proxy: {} }, { unknown: true }])("refuses missing, unsupported and create-only network fields %#", async (network) => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest");
    await expect(invoke("sandbox.network.update", { sandbox_id: "source", ...(network === undefined ? {} : { network }) })).rejects.toMatchObject({ code: "E8002" });
    expect(call).not.toHaveBeenCalled();
  });

  it("sets lifetime without connecting or implicitly resuming", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(204));
    expect(await invoke("sandbox.timeout", { sandbox_id: "source", timeout: 600, request_timeout: 9 })).toEqual({ sandbox_id: "source", timeout: 600 });
    expect(call).toHaveBeenCalledExactlyOnceWith("POST", "/sandboxes/source/timeout", { json: { timeout: 600 }, request_timeout: 9 });
  });

  it.each([400, 403, 409, 429, 500])("never replays append or exposes input secrets after HTTP%d", async (status) => {
    const req = new Request("POST", "https://api.example.test/sandboxes/source/fc-volume-mounts");
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockRejectedValue(new HTTPStatusError("placeholder-storage-secret", { request: req, response: new Response(status, { request: req, text: "placeholder-storage-secret" }) }));
    const task = invoke("sandbox.mounts.append", { sandbox_id: "source", ...mounts });
    await expect(task).rejects.not.toThrow("placeholder-storage-secret");
    expect(call).toHaveBeenCalledOnce();
  });

  it("keeps unknown-outcome deadlines distinct from success and closes the runner", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockRejectedValue(new ReadTimeout("placeholder-rule-secret"));
    const close = vi.spyOn(HttpClient.prototype, "close").mockResolvedValue();
    await expect(invoke("sandbox.network.update", { sandbox_id: "source", network: {} })).rejects.toMatchObject({ code: "E8022", message: expect.stringContaining("unknown") });
    expect(call).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("Express private gateway sessions", () => {
  it.each(['quoted-"rule\\secret', "abc"])("withholds encoded and short network credentials from create failure diagnostics %#", async secret => {
    const request = new Request("POST", "https://api.example.test/sandboxes");
    const reflected = JSON.stringify({ rule: secret });
    vi.spyOn(HttpClient.prototype, "platformRequest").mockRejectedValue(new HTTPStatusError(reflected, {
      request, response: new Response(400, { request, json: { message: reflected } }),
    }));
    const config = new LayeredConfig(options);
    const http = new HttpClient(config.toTransportConfig(), new ApiKeyAuth(options.sandbox_api_key));
    try {
      await new ExpressSandboxProtocol(http).create(new SandboxConfig({ network: { rules: { "api.example.test": [{ transform: { headers: { Authorization: secret } } }] } } }));
      throw new Error("create unexpectedly succeeded");
    } catch (error) {
      expect(error).toMatchObject({ code: "E2000", status_code: 400,
        message: "Express sandbox creation failed (HTTP400). Network credential details were withheld.",
        suggestion: "Inspect the selected template and network settings before deliberately retrying.", docs_url: "" });
      expect(error).not.toHaveProperty("cause");
      expect(inspect(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(JSON.stringify(secret).slice(1, -1));
    } finally { await http.close(); }
  });

  it("redacts credential-bearing network rules from typed create errors and their diagnostics", async () => {
    const request = new Request("POST", "https://api.example.test/sandboxes");
    vi.spyOn(HttpClient.prototype, "platformRequest").mockRejectedValue(new HTTPStatusError("echo placeholder-rule-secret", {
      request, response: new Response(400, { request, json: { message: "Invalid header Bearer placeholder-rule-secret" } }),
    }));
    const config = new LayeredConfig(options);
    const http = new HttpClient(config.toTransportConfig(), new ApiKeyAuth(options.sandbox_api_key));
    try {
      await new ExpressSandboxProtocol(http).create(new SandboxConfig({ network: { rules: { "api.example.test": [{ transform: { headers: { Authorization: "Bearer placeholder-rule-secret" } } }] } } }));
      throw new Error("create unexpectedly succeeded");
    } catch (error) {
      expect(error).toMatchObject({ code: "E2000" });
      expect(String(error)).not.toContain("placeholder-rule-secret");
      expect(inspect(error)).not.toContain("placeholder-rule-secret");
      expect(JSON.stringify(error)).not.toContain("placeholder-rule-secret");
    } finally { await http.close(); }
  });

  it("creates real top-level network configuration with secure envd and retains an unprinted gateway token", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(201, { json: { sandboxID: "source", envdAccessToken: "placeholder-envd", trafficAccessToken: "placeholder-traffic-secret" } }));
    const config = new LayeredConfig(options);
    const http = new HttpClient(config.toTransportConfig(), new ApiKeyAuth(options.sandbox_api_key));
    const protocol = new ExpressSandboxProtocol(http);
    const info = await protocol.create(new SandboxConfig({ network: { allow_public_traffic: false, allow_internet_access: false, allow_out: ["api.example.test"] } }));
    expect(call).toHaveBeenCalledWith("POST", "/sandboxes", { json: expect.objectContaining({ secure: true, allowInternetAccess: false, network: { allowPublicTraffic: false, allowOut: ["api.example.test"] } }), request_timeout: null });
    expect(info.traffic_access_token).toBe("placeholder-traffic-secret");
    expect(info.modelDump()).not.toHaveProperty("traffic_access_token");
    expect(JSON.stringify(info)).not.toContain("placeholder-traffic-secret");
    expect(inspect(info)).not.toContain("placeholder-traffic-secret");
    await http.close();
  });

  it("keeps envd, gateway and application authentication separate across a read-only refresh", async () => {
    const config = new LayeredConfig(options);
    const http = new HttpClient(config.toTransportConfig(), new ApiKeyAuth(options.sandbox_api_key));
    const call = vi.spyOn(http, "platformRequest").mockResolvedValue(new Response(200, { json: { sandboxID: "source", envdAccessToken: "placeholder-envd" } }));
    const info = new SandboxInfo({ sandboxID: "source", envdAccessToken: "placeholder-envd", trafficAccessToken: "placeholder-traffic-secret" });
    const sandbox = new Sandbox({ info, config: config.toTransportConfig(), http_client: http, auth: new ApiKeyAuth(options.sandbox_api_key), envd_token: new EnvdTokenManager("placeholder-envd", "source"), provider_id: "alicloud-express" });
    expect((await sandbox.network.resolveEndpoint(9000)).headers).toEqual({ "e2b-traffic-access-token": "placeholder-traffic-secret" });
    expect(sandbox.network.getAccessHeaders()).toEqual({ "X-Access-Token": "placeholder-envd" });
    expect(call).not.toHaveBeenCalled();
    await sandbox.refreshInfo();
    expect(sandbox.traffic_access_token).toBe("placeholder-traffic-secret");
    expect((await sandbox.network.resolveEndpoint(9000)).headers).toEqual({ "e2b-traffic-access-token": "placeholder-traffic-secret" });
    expect(call).toHaveBeenCalledExactlyOnceWith("GET", "/sandboxes/source", {});
    expect(JSON.stringify(sandbox)).not.toContain("placeholder-traffic-secret");
    expect(inspect(sandbox)).not.toContain("placeholder-traffic-secret");
    await sandbox.close();
  });

  it("rejects an insecure private gateway before preparing credentials or infrastructure", async () => {
    const build = vi.spyOn(getProvider("alicloud-express"), "buildInfra");
    await expect(Sandbox.create({ network: { allow_public_traffic: false }, secure: false })).rejects.toMatchObject({ code: "E8002" });
    expect(build).not.toHaveBeenCalled();
  });
});

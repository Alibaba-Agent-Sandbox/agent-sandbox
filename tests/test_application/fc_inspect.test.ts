import "../_support/isolatedHome.js";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFcInspector, fcInspectSeams } from "../../src/application/adapters/serverless_fc3.js";

const original = { ...fcInspectSeams };
const profile = { AccountID: "123456789", AccessKeyID: "placeholder-ak", AccessKeySecret: "placeholder-secret", SecurityToken: "placeholder-sts" };
function mockSdk(body: unknown = { functionName: "app-gateway", functionId: "native-id", functionArn: "acs:fc:cn-hangzhou:123456789:functions/app-gateway" }) {
  const getFunction = vi.fn().mockResolvedValue({ statusCode: 200, body });
  const createFunction = vi.fn().mockResolvedValue({ statusCode: 201, body });
  const createClient = vi.fn().mockReturnValue({ getFunction, createFunction });
  fcInspectSeams.credentials = () => ({ get: vi.fn().mockResolvedValue({ credential: profile }) });
  fcInspectSeams.sdk = () => ({ createClient, request: () => ({ qualifier: "LATEST" }), createRequest: input => ({ body: input }) });
  return { getFunction, createClient, createFunction };
}
afterEach(() => { Object.assign(fcInspectSeams, original); vi.unstubAllEnvs(); });

describe("FC native identity and absence inspection", () => {
  it("uses one resolved AK/STS snapshot for both SDK and the SD child without changing the host environment", async () => {
    const { createClient, getFunction } = mockSdk();
    vi.stubEnv("AccountID", "999999"); vi.stubEnv("AccessKeyID", "ambient-placeholder");
    vi.stubEnv("AccessKeySecret", "ambient-placeholder");
    const inspector = await createFcInspector("reviewed-access");
    await expect(inspector.describeFunction("cn-hangzhou", "app-gateway")).resolves.toMatchObject({ functionId: "native-id" });
    expect(getFunction).toHaveBeenCalledWith("app-gateway", { qualifier: "LATEST" });
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ accessKeyId: profile.AccessKeyID, accessKeySecret: profile.AccessKeySecret,
      securityToken: profile.SecurityToken, endpoint: "fcv3.cn-hangzhou.aliyuncs.com", protocol: "https" }));
    const environment = inspector.serverlessEnvironment();
    expect(environment.AccountID).toBeUndefined(); expect(environment.AccessKeyID).toBeUndefined(); expect(environment.AccessKeySecret).toBeUndefined();
    expect(JSON.parse(environment.abx_application_serverless_devs_key!)).toEqual(profile);
    expect(environment.serverless_devs_access_cicd_alias_name).toBe("abx_application_serverless_devs_key");
    expect(environment.SERVERLESS_DEVS_CICD).toBe("1");
    expect(process.env.AccountID).toBe("999999");
    environment.abx_application_serverless_devs_key = "changed";
    expect(JSON.parse(inspector.serverlessEnvironment().abx_application_serverless_devs_key!)).toEqual(profile);
  });

  it("returns null only for a native FunctionNotFound with numeric404", async () => {
    const { getFunction } = mockSdk();
    getFunction.mockRejectedValue({ statusCode: 404, code: "FunctionNotFound", message: "sensitive-placeholder" });
    await expect((await createFcInspector("reviewed-access")).describeFunction("cn-hangzhou", "app-gateway")).resolves.toBeNull();
  });

  it.each([
    { statusCode: 404, code: "AccessDenied" }, { statusCode: 403, code: "FunctionNotFound" },
    { statusCode: "404", code: "FunctionNotFound" }, { statusCode: 404 },
    new Error("404 FunctionNotFound sensitive-placeholder"), { code: "ETIMEDOUT" },
  ])("fails closed and suppresses response details for other errors (%#)", async error => {
    const { getFunction } = mockSdk(); getFunction.mockRejectedValue(error);
    const request = (await createFcInspector("reviewed-access")).describeFunction("cn-hangzhou", "app-gateway");
    await expect(request).rejects.toThrow("absence was not established");
    await expect(request).rejects.not.toThrow("sensitive-placeholder");
  });

  it.each([
    { functionName: "other", functionId: "id", functionArn: "acs:fc:cn-hangzhou:123456789:functions/app-gateway" },
    { functionName: "app-gateway", functionId: "id", functionArn: "acs:fc:cn-hangzhou:999999:functions/app-gateway" },
    { functionName: "app-gateway", functionId: "id", functionArn: "acs:fc:cn-beijing:123456789:functions/app-gateway" },
    { functionName: "app-gateway", functionArn: "acs:fc:cn-hangzhou:123456789:functions/app-gateway" },
    null,
  ])("rejects malformed or foreign native identities (%#)", async body => {
    mockSdk(body);
    await expect((await createFcInspector("reviewed-access")).describeFunction("cn-hangzhou", "app-gateway")).rejects.toThrow("absence was not established");
  });

  it("does not include profile errors or credential values in public errors", async () => {
    fcInspectSeams.credentials = () => ({ get: vi.fn().mockRejectedValue(new Error(profile.AccessKeySecret)) });
    const request = createFcInspector("reviewed-access");
    await expect(request).rejects.toThrow("parser output were withheld");
    await expect(request).rejects.not.toThrow(profile.AccessKeySecret);
  });

  it("the official credential resolver reads the injected SD child alias including the STS token", async () => {
    mockSdk(); const inspector = await createFcInspector("reviewed-access");
    const environment = inspector.serverlessEnvironment();
    for (const key of ["AccountID", "AccessKeyID", "AccessKeySecret"]) vi.stubEnv(key, undefined);
    for (const key of ["abx_application_serverless_devs_key", "SERVERLESS_DEVS_CICD", "serverless_devs_access_cicd_alias_name"]) vi.stubEnv(key, environment[key]);
    const resolved = await original.credentials().get("reviewed-access");
    expect(resolved.credential).toEqual(profile);
  }, 120000); // Cold reads of the installed dependency tree can exceed 20s on mounted workspaces.

  it("the official SDK loads with matching request models without making a cloud call", () => {
    const sdk = original.sdk();
    expect(sdk.request()).toMatchObject({ qualifier: "LATEST" });
    expect(sdk.createClient({ accessKeyId: "placeholder", accessKeySecret: "placeholder", endpoint: "fcv3.cn-hangzhou.aliyuncs.com" })).toHaveProperty("getFunction");
  }, 120000);

  it("atomically creates through CreateFunction and never calls Get/Update as a substitute", async () => {
    const body = { functionName: "app-gateway", functionId: "new-native-id", createdTime: "2026-10-20T00:00:00Z", functionArn: "acs:fc:cn-hangzhou:123456789:functions/app-gateway" };
    const { createFunction, getFunction } = mockSdk(body);
    const props = { functionName: "app-gateway", runtime: "custom-container", customContainerConfig: { image: "registry.example/app@sha256:" + "a".repeat(64), port: 9000 } };
    const inspector = await createFcInspector("reviewed-access");
    await expect(inspector.createFunction("cn-hangzhou", props)).resolves.toEqual(body);
    expect(createFunction).toHaveBeenCalledExactlyOnceWith({ body: props });
    expect(getFunction).not.toHaveBeenCalled();
  });

  it("refuses an atomic name conflict without adopting or updating the winner", async () => {
    const { createFunction, getFunction } = mockSdk();
    createFunction.mockRejectedValue({ statusCode: 409, code: "FunctionAlreadyExists", message: "sensitive-placeholder" });
    await expect((await createFcInspector("reviewed-access")).createFunction("cn-hangzhou", { functionName: "app-gateway" })).rejects.toThrow("refused to overwrite");
    expect(createFunction).toHaveBeenCalledTimes(1); expect(getFunction).not.toHaveBeenCalled();
  });

  it("does not retry or claim ownership after a create timeout or malformed identity", async () => {
    const { createFunction } = mockSdk();
    createFunction.mockRejectedValueOnce(new Error("sensitive-placeholder"));
    const inspector = await createFcInspector("reviewed-access");
    await expect(inspector.createFunction("cn-hangzhou", { functionName: "app-gateway" })).rejects.toThrow("outcome is unconfirmed");
    createFunction.mockResolvedValueOnce({ statusCode: 201, body: { functionName: "app-gateway", functionId: "id", functionArn: "acs:fc:cn-hangzhou:999999:functions/app-gateway", createdTime: "2026-10-20T00:00:00Z" } });
    await expect(inspector.createFunction("cn-hangzhou", { functionName: "app-gateway" })).rejects.toThrow("outcome is unconfirmed");
    expect(createFunction).toHaveBeenCalledTimes(2);
  });

  it("serializes the official native request including nested container/VPC fields while excluding SD metadata", () => {
    const sdk = original.sdk();
    const container = { image: "registry.example/app@sha256:" + "a".repeat(64), port: 9000, command: ["--serve"] };
    const vpc = { vpcId: "vpc-placeholder", securityGroupId: "sg-placeholder", vSwitchIds: ["vsw-placeholder"] };
    const request = sdk.createRequest({ functionName: "app-gateway", runtime: "custom-container", customContainerConfig: container, vpcConfig: vpc,
      region: "cn-hangzhou", triggers: [], asyncInvokeConfig: { asyncTask: true }, environmentVariables: { ABX_APP_REVISION: "plan-placeholder" } }) as { body: unknown };
    const core = createRequire(import.meta.url)("@alicloud/openapi-core") as { OpenApiUtil: { parseToMap(input: unknown): Record<string, unknown> } };
    const serialized = core.OpenApiUtil.parseToMap(request.body);
    expect(serialized).toEqual({ functionName: "app-gateway", runtime: "custom-container", customContainerConfig: container, vpcConfig: vpc, environmentVariables: { ABX_APP_REVISION: "plan-placeholder" } });
    expect(() => sdk.createRequest({ functionName: "app-gateway", endpoint: "unreviewed.example" })).toThrow("unsupported deployment-only fields");
    expect(() => sdk.createRequest({ functionName: "app-gateway", customDomain: { domainName: "unreviewed.example" } })).toThrow("unsupported deployment-only fields");
  }, 120000);
});

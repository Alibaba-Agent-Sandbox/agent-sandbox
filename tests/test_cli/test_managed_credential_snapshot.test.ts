import "../_support/isolatedHome.js";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { resolveDeployCredentials, createFcTransport } from "../../src/providers/alicloud_express/application/fc.js";
import { _setPaths, paths, resetLayeredConfig } from "../../src/transport/config_layers.js";

const require = createRequire(import.meta.url);
const core = require("@alicloud/openapi-core") as {default: {prototype: {callApi(...args: unknown[]): Promise<unknown>}}};
const previous = {...paths}, folders: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); _setPaths(previous); resetLayeredConfig(); for (const folder of folders.splice(0)) fs.rmSync(folder, {recursive: true, force: true}); });

it.each(["abx", "env", "default"])("uses one %s AK/SK/STS snapshot in real STS and FC SDK HTTP requests", async accessRef => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-sts-snapshot-")); folders.push(root);
  const envFile = path.join(root, ".env");
  fs.writeFileSync(envFile, "ALICLOUD_ACCESS_KEY_ID=fixture-ak\nALICLOUD_ACCESS_KEY_SECRET=fixture-sk\nALIBABA_CLOUD_SECURITY_TOKEN=fixture-saved-sts\n", {mode: 0o600});
  _setPaths({abxDir: root, configFile: path.join(root, "config.toml"), envFiles: [envFile]});
  for (const key of ["ALIBABA_CLOUD_ACCESS_KEY_ID", "ALIBABA_CLOUD_ACCESS_KEY_SECRET", "ALICLOUD_ACCESS_KEY_ID", "ALICLOUD_ACCESS_KEY_SECRET", "ALIBABA_CLOUD_SECURITY_TOKEN", "ALICLOUD_SECURITY_TOKEN"]) vi.stubEnv(key, "");
  if (accessRef === "env") {
    vi.stubEnv("ALICLOUD_ACCESS_KEY_ID", "fixture-ak"); vi.stubEnv("ALICLOUD_ACCESS_KEY_SECRET", "fixture-sk"); vi.stubEnv("ALICLOUD_SECURITY_TOKEN", "fixture-saved-sts");
  }
  if (accessRef === "default") {
    const reader = require("@serverless-devs/credential") as {default: {prototype: {get(name: string): Promise<{credential: Record<string, unknown>}>}}};
    vi.spyOn(reader.default.prototype, "get").mockResolvedValue({credential: {AccessKeyID: "fixture-ak", AccessKeySecret: "fixture-sk", SecurityToken: "fixture-saved-sts"}});
  }
  const requests: Array<{action: string; headers: http.IncomingHttpHeaders; url: string}> = [];
  const server = http.createServer((request, response) => {
    requests.push({action: String(request.headers["x-acs-action"]), headers: request.headers, url: request.url ?? ""});
    request.resume(); response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.headers["x-acs-action"] === "GetCallerIdentity" ? {AccountId: "123"} : {functionName: "fixture", functionArn: "acs:fc:cn-hangzhou:123:functions/fixture", functionId: "fixture-id", createdTime: "2026-11-12T00:00:00Z"}));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const original = core.default.prototype.callApi, endpoint = `127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  // Route the official SDK to a local server; preserve its original serializer and signer.
  vi.spyOn(core.default.prototype, "callApi").mockImplementation(function(this: {_endpoint: string; _protocol: string}, ...args) {
    this._endpoint = endpoint; this._protocol = "http"; return original.apply(this, args);
  });
  try {
    const snapshot = await resolveDeployCredentials(accessRef);
    expect(snapshot).toMatchObject({AccessKeyID: "fixture-ak", AccessKeySecret: "fixture-sk", SecurityToken: "fixture-saved-sts"});
    vi.stubEnv("ALIBABA_CLOUD_SECURITY_TOKEN", "fixture-later-sts");
    expect(await createFcTransport(snapshot, "cn-hangzhou").describeFunction("fixture")).toMatchObject({functionName: "fixture"});
    expect(requests.map(item => item.action)).toEqual(["GetCallerIdentity", "GetFunction"]);
    expect(requests[1].headers["x-acs-security-token"]).toBe("fixture-saved-sts");
    expect(JSON.stringify(requests)).not.toContain("fixture-later-sts");
    expect(String(requests[0].headers["x-acs-security-token"] ?? requests[0].url)).toContain("fixture-saved-sts");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

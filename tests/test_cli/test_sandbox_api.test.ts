import "../_support/isolatedHome.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { paths } from "../../src/transport/config_layers.js";
import { sandboxApiSeams } from "../../src/cli/commands/sandbox_api.js";
import { loadRegistryApis } from "../../src/cli/api_contract.js";
import { bindingOptions, saveApiBinding, type ApiBinding } from "../../src/cli/api_binding.js";
import { saveDeployment } from "../../src/cli/deployment_store.js";
import { resetCliSelection } from "../../src/providers/selection.js";
import { renderScaffold } from "../../src/cli/scaffold.js";
import type { Sandbox } from "../../src/api/sandbox.js";
import { openApiHttpSeams } from "../../src/transport/openapi_http.js";

let tmp: string;
const run = (args: string[]) => new CliRunner().invoke(cli, ["--json", ...args]);
function registry(auth = false) {
  const document: Record<string, unknown> = {
  "openapi": "3.1.0",
  "info": {
    "title": "Report",
    "version": "1"
  },
  "servers": [
    {
      "url": "https://must-not-be-used.invalid"
    }
  ],
  "paths": {
    "/totals/{report}": {
      "post": {
        "operationId": "report_totals",
        "summary": "Sum a report",
        "parameters": [
          {
            "name": "report",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "enabled",
            "in": "query",
            "schema": {
              "type": "boolean"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "values"
                ],
                "additionalProperties": false,
                "properties": {
                  "values": {
                    "type": "array",
                    "items": {
                      "type": "number"
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Total",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                },
                "example": {
                  "total": 6
                }
              }
            }
          }
        }
      }
    }
  }
};
  if (auth) Object.assign(document, {security:[{token:[]}],components:{securitySchemes:{token:{type:"http",scheme:"bearer"}}}});
  fs.writeFileSync(path.join(tmp, "api.json"), JSON.stringify(document));
  const file = path.join(tmp, "registry.yaml");
  fs.writeFileSync(file, "apis:\n  report:\n    resource: sandbox.report\n    port: 9000\n    openapi: ./api.json\n");
  return file;
}
function binding(auth = false): ApiBinding {
  const apis = loadRegistryApis(registry(auth));
  return { version: 1, target: { id: "actual-id", provider: "alicloud-express" }, apis,
    ...bindingOptions(apis, auth ? ["report.token=env:REPORT_API_TOKEN"] : [], ["totals=report:report_totals"]) };
}
function fakeSandbox(url: string, provider = "alicloud-express") {
  return { id: "actual-id", provider, close: vi.fn(), network: { resolveEndpoint: vi.fn().mockResolvedValue({
    provider_id: provider, sandbox_id: "actual-id", port: 9000, url, headers: { "x-traffic-token": "traffic-test" }, authentication_audience: "gateway", path_mode: "prefix" }) } } as unknown as Sandbox;
}
const invoke = ["sandbox", "actual-id", "totals", "--path", "report=daily", "--query", "enabled=false", "--body", '{"values":[1,2,3]}'];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "abx-api-test-")); fs.rmSync(path.join(paths.abxDir, "api-bindings"), { recursive: true, force: true }); resetCliSelection(); });
afterEach(() => { vi.restoreAllMocks(); resetCliSelection(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe("target-first API commands", () => {
  it.each(["python","node"])("generates a usable %s scaffold API contract", kind => {
    for (const [name, content] of renderScaffold(kind,"demo","alicloud-express")) fs.writeFileSync(path.join(tmp,name),content);
    const apis=loadRegistryApis(path.join(tmp,"registry.yaml"));
    expect(apis).toHaveLength(1); expect(apis[0].port).toBe(9000);
    expect(bindingOptions(apis,["app.token=config:server_token"],[]).credentials).toEqual({"app.token":"config:server_token"});
    const readme=fs.readFileSync(path.join(tmp,"README.md"),"utf8");
    expect(readme).toContain('abx sandbox demo hello --body \'{"name":"Ada"}\'');
    expect(readme).not.toContain("sandbox command");
  });

  it("shows offline target and operation help from the saved contract after source removal", async () => {
    saveApiBinding(binding(true)); fs.rmSync(tmp, { recursive: true, force: true });
    const connect = vi.spyOn(sandboxApiSeams, "connect").mockRejectedValue(new Error("no network"));
    const credential = vi.spyOn(sandboxApiSeams, "environment").mockImplementation(() => { throw new Error("no secret access"); });
    const configured = vi.spyOn(sandboxApiSeams, "applicationToken").mockImplementation(() => { throw new Error("no secret access"); });
    for (const args of [["sandbox", "actual-id", "--help"], ["sandbox", "actual-id", "totals", "--help"]]) {
      const result = await run(args); expect(result.exit_code, result.output).toBe(0); expect(result.stdout).toContain("report_totals");
    }
    expect(connect).not.toHaveBeenCalled(); expect(credential).not.toHaveBeenCalled(); expect(configured).not.toHaveBeenCalled();
  });
  it("validates unknown operations, request body and paths before connecting", async () => {
    saveApiBinding(binding()); const connect = vi.spyOn(sandboxApiSeams, "connect");
    for (const args of [["sandbox", "actual-id", "missing"], ["sandbox", "actual-id", "totals", "--path", "report=x", "--body", "{}"], [...invoke.slice(0, 3), "--path", "report=../other", "--body", '{"values":[]}']]) {
      expect((await run(args)).exit_code).not.toBe(0);
    }
    expect(connect).not.toHaveBeenCalled();
  });
  it("binds an existing target, stores no credential value, and accepts a file body", async () => {
    const file = registry(true), sb = fakeSandbox("http://127.0.0.1:1");
    vi.spyOn(sandboxApiSeams, "connect").mockResolvedValue(sb);
    const environment = vi.spyOn(sandboxApiSeams, "environment");
    const result = await run(["sandbox", "actual-id", "--bind", file, "--credential", "report.token=env:REPORT_API_TOKEN", "--alias", "totals=report:report_totals"]);
    expect(result.exit_code, result.output).toBe(0); expect(environment).not.toHaveBeenCalled();
    const saved = fs.readdirSync(path.join(paths.abxDir, "api-bindings")); expect(saved).toHaveLength(1);
    const cache = path.join(paths.abxDir, "api-bindings", saved[0]);
    if (process.platform !== "win32") expect(fs.statSync(cache).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(cache, "utf8")).toContain("env:REPORT_API_TOKEN");
  });
  it("requires a live matching named deployment and never silently reuses a rebuilt name", async () => {
    const value = binding(); value.deployment = { name: "report-demo", createdAt: "2026-01-01T00:00:00Z" };
    saveApiBinding(value);
    const deployment = { version: 1 as const, name: "report-demo", kind: "sandbox" as const, provider: "alicloud-express", sandboxId: "actual-id", createdAt: value.deployment.createdAt, updatedAt: value.deployment.createdAt, status: "ready" as const };
    saveDeployment(deployment);
    expect((await run(["sandbox", "report-demo", "--help"])).exit_code).toBe(0);
    saveDeployment({ ...deployment, status: "deleted" });
    const connect = vi.spyOn(sandboxApiSeams, "connect");
    expect((await run(["sandbox", "report-demo", ...invoke.slice(2)])).exit_code).not.toBe(0);
    saveDeployment({ ...deployment, sandboxId: "new-id" });
    expect((await run(["sandbox", "report-demo", "--help"])).exit_code).not.toBe(0);
    expect(connect).not.toHaveBeenCalled();
  });
  it("rejects a mismatched endpoint before reading application credentials", async () => {
    saveApiBinding(binding(true)); const sb = fakeSandbox("http://127.0.0.1:1");
    vi.mocked(sb.network.resolveEndpoint).mockResolvedValue({ provider_id: "other", sandbox_id: "actual-id", port: 9000, url: "http://127.0.0.1:1", headers: {}, authentication_audience: "gateway", path_mode: "prefix" });
    vi.spyOn(sandboxApiSeams, "connect").mockResolvedValue(sb); const credential = vi.spyOn(sandboxApiSeams, "environment");
    const result = await run(invoke); expect(result.exit_code).not.toBe(0); expect(credential).not.toHaveBeenCalled(); expect(sb.close).toHaveBeenCalledOnce();
  });
  it("invokes real HTTP directly with traffic and explicit application auth, with no discovery or retries", async () => {
    saveApiBinding(binding(true)); const received: Array<{ url?: string; auth?: string; traffic?: string; body: string }> = [];
    const server = http.createServer(async (req, res) => {
      let body = ""; for await (const part of req) body += part;
      received.push({ url: req.url, auth: req.headers.authorization, traffic: String(req.headers["x-traffic-token"]), body });
      res.setHeader("content-type", "application/json");
      if (received.length === 1) res.end(JSON.stringify({ total: 6 })); else { res.statusCode = 401; res.end(JSON.stringify({ error: "denied" })); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number };
      vi.spyOn(sandboxApiSeams, "connect").mockResolvedValue(fakeSandbox(`http://127.0.0.1:${address.port}/bound/id`));
      vi.spyOn(sandboxApiSeams, "environment").mockReturnValue("application-test");
      fs.writeFileSync(path.join(tmp, "request.json"), '{"values":[1,2,3]}');
      const success = await run([...invoke.slice(0, -1), `@${path.join(tmp, "request.json")}`]);
      expect(success.exit_code, success.output).toBe(0); expect(JSON.parse(success.stdout)).toEqual({ status: 200, body: { total: 6 } });
      const failed = await run(invoke); expect(failed.exit_code).toBe(1); expect(JSON.parse(failed.stdout).status).toBe(401);
      expect(received).toHaveLength(2); expect(received[0]).toEqual({ url: "/bound/id/totals/daily?enabled=false", auth: "Bearer application-test", traffic: "traffic-test", body: '{"values":[1,2,3]}' });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("accepts a Provider-qualified ID for offline help and binding", async () => {
    saveApiBinding(binding()); const connect = vi.spyOn(sandboxApiSeams, "connect").mockResolvedValue(fakeSandbox("https://example.test"));
    const help = await run(["sandbox", "alicloud-express:actual-id", "--help"]);
    expect(help.exit_code, help.output).toBe(0); expect(connect).not.toHaveBeenCalled();
    const result = await run(["sandbox", "alicloud-express:actual-id", "--bind", registry()]);
    expect(result.exit_code, result.output).toBe(0); expect(connect).toHaveBeenCalledWith("actual-id", {provider:"alicloud-express"});
  });
  it("preserves deployment association when the exact bound raw ID is rebound", async () => {
    const value = binding(); value.deployment = {name:"report-demo",createdAt:"2026-01-01T00:00:00Z"};
    saveDeployment({version:1,name:"report-demo",kind:"sandbox",provider:"alicloud-express",sandboxId:"actual-id",createdAt:value.deployment.createdAt,updatedAt:value.deployment.createdAt,status:"ready"});
    saveApiBinding(value); saveApiBinding({...value,deployment:undefined});
    expect((await run(["sandbox","report-demo","--help"])).exit_code).toBe(0);
  });
  it("rejects aliases shadowing operation IDs declared through Path Item references", () => {
    const value = binding(); const api = value.apis[0]; const pathItem = (api.document.paths as Record<string,unknown>)["/totals/{report}"];
    api.document.components = {pathItems:{report:pathItem}}; api.document.paths = {"/totals/{report}":{$ref:"#/components/pathItems/report"}};
    expect(()=>bindingOptions(value.apis,[],["report_totals=report:report_totals"])).toThrow("shadow");
  });
  it("rejects redirects without following them", async () => {
    saveApiBinding(binding()); vi.spyOn(sandboxApiSeams, "connect").mockResolvedValue(fakeSandbox("https://example.test"));
    const fetch = vi.spyOn(openApiHttpSeams, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://elsewhere.test" } }));
    expect((await run(invoke)).exit_code).not.toBe(0); expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1]?.redirect).toBe("manual");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../../src/application/config.js";
import { apiSecuritySchemes, describeApiOperation, describeApiOperations, loadRegistryApis,
  prepareApiOperation, selectApiOperation, type ApiContract } from "../../src/cli/api_contract.js";

type Obj = Record<string, any>;
const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function directory(): string { const dir = mkdtempSync(join(tmpdir(), "abx-api-contract-")); directories.push(dir); return dir; }
function document(operation: Obj = {}): Obj {
  return { openapi: "3.1.0", info: { title: "Reports", version: "1" },
    paths: { "/reports/{id}": { post: { operationId: "report_totals", summary: "Calculate totals",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "integer", minimum: 0 } },
        { in: "query", name: "verbose", schema: { type: "boolean" } },
        { in: "header", name: "X-Request-Label", schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false,
        properties: { values: { type: "array", items: { type: "number" } } }, required: ["values"] } } } },
      responses: { "200": { description: "Totals", content: { "application/json": { example: { total: 42 } } } } }, ...operation } } } };
}
function imported(doc: Obj = document()): ApiContract[] {
  const dir = directory();
  writeFileSync(join(dir, "openapi.json"), JSON.stringify(doc));
  writeFileSync(join(dir, "registry.yaml"), "specVersion: 1\napis:\n  reports:\n    resource: sandbox.report\n    port: 9000\n    openapi: ./openapi.json\n");
  return loadRegistryApis(join(dir, "registry.yaml"));
}
function selected(doc?: Obj) { return selectApiOperation(imported(doc), "report_totals"); }
const input = () => ({ path: ["id=0"], query: ["verbose=false"], header: ["X-Request-Label="], body: { values: [1, 2, 3] } });

describe("fixed local OpenAPI contracts", () => {
  it("imports a local contract, hashes canonical content and keeps cached help offline", () => {
    const api = imported()[0];
    expect(api.digest).toBe(digest(api.document));
    rmSync(directories[0], { recursive: true, force: true });
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("help made a request"));
    expect(describeApiOperations([api])[0]).toMatchObject({ api: "reports", operationId: "report_totals", method: "POST" });
    const help = describeApiOperation(selectApiOperation([api], "report_totals"));
    expect(help["responses"]).toEqual(document()["paths"]["/reports/{id}"].post.responses);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("includes cached reusable inputs and responses in offline operation help", () => {
    const doc = document();
    doc.components = {
      requestBodies: { ReportInput: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Report" } } } } },
      schemas: { Report: { type: "object", required: ["values"], properties: { values: { type: "array", items: { type: "number" } } } },
        Totals: { type: "object", properties: { total: { type: "number" } } } },
      responses: { Totals: { description: "Calculated total", content: { "application/json": { schema: { $ref: "#/components/schemas/Totals" }, example: { total: 42 } } } } },
    };
    doc.paths["/reports/{id}"].post.requestBody = { $ref: "#/components/requestBodies/ReportInput" };
    doc.paths["/reports/{id}"].post.responses = { "200": { $ref: "#/components/responses/Totals" } };
    const current = selected(doc);
    rmSync(directories[0], { recursive: true, force: true });
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("help must remain offline"));
    const help = describeApiOperation(current);
    expect(help["openapi"]).toBe("3.1.0");
    expect(help["components"]).toEqual(doc.components);
    expect(help["requestBody"]).toEqual({ $ref: "#/components/requestBodies/ReportInput" });
    expect(help["responses"]).toEqual({ "200": { $ref: "#/components/responses/Totals" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires API selection for duplicate operation IDs across APIs", () => {
    const api = imported()[0]; const second = { ...api, name: "other" };
    expect(() => selectApiOperation([api, second], "report_totals")).toThrow(/--api/);
    expect(selectApiOperation([api, second], "report_totals", "other").api.name).toBe("other");
    expect(() => selectApiOperation([api], "exec")).toThrow(/Unknown API operation/);
  });

  it("rejects duplicate YAML keys and aliases", () => {
    const dir = directory();
    writeFileSync(join(dir, "registry.yaml"), "apis: {}\napis: {}\n");
    expect(() => loadRegistryApis(join(dir, "registry.yaml"))).toThrow(/YAML/);
    writeFileSync(join(dir, "registry.yaml"), "x: &a {}\napis: *a\n");
    expect(() => loadRegistryApis(join(dir, "registry.yaml"))).toThrow(/aliases/);
  });

  it("rejects duplicate IDs, unsupported versions and recursive schemas", () => {
    const doc = document(); doc.paths["/other"] = { get: { operationId: "report_totals" } };
    expect(() => imported(doc)).toThrow(/unique/);
    expect(() => imported({ ...document(), openapi: "3.0.3" })).toThrow(/3.1/);
    const recursive = document(); recursive.components = { schemas: { Node: { properties: { child: { $ref: "#/components/schemas/Node" } } } } };
    expect(() => imported(recursive)).toThrow(/Recursive/);
  });

  it("rejects package escapes, including symlinks, and external references", () => {
    const dir = directory(), outside = directory();
    writeFileSync(join(outside, "api.json"), JSON.stringify(document()));
    symlinkSync(join(outside, "api.json"), join(dir, "api.json"));
    writeFileSync(join(dir, "registry.yaml"), "apis:\n  reports: {resource: sandbox.report, port: 9000, openapi: ./api.json}\n");
    expect(() => loadRegistryApis(join(dir, "registry.yaml"))).toThrow(/escapes/);
    const doc = document(); doc.components = { schemas: { Foreign: { $ref: "https://invalid.example/schema" } } };
    expect(() => imported(doc)).toThrow(/internal/);
  });

  it("resolves internal input and authentication references without losing sibling constraints", () => {
    const doc = document();
    doc.security = [{ Token: [] }];
    doc.components = { securitySchemes: { Token: { $ref: "#/components/securitySchemes/Bearer" }, Bearer: { type: "http", scheme: "bearer" } },
      schemas: { Values: { type: "array", items: { type: "number" } } } };
    doc.paths["/reports/{id}"].post.requestBody.content["application/json"].schema = { $ref: "#/components/schemas/Values", minItems: 2 };
    const current = selected(doc);
    expect(apiSecuritySchemes(current.api).Token).toMatchObject({ type: "http", scheme: "bearer" });
    expect(prepareApiOperation(current, { path: ["id=1"], body: [1, 2] }).body).toEqual([1, 2]);
    expect(() => prepareApiOperation(current, { path: ["id=1"], body: [1] })).toThrow(/minItems/);
  });

  it("rejects invocation extensions while retaining literal JSON example and property names", () => {
    expect(() => imported(document({ "x-abx-source": { env: "TOKEN" } }))).toThrow(/x-abx/);
    const doc = document();
    doc.paths["/reports/{id}"].post.requestBody.content["application/json"].schema = { type: "object", properties: { "x-abx-data": { type: "string" } }, example: { $ref: "literal" } };
    expect(imported(doc)).toHaveLength(1);
  });
});

describe("preparing operations before any effects", () => {
  it("preserves false, zero, empty strings and validates JSON bodies", () => {
    const request = prepareApiOperation(selected(), input());
    expect(request).toMatchObject({ method: "POST", path: "/reports/0", query: [["verbose", "false"]], headers: { "X-Request-Label": "" }, body: { values: [1, 2, 3] }, security: [] });
    expect(() => prepareApiOperation(selected(), { ...input(), body: { values: ["1"] } })).toThrow(/type/);
    expect(() => prepareApiOperation(selected(), { ...input(), body: { values: [], unknown: true } })).toThrow(/additionalProperties/);
  });

  it.each([false, 0, [], null])("accepts an explicitly supplied JSON root %j", body => {
    const doc = document(); doc.paths["/reports/{id}"].post.requestBody.content["application/json"].schema = true;
    expect(prepareApiOperation(selected(doc), { path: ["id=1"], body }).body).toEqual(body);
  });

  it("does not treat examples or defaults as provided input", () => {
    const doc = document(); doc.paths["/reports/{id}"].post.parameters[0].schema.default = 42;
    expect(() => prepareApiOperation(selected(doc), { body: { values: [] } })).toThrow(/Missing required path/);
    expect(() => prepareApiOperation(selected(), { path: ["id=1"] })).toThrow(/requires --body/);
  });

  it("rejects missing, unknown, duplicate and invalid scalar arguments", () => {
    expect(() => prepareApiOperation(selected(), { ...input(), query: ["verbose=1"] })).toThrow(/true or false/);
    expect(() => prepareApiOperation(selected(), { ...input(), query: ["other=1"] })).toThrow(/not declared/);
    expect(() => prepareApiOperation(selected(), { ...input(), query: ["verbose=true", "verbose=false"] })).toThrow(/Duplicate/);
    expect(() => prepareApiOperation(selected(), { ...input(), path: ["id=1.5"] })).toThrow(/type/);
    expect(() => prepareApiOperation(selected(), { ...input(), path: ["id=1e999"] })).toThrow(/finite/);
  });

  it.each(["..", ".", "a/b", "a\\b", "%2e%2e", ""]) ("rejects unsafe path value %j", value => {
    const doc = document(); doc.paths["/reports/{id}"].post.parameters[0].schema = { type: "string" };
    expect(() => prepareApiOperation(selected(doc), { ...input(), path: [`id=${value}`] })).toThrow(/escapes/);
  });

  it("ignores advertised servers and rejects static path traversal", () => {
    const doc = document(); doc.servers = [{ url: "https://invalid.example/steal" }];
    expect(prepareApiOperation(selected(doc), input()).path).toBe("/reports/0");
    doc.paths["/../reports/{id}"] = doc.paths["/reports/{id}"]; delete doc.paths["/reports/{id}"];
    expect(() => prepareApiOperation(selected(doc), input())).toThrow(/escapes/);
  });

  it("rejects unsupported serialization, formats and ordinary auth headers", () => {
    for (const param of [
      { name: "rows", in: "query", schema: { type: "array", items: { type: "string" } } },
      { name: "date", in: "query", schema: { type: "string", format: "date-time" } },
      { name: "Authorization", in: "header", schema: { type: "string" } },
      { name: "query", in: "query", style: "deepObject", schema: { type: "string" } },
    ]) {
      const doc = document(); doc.paths["/reports/{id}"].post.parameters.push(param);
      expect(() => prepareApiOperation(selected(doc), input())).toThrow();
    }
    expect(() => prepareApiOperation(selected(), { ...input(), header: ["X-Request-Label=hello\r\nAuthorization: bad"] })).toThrow(/control/);
  });

  it("rejects invalid serialization flag types instead of ignoring them", () => {
    const doc = document(); doc.paths["/reports/{id}"].post.parameters[1].explode = "true";
    expect(() => prepareApiOperation(selected(doc), input())).toThrow(/must be boolean/);
    const body = document(); body.paths["/reports/{id}"].post.requestBody.required = "true";
    expect(() => prepareApiOperation(selected(body), input())).toThrow(/must be boolean/);
  });

  it("checks unsupported optional schemas even when the body is omitted", () => {
    const doc = document(); const body = doc.paths["/reports/{id}"].post.requestBody; body.required = false;
    body.content["application/json"].schema = { type: "string", unknownValidationKeyword: 1 };
    expect(() => prepareApiOperation(selected(doc), { path: ["id=1"] })).toThrow(/unsupported JSON Schema/);
  });

  it("preserves explicit security choices and validates supported schemes", () => {
    const doc = document(); doc.security = [{ Token: [] }, {}]; doc.components = { securitySchemes: { Token: { type: "http", scheme: "bearer" } } };
    expect(prepareApiOperation(selected(doc), input()).security).toEqual([{ Token: [] }, {}]);
    doc.paths["/reports/{id}"].post.security = [];
    expect(prepareApiOperation(selected(doc), input())).toMatchObject({ security: [], schemes: {} });
    doc.paths["/reports/{id}"].post.security = null;
    expect(() => prepareApiOperation(selected(doc), input())).toThrow(/security must be an array/);
  });

  it("rejects conflicting or unsupported auth without obtaining credentials", () => {
    const doc = document(); doc.security = [{ Token: [], Other: [] }];
    doc.components = { securitySchemes: { Token: { type: "http", scheme: "bearer" }, Other: { type: "http", scheme: "bearer" } } };
    expect(() => prepareApiOperation(selected(doc), input())).toThrow(/same request header/);
    doc.security = [{ Other: [] }]; doc.components.securitySchemes.Other = { type: "oauth2", flows: {} };
    expect(() => prepareApiOperation(selected(doc), input())).toThrow(/bearer and header apiKey/);
    doc.components.securitySchemes.Other = { type: "apiKey", in: "header", name: "X-API-Key" };
    expect(prepareApiOperation(selected(doc), input()).schemes.Other).toMatchObject({ type: "apiKey", name: "X-API-Key" });
  });
});

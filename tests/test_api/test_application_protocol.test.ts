/** Real HTTP requests through the project client's bound application protocol. */
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {describe, expect, it} from "vitest";
import {Sandbox} from "../../src/api/sandbox.js";
import {TransportConfig} from "../../src/transport/config.js";
import type {ApplicationEndpoint} from "../../src/protocol/port_contract.js";

const capabilities = {api_version: 2, endpoints: {list_commands: {enabled: false, allowed: false}, run_command: {enabled: true, allowed: true}}};

describe("application protocol over real HTTP", () => {
  it.each(["invalid", "denied", "valid"])("checks %s discovery before transmitting any command payload", async scenario => {
    const requests: Array<{path: string; method: string; body: string; authorization?: string}> = [];
    const prefix = "/sandboxes/owned/ports/9000";
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += String(chunk);
      requests.push({path: req.url ?? "", method: req.method ?? "", body, authorization: req.headers.authorization});
      res.writeHead(200, {"Content-Type": "application/json"});
      if (req.url === `${prefix}/capabilities?signature=opaque%25value`) {
        res.end(scenario === "invalid" ? "not-json" : JSON.stringify(scenario === "denied" ? {api_version: 2, endpoints: {run_command: {enabled: true, allowed: false}}} : capabilities));
      } else res.end(JSON.stringify({result: 42}));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const endpoint: ApplicationEndpoint = {provider_id: "review", sandbox_id: "owned", port: 9000,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}?signature=opaque%25value`, headers: {}, authentication_audience: "gateway", path_mode: "prefix"};
      const sandbox = Object.create(Sandbox.prototype) as Sandbox;
      sandbox._config = new TransportConfig();
      Object.defineProperty(sandbox, "network", {value: {resolveEndpoint: async () => endpoint}});
      if (scenario === "valid") {
        expect((await sandbox.runCommand("add", {x: 20, y: 22}, {application_token: "application-only"})).value).toBe(42);
        expect(requests.map(request => request.method)).toEqual(["GET", "POST"]);
        expect(requests[1]).toMatchObject({path: `${prefix}/commands/add?signature=opaque%25value`, body: '{"x":20,"y":22}'});
      } else {
        await expect(sandbox.runCommand("mutate", {payload: "never-send"}, {application_token: "application-only"})).rejects.toThrow();
        expect(requests.map(request => request.method)).toEqual(["GET"]);
        expect(requests[0].body).toBe("");
      }
      expect(requests.every(request => request.authorization === "Bearer application-only")).toBe(true);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});

it("probes a health-only real HTTP application without named-command permissions", async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? ""); res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify(req.url === "/capabilities" ? {api_version: 2, endpoints: {health: {enabled: true, allowed: true}}} : {status: "ok"}));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const endpoint: ApplicationEndpoint = {provider_id: "review", sandbox_id: "owned", port: 9000, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, headers: {}, authentication_audience: "gateway", path_mode: "prefix"};
    const sandbox = Object.create(Sandbox.prototype) as Sandbox;
    sandbox._config = new TransportConfig();
    Object.defineProperty(sandbox, "network", {value: {resolveEndpoint: async () => endpoint}});
    await sandbox.verifyApplicationOperation("health"); expect(paths).toEqual(["/capabilities", "/health"]);
  } finally {await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}
});

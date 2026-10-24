import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {afterEach, expect, it, vi} from "vitest";
import {Sandbox} from "../../src/api/sandbox.js";
import {TransportConfig} from "../../src/transport/config.js";
import type {ApplicationEndpoint} from "../../src/protocol/port_contract.js";

afterEach(() => vi.restoreAllMocks());

async function application(timeout: number | undefined, delay = 0) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const reply = () => {
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify(req.url === "/capabilities" ? {
        api_version: 2, endpoints: Object.fromEntries(["run_command", "list_commands", "health"].map(name => [name, {enabled: true, allowed: true}])),
      } : req.url === "/commands" ? {commands: []} : req.url === "/health" ? {status: "ok"} : {result: 42}));
    };
    if (req.method === "POST") {
      const timer = setTimeout(reply, delay);
      res.once("close", () => clearTimeout(timer));
    } else reply();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint: ApplicationEndpoint = {provider_id: "review", sandbox_id: "owned", port: 9000,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, headers: {}, authentication_audience: "gateway", path_mode: "prefix"};
  const sandbox = Object.create(Sandbox.prototype) as Sandbox;
  sandbox._config = new TransportConfig(timeout === undefined ? {} : {http_timeout: timeout});
  Object.defineProperty(sandbox, "network", {value: {resolveEndpoint: async () => endpoint}});
  return {sandbox, requests, close: async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }};
}

it.each([undefined, 330, 1.001, 1.0001])("uses the configured deadline %s for discovery, commands, listing and health", async timeout => {
  const service = await application(timeout);
  const deadlines = vi.spyOn(AbortSignal, "timeout");
  try {
    expect((await service.sandbox.runCommand("slow", {}, {application_token: "example-token"})).value).toBe(42);
    expect(await service.sandbox.listCommands({application_token: "example-token"})).toEqual([]);
    await service.sandbox.verifyApplicationOperation("health", {application_token: "example-token"});
    expect(deadlines.mock.calls.map(([milliseconds]) => milliseconds)).toEqual(Array(6).fill(Math.ceil((timeout ?? 30) * 1000)));
  } finally {await service.close();}
});

it.each([1, 3])("honors a %ss deadline over real HTTP without replaying a command", async timeout => {
  const service = await application(timeout, 1500);
  try {
    const request = service.sandbox.runCommand("slow", {}, {application_token: "example-token"});
    if (timeout === 1) await expect(request).rejects.toThrow("Application request failed");
    else expect((await request).value).toBe(42);
    expect(service.requests).toEqual(["GET /capabilities", "POST /commands/slow"]);
  } finally {await service.close();}
});

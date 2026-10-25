/** Negative command budgets fail at the command layer before Start; negative HTTP timeouts remain ConnectTimeout. */

import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommandsModule } from "../../src/api/commands.js";
import { dispatchTool } from "../../src/agent/tools.js";
import type { SandboxManager } from "../../src/agent/mcp.js";
import { ProcessProtocol } from "../../src/providers/shared/e2b/process.js";
import { EnvdTokenManager } from "../../src/providers/alicloud_express/auth.js";
import { TransportConfig } from "../../src/transport/config.js";
import { HttpClient } from "../../src/transport/http.js";
import { AsyncClient, ConnectTimeout, Timeout } from "../../src/transport/_httpx.js";

let server: http.Server;
let base = "";
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/connect+json" });
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function toolManager(): SandboxManager {
  const config = new TransportConfig({ api_url: base, http2: false });
  const httpClient = new HttpClient(config, { getHeaders: async () => ({}), refresh: async () => {} });
  const commands = new CommandsModule(base, new EnvdTokenManager("tok", "sbx"), new ProcessProtocol(httpClient));
  return { getSandbox: async () => ({ commands }) } as unknown as SandboxManager;
}

describe("AT-12 negative timeout", () => {
  it("negative command budgets are typed E3001 and negative HTTP timeouts remain ConnectTimeout, with nothing sent", async () => {
    const manager = toolManager();
    const before = hits.length;
    const first = await dispatchTool("run_command", { command: "ls", timeout: -5 }, manager);
    const second = await dispatchTool("run_command", { command: "ls", timeout: -5 }, manager);
    expect(first.error).toContain("[E3001] Command timed out");
    expect(first.error).toContain("within -5s");
    expect(second).toEqual(first);
    expect(hits.length).toBe(before);

    const client = new AsyncClient({ timeout: new Timeout(-1), trust_env: false });
    const seen = hits.length;
    for (let i = 0; i < 2; i++) {
      const failure = await client.post(`${base}/x`, { content: Buffer.from("hi") }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(ConnectTimeout);
      expect((failure as Error).message).toBe("");
      expect((failure as Error).constructor.name).toBe("ConnectTimeout");
    }
    await client.aclose();
    expect(hits.length).toBe(seen);
  });
});

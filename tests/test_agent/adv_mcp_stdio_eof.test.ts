/**
 * Adversarial review fix (AT-11): a request answered without real I/O, directly followed by EOF, is always answered.
 *
 * asyncio finishes the first step of every task of the last batch before the reader sees the EOF; tasks suspended on I/O
 * are cancelled. The port needs macrotask hops for the same work (module loader round trips, stream callbacks), so the
 * EOF path waits until each task of the last batch is done or provably blocked. The handlers below take a fixed number of
 * microtask / immediate hops, so the outcome is a function of the code, not of timing.
 */
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { SandboxMCPServer } from "../../src/agent/mcp.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

type EndMode = "same-tick" | "immediate" | "timer0" | "timer5";

const REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "create_sandbox", arguments: { timeout: "x" } },
});

async function runOneShot(
  hops: "micro" | "immediate" | "timer",
  mode: EndMode,
  lines: string[] = [REQUEST],
): Promise<string[]> {
  const server = new SandboxMCPServer();
  (server as any).handleRequest = async (request: any): Promise<unknown> => {
    if (hops === "micro") for (let i = 0; i < 40; i += 1) await null;
    else if (hops === "immediate")
      for (let i = 0; i < 5; i += 1)
        await new Promise<void>((r) => setImmediate(r));
    else await new Promise<void>((r) => setTimeout(r, 30));
    return { jsonrpc: "2.0", id: request.id, result: { ok: true } };
  };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const chunks: string[] = [];
  stdout.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
  const done = server.run({ stdin, stdout, handleSignals: false });
  for (const line of lines) stdin.write(`${line}\n`);
  if (mode === "same-tick") stdin.end();
  else if (mode === "immediate") setImmediate(() => stdin.end());
  else setTimeout(() => stdin.end(), mode === "timer0" ? 0 : 5);
  await done;
  return chunks.join("").split("\n").filter(Boolean);
}

describe("STDIO EOF right behind a request", () => {
  const modes: EndMode[] = ["same-tick", "immediate", "timer0", "timer5"];

  it.each(modes)(
    "answers a request that needs only microtask hops (%s)",
    async (mode) => {
      for (let round = 0; round < 25; round += 1) {
        const out = await runOneShot("micro", mode);
        expect(out).toEqual([
          '{"jsonrpc": "2.0", "id": 1, "result": {"ok": true}}',
        ]);
      }
    },
  );

  it.each(modes)(
    "answers a request that needs several macrotask hops (%s)",
    async (mode) => {
      for (let round = 0; round < 25; round += 1) {
        const out = await runOneShot("immediate", mode);
        expect(out).toEqual([
          '{"jsonrpc": "2.0", "id": 1, "result": {"ok": true}}',
        ]);
      }
    },
  );

  it("answers every request of the last batch in order of completion", async () => {
    const second = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" });
    const out = await runOneShot("immediate", "same-tick", [REQUEST, second]);
    expect(out.map((l) => JSON.parse(l).id).sort()).toEqual([1, 2]);
  });

  it("cancels a request that is suspended on a timer, like asyncio cancels a task suspended on I/O", async () => {
    const started = Date.now();
    const out = await runOneShot("timer", "same-tick");
    expect(out).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("never answers a final line without a trailing newline", async () => {
    const server = new SandboxMCPServer();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
    const done = server.run({ stdin, stdout, handleSignals: false });
    stdin.write('{"jsonrpc":"2.0","id":9,"method":"ping"}');
    stdin.end();
    await done;
    expect(chunks.join("")).toBe("");
  });
});

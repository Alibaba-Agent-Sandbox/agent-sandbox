/**
 * In-process checks of the STDIO read/write loop (`SandboxMCPServer.run`):
 * framing, parse errors, the size limit, shutdown and cancellation. The
 * process-level behaviour is covered by test_mcp_stdio.test.ts.
 */

import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { SandboxMCPServer, StdioLineSplitter, _STDIO_READ_LIMIT } from "../../src/agent/mcp.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function harness(server: SandboxMCPServer) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const chunks: string[] = [];
  stdout.on("data", (c: Buffer) => chunks.push(c.toString("utf-8")));
  const done = server.run({ stdin, stdout, handleSignals: false });
  const lines = (): string[] => chunks.join("").split("\n").filter(Boolean);
  const waitFor = async (count: number, ms = 3000): Promise<string[]> => {
    const deadline = Date.now() + ms;
    while (lines().length < count && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return lines();
  };
  return { stdin, done, lines, waitFor };
}

describe("TestStdioLoop", () => {
  it("writes responses with Python json.dumps separators", async () => {
    const h = harness(new SandboxMCPServer());
    h.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(await h.waitFor(1)).toEqual(['{"jsonrpc": "2.0", "id": 1, "result": {}}']);
    h.stdin.end();
    await h.done;
  });

  it("answers invalid JSON with the CPython parse error text and keeps serving", async () => {
    const h = harness(new SandboxMCPServer());
    h.stdin.write("not json\n\n   \n");
    h.stdin.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    const lines = await h.waitFor(2);
    expect(lines[0]).toBe(
      '{"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "Parse error: Expecting value: line 1 column 1 (char 0)"}}',
    );
    expect(lines[1]).toBe('{"jsonrpc": "2.0", "id": 2, "result": {}}');
    h.stdin.end();
    await h.done;
  });

  it("rejects non-object messages with INVALID_REQUEST", async () => {
    const h = harness(new SandboxMCPServer());
    h.stdin.write('[{"jsonrpc":"2.0","id":1,"method":"ping"}]\n');
    expect(await h.waitFor(1)).toEqual([
      '{"jsonrpc": "2.0", "id": null, "error": {"code": -32600, "message": "Request must be a JSON object"}}',
    ]);
    h.stdin.end();
    await h.done;
  });

  it("rejects an overlong line and serves the next message", async () => {
    const h = harness(new SandboxMCPServer());
    h.stdin.write(`${"x".repeat(_STDIO_READ_LIMIT + 10)}\n`);
    h.stdin.write('{"jsonrpc":"2.0","id":3,"method":"ping"}\n');
    const lines = await h.waitFor(2);
    expect(lines[0]).toBe(
      '{"jsonrpc": "2.0", "id": null, "error": {"code": -32600, "message": "Message exceeds the STDIO size limit"}}',
    );
    expect(lines[1]).toBe('{"jsonrpc": "2.0", "id": 3, "result": {}}');
    h.stdin.end();
    await h.done;
  });

  it("never answers a final message that has no trailing newline (asyncio cancels it at EOF)", async () => {
    const h = harness(new SandboxMCPServer());
    h.stdin.write('{"jsonrpc":"2.0","id":4,"method":"ping"}\n{"jsonrpc":"2.0","id":5,"method":"ping"}');
    await new Promise((r) => setTimeout(r, 20));
    h.stdin.end();
    await h.done;
    expect(h.lines()).toEqual(['{"jsonrpc": "2.0", "id": 4, "result": {}}']);
  });

  it("answers a parse error of the unterminated final line", async () => {
    const h = harness(new SandboxMCPServer());
    h.stdin.write("{");
    await new Promise((r) => setTimeout(r, 20));
    h.stdin.end();
    await h.done;
    expect(h.lines()).toEqual([
      '{"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "Parse error: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"}}',
    ]);
  });

  it("writes protocol errors of a multi-line chunk before the answers of the valid lines (asyncio task order)", async () => {
    const h = harness(new SandboxMCPServer());
    h.stdin.write(
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\nnot json\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n[]\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nope","arguments":{}}}\n{"jsonrpc":"2.0","id":4,"method":"ping"}\n',
    );
    const lines = await h.waitFor(6);
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([null, 1, 2, null, 3, 4]);
    expect(JSON.parse(lines[0]!).error.code).toBe(-32700);
    expect(JSON.parse(lines[3]!).error.code).toBe(-32600);
    h.stdin.end();
    await h.done;
  });

  it("emits non-ASCII ids and results unescaped", async () => {
    const h = harness(new SandboxMCPServer());
    h.stdin.write('{"jsonrpc":"2.0","id":"é日本","method":"ping"}\n');
    expect(await h.waitFor(1)).toEqual(['{"jsonrpc": "2.0", "id": "é日本", "result": {}}']);
    h.stdin.end();
    await h.done;
  });

  it("kills the session's sandboxes when stdin closes", async () => {
    const server = new SandboxMCPServer();
    const sandbox = { id: "sb-1", kill: vi.fn(async () => undefined) };
    server._manager._sandboxes.set("sb-1", sandbox);
    const h = harness(server);
    h.stdin.end();
    await h.done;
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
    expect(server._manager._sandboxes.size).toBe(0);
  });

  it("stops on request, abandons in-flight tool calls without a response and cleans up", async () => {
    const server = new SandboxMCPServer();
    const sandbox: any = { id: "sb-1", kill: vi.fn(async () => undefined) };
    server._manager._sandboxes.set("sb-1", sandbox);
    let release!: () => void;
    server._manager.getSandbox = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ runCode: async () => ({ stdout: "", stderr: "", exit_code: 0, output_files: [] }) });
        }),
    );
    const h = harness(server);
    h.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run_code","arguments":{"code":"1"}}}\n');
    h.stdin.write('{"jsonrpc":"2.0","id":3,"method":"ping"}\n');
    expect(await h.waitFor(1)).toEqual(['{"jsonrpc": "2.0", "id": 3, "result": {}}']);
    server.requestStop();
    await h.done;
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.lines()).toEqual(['{"jsonrpc": "2.0", "id": 3, "result": {}}']);
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
  });

  it("serialises tools/call but not other methods", async () => {
    const server = new SandboxMCPServer();
    const order: string[] = [];
    const gates: Array<() => void> = [];
    server._manager.getSandbox = vi.fn(async () => ({
      runCode: (code: string) =>
        new Promise((resolve) => {
          order.push(`start:${code}`);
          gates.push(() => {
            order.push(`end:${code}`);
            resolve({ stdout: code, stderr: "", exit_code: 0, output_files: [] });
          });
        }),
    }));
    const h = harness(server);
    for (const [id, code] of [
      [1, "a"],
      [2, "b"],
    ] as const) {
      h.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "run_code", arguments: { code } } })}\n`,
      );
    }
    const deadline = Date.now() + 5000;
    while (order.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(order).toEqual(["start:a"]);
    gates[0]!();
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(["start:a", "end:a", "start:b"]);
    gates[1]!();
    const lines = await h.waitFor(2);
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([1, 2]);
    h.stdin.end();
    await h.done;
  });
});

describe("TestStdioLineSplitter", () => {
  it("splits lines across chunks and flushes the tail at EOF", () => {
    const s = new StdioLineSplitter();
    expect(s.push(Buffer.from("ab"))).toEqual([]);
    const frames = s.push(Buffer.from("c\nde\nf"));
    expect(frames.map((f) => (f.kind === "line" ? f.data.toString() : f.kind))).toEqual(["abc", "de"]);
    expect(s.end().map((f) => (f.kind === "line" ? f.data.toString() : f.kind))).toEqual(["f"]);
  });

  it("treats a line of exactly the limit as valid and one byte more as overlong", () => {
    const ok = new StdioLineSplitter(4).push(Buffer.from("abcd\n"));
    expect(ok.map((f) => f.kind)).toEqual(["line"]);
    const bad = new StdioLineSplitter(4).push(Buffer.from("abcde\nx\n"));
    expect(bad.map((f) => f.kind)).toEqual(["overlong", "line"]);
  });

  it("drops an oversized line that has no newline yet and keeps the following bytes", () => {
    const s = new StdioLineSplitter(4);
    expect(s.push(Buffer.from("abcdef"))).toEqual([]);
    expect(s.push(Buffer.from("gh"))).toEqual([]);
    const frames = s.push(Buffer.from("i\nok\n"));
    expect(frames.map((f) => (f.kind === "line" ? f.data.toString() : f.kind))).toEqual(["overlong", "ok"]);
  });
});

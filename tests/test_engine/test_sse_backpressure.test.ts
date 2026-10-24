import { EventEmitter } from "node:events";
import http, { type ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { streamSse } from "../../src/engine/sse.js";

class Response extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writeHead = vi.fn();
  write = vi.fn(() => false);
  end = vi.fn(() => { this.writableEnded = true; });
}
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function source() {
  const iterator = {
    next: vi.fn(async () => ({ value: "event", done: false })),
    return: vi.fn(async () => ({ value: undefined, done: true })),
  };
  return { iterator, stream: { [Symbol.asyncIterator]: () => iterator } };
}

describe("SSE backpressure", () => {
  it("does not pull another provider event until drain, and releases on close", async () => {
    const res = new Response();
    const { iterator, stream } = source();
    const running = streamSse(res as unknown as ServerResponse, stream, value => value, String);
    await tick();
    expect(iterator.next).toHaveBeenCalledTimes(1);
    await tick();
    expect(iterator.next).toHaveBeenCalledTimes(1);
    res.emit("drain");
    await tick();
    expect(iterator.next).toHaveBeenCalledTimes(2);
    res.destroyed = true;
    res.emit("close");
    await running;
    expect(iterator.return).toHaveBeenCalledTimes(1);
    expect(res.end).not.toHaveBeenCalled();
    for (const event of ["drain", "close", "error"]) expect(res.listenerCount(event)).toBe(0);
  });

  it("bounds read-ahead over real HTTP and releases the source after a paused client disconnects", async () => {
    let produced = 0;
    let released = false;
    const chunk = "x".repeat(64 * 1024);
    async function* events(): AsyncGenerator<string> {
      try {
        for (let i = 0; i < 512; i += 1) { produced += 1; yield chunk; }
      } finally { released = true; }
    }
    const server = http.createServer((_req, res) => { void streamSse(res, events(), value => value, String); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP address");
    let request: http.ClientRequest | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        request = http.get({ host: "127.0.0.1", port: address.port }, response => {
          response.pause();
          resolve();
        });
        request.once("error", reject);
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(produced).toBeGreaterThan(0);
      expect(produced).toBeLessThan(512);
      request!.destroy();
      await vi.waitFor(() => expect(released).toBe(true));
    } finally {
      request?.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("settles a blocked write on socket error without waiting forever for drain", async () => {
    const res = new Response();
    const { iterator, stream } = source();
    const running = streamSse(res as unknown as ServerResponse, stream, value => value, String);
    await tick();
    res.emit("error", new Error("socket closed"));
    await running;
    expect(iterator.next).toHaveBeenCalledTimes(1);
    expect(iterator.return).toHaveBeenCalledTimes(1);
    expect(res.listenerCount("drain")).toBe(0);
  });
});

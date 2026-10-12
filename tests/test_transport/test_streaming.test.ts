/** Tests for transport.streaming module. */

import { describe, expect, it } from "vitest";

import { StreamReader } from "../../src/transport/streaming.js";

type Frame = Record<string, any>;

/** Helper to create an async iterator from a list. */
async function* _async_iter(items: Frame[]): AsyncGenerator<Frame> {
  for (const item of items) yield item;
}

/** Helper to create an async iterator that yields items then raises. */
async function* _async_iter_with_error(items: Frame[], error: Error): AsyncGenerator<Frame> {
  for (const item of items) yield item;
  throw error;
}

describe("TestStreamReader", () => {
  // Test StreamReader with mock async iterators.

  it("test_basic_iteration", async () => {
    const frames = [{ data: 1 }, { data: 2 }, { data: 3 }];
    const reader = new StreamReader(_async_iter(frames), (f) => f["data"]);
    const result = await reader.collect();
    expect(result).toEqual([1, 2, 3]);
  });

  it("test_transform_applied", async () => {
    const frames = [{ value: "a" }, { value: "b" }];
    const reader = new StreamReader(_async_iter(frames), (f) => (f["value"] as string).toUpperCase());
    const result = await reader.collect();
    expect(result).toEqual(["A", "B"]);
  });

  it("test_empty_stream", async () => {
    const reader = new StreamReader(_async_iter([]), (f) => f);
    const result = await reader.collect();
    expect(result).toEqual([]);
  });

  it("test_single_frame", async () => {
    const reader = new StreamReader(_async_iter([{ x: 42 }]), (f) => f["x"]);
    const result = await reader.collect();
    expect(result).toEqual([42]);
  });

  it("test_async_iteration", async () => {
    const frames = Array.from({ length: 5 }, (_, i) => ({ n: i }));
    const reader = new StreamReader(_async_iter(frames), (f) => f["n"] * 2);
    const collected: number[] = [];
    for await (const item of reader) {
      collected.push(item);
    }
    expect(collected).toEqual([0, 2, 4, 6, 8]);
  });

  it("test_error_propagation", async () => {
    const error = new RuntimeError("stream error");
    const reader = new StreamReader(_async_iter_with_error([{ data: 1 }], error), (f) => f["data"]);
    await expect(reader.collect()).rejects.toThrow(RuntimeError);
    const reader2 = new StreamReader(_async_iter_with_error([{ data: 1 }], error), (f) => f["data"]);
    await expect(reader2.collect()).rejects.toThrow(/stream error/);
  });

  it("test_transform_error_skipped", async () => {
    const frames = [{ data: 1 }, { bad: "frame" }, { data: 3 }];

    const transform = (f: Frame) => {
      if (!("data" in f)) throw new Error("KeyError: 'data'"); // Python: f["data"] raises KeyError
      return f["data"];
    };

    const reader = new StreamReader(_async_iter(frames), transform);
    const result = await reader.collect();
    expect(result).toEqual([1, 3]);
  });

  it("test_start_returns_self", async () => {
    const reader = new StreamReader(_async_iter([]), (f) => f);
    const result = reader.start();
    expect(result).toBe(reader);
    // Clean up
    await reader.collect();
  });

  it("test_cancel", async () => {
    // Create a slow async iterator that can be cancelled
    async function* slow_iter(): AsyncGenerator<Frame> {
      for (let i = 0; i < 5; i++) {
        yield { n: i };
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    const reader = new StreamReader(slow_iter(), (f) => f["n"]);
    // Read one item via async for
    for await (const item of reader) {
      expect(item).toBe(0);
      break; // stop after first
    }
    await reader.cancel();
    // Should not hang or raise
  });
});

class RuntimeError extends Error {}

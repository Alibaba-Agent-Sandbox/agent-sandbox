/** Tests for transport.codec module. */

import { describe, expect, it } from "vitest";

import { ValueError } from "../../src/models/_pydantic.js";
import {
  CONNECT_CONTENT_TYPE,
  ConnectCodec,
  EnvelopeStreamParser,
  HAS_ORJSON,
  json_decode,
  json_encode,
} from "../../src/transport/codec.js";
import { WARNING } from "../../src/utils/logging.js";
import { useCaplog } from "../_support/caplog.js";

const caplog = useCaplog();

/** `struct.pack(">BI", flags, length)`. */
function packHeader(flags: number, length: number): Buffer {
  const b = Buffer.alloc(5);
  b.writeUInt8(flags, 0);
  b.writeUInt32BE(length, 1);
  return b;
}

/** Build one binary envelope frame. */
function _frame(payload: Record<string, unknown>, flags = 0x00): Buffer {
  const body = json_encode(payload);
  return Buffer.concat([packHeader(flags, body.length), body]);
}

/** Feed every chunk and collect yielded frames in order. */
function _feed_all(parser: EnvelopeStreamParser, chunks: Buffer[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const chunk of chunks) out.push(...parser.feed(chunk));
  return out;
}

describe("TestJsonEncodeDecode", () => {
  // Test json_encode and json_decode roundtrip.

  it("test_roundtrip_dict", () => {
    const data = { key: "value", num: 42 };
    const encoded = json_encode(data);
    expect(Buffer.isBuffer(encoded)).toBe(true);
    const decoded = json_decode(encoded);
    expect(decoded).toEqual(data);
  });

  it("test_roundtrip_list", () => {
    const data = [1, 2, 3, "four"];
    const encoded = json_encode(data);
    const decoded = json_decode(encoded);
    expect(decoded).toEqual(data);
  });

  it("test_roundtrip_nested", () => {
    const data = { nested: { a: [1, 2], b: true }, c: null };
    const encoded = json_encode(data);
    const decoded = json_decode(encoded);
    expect(decoded).toEqual(data);
  });

  it("test_decode_str_input", () => {
    const result = json_decode('{"hello": "world"}');
    expect(result).toEqual({ hello: "world" });
  });

  it("test_decode_bytes_input", () => {
    const result = json_decode(Buffer.from('{"hello": "world"}'));
    expect(result).toEqual({ hello: "world" });
  });

  it("test_encode_empty_dict", () => {
    const encoded = json_encode({});
    const decoded = json_decode(encoded);
    expect(decoded).toEqual({});
  });

  it("test_has_orjson_flag", () => {
    expect(typeof HAS_ORJSON).toBe("boolean");
  });
});

describe("TestConnectCodec", () => {
  // Test ConnectCodec methods.

  it("test_content_type", () => {
    expect(ConnectCodec.content_type).toBe("application/connect+json");
    expect(CONNECT_CONTENT_TYPE).toBe("application/connect+json");
  });

  it("test_encode_request", () => {
    const payload = { command: "ls", args: ["-la"] };
    const result = ConnectCodec.encodeRequest(payload);
    expect(Buffer.isBuffer(result)).toBe(true);
    const decoded = json_decode(result);
    expect(decoded).toEqual(payload);
  });

  it("test_encode_request_empty", () => {
    const result = ConnectCodec.encodeRequest({});
    const decoded = json_decode(result);
    expect(decoded).toEqual({});
  });

  it("test_decode_response_valid", () => {
    const data = json_encode({ status: "ok", data: [1, 2] });
    const result = ConnectCodec.decodeResponse(data);
    expect(result).toEqual({ status: "ok", data: [1, 2] });
  });

  it("test_decode_response_str", () => {
    const result = ConnectCodec.decodeResponse('{"status": "ok"}');
    expect(result).toEqual({ status: "ok" });
  });

  it("test_decode_response_non_dict_raises", () => {
    const data = json_encode([1, 2, 3]);
    expect(() => ConnectCodec.decodeResponse(data)).toThrow(ValueError);
    expect(() => ConnectCodec.decodeResponse(data)).toThrow(/Expected dict response/);
  });

  it("test_decode_streaming_frame_valid", () => {
    const line = '{"result": {"output": "hello"}}';
    const result = ConnectCodec.decodeStreamingFrame(line);
    expect(result).toEqual({ result: { output: "hello" } });
  });

  it("test_decode_streaming_frame_bytes", () => {
    const line = Buffer.from('{"result": {"output": "hello"}}');
    const result = ConnectCodec.decodeStreamingFrame(line);
    expect(result).toEqual({ result: { output: "hello" } });
  });

  it("test_decode_streaming_frame_empty", () => {
    expect(ConnectCodec.decodeStreamingFrame("")).toEqual({});
    expect(ConnectCodec.decodeStreamingFrame("   ")).toEqual({});
    expect(ConnectCodec.decodeStreamingFrame(Buffer.alloc(0))).toEqual({});
  });

  it("test_decode_streaming_frame_non_dict_raises", () => {
    expect(() => ConnectCodec.decodeStreamingFrame('"just a string"')).toThrow(ValueError);
    expect(() => ConnectCodec.decodeStreamingFrame('"just a string"')).toThrow(/Expected dict frame/);
  });

  it("test_decode_streaming_frame_invalid_json", () => {
    expect(() => ConnectCodec.decodeStreamingFrame("{not valid json}")).toThrow(Error);
  });

  it("test_build_rpc_path", () => {
    const path = ConnectCodec.buildRpcPath("process", "Process", "Start");
    expect(path).toBe("/process.Process/Start");
  });

  it("test_build_rpc_path_filesystem", () => {
    const path = ConnectCodec.buildRpcPath("filesystem", "Filesystem", "ReadFile");
    expect(path).toBe("/filesystem.Filesystem/ReadFile");
  });
});

describe("TestEnvelopeStreamParser", () => {
  // Incremental binary-envelope parsing (task 166).

  it("test_single_frame_single_chunk", () => {
    const parser = new EnvelopeStreamParser();
    expect(parser.feed(_frame({ a: 1 }))).toEqual([{ a: 1 }]);
    expect(parser.pendingBytes()).toBe(0);
  });

  it("test_header_split_across_chunks", () => {
    // 5-byte frame header split 1+2+2 across chunks.
    const raw = _frame({ event: { data: { stdout: "aGk=" } } });
    const parser = new EnvelopeStreamParser();
    expect(parser.feed(raw.subarray(0, 1))).toEqual([]);
    expect(parser.feed(raw.subarray(1, 3))).toEqual([]);
    const frames = parser.feed(raw.subarray(3));
    expect(frames).toEqual([{ event: { data: { stdout: "aGk=" } } }]);
    expect(parser.pendingBytes()).toBe(0);
  });

  it("test_payload_split_across_chunks", () => {
    // Payload split mid-way across three chunks.
    const raw = _frame({ n: 12345678901234 });
    const parser = new EnvelopeStreamParser();
    expect(parser.feed(raw.subarray(0, 5))).toEqual([]); // full header, no payload yet
    expect(parser.feed(raw.subarray(5, 10))).toEqual([]);
    expect(parser.feed(raw.subarray(10))).toEqual([{ n: 12345678901234 }]);
  });

  it("test_multiple_frames_in_one_chunk", () => {
    const blob = Buffer.concat([_frame({ a: 1 }), _frame({ b: 2 }), _frame({ c: 3 })]);
    const parser = new EnvelopeStreamParser();
    expect(parser.feed(blob)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("test_frame_boundary_mixes_complete_and_partial", () => {
    // Chunk contains a whole frame + the start of the next frame.
    const first = _frame({ a: 1 });
    const second = _frame({ b: 2 });
    const parser = new EnvelopeStreamParser();
    expect(parser.feed(Buffer.concat([first, second.subarray(0, 4)]))).toEqual([{ a: 1 }]);
    expect(parser.pendingBytes()).toBe(4);
    expect(parser.feed(second.subarray(4))).toEqual([{ b: 2 }]);
  });

  it("test_trailer_and_empty_frames_skipped", () => {
    const parser = new EnvelopeStreamParser();
    const out = parser.feed(
      Buffer.concat([
        _frame({ a: 1 }),
        _frame({ error: { code: "x" } }, 0x02),
        packHeader(0x00, 0), // empty data frame
      ]),
    );
    expect(out).toEqual([{ a: 1 }]);
  });

  it("test_truncated_trailing_frame_stays_pending", () => {
    const raw = _frame({ big: "x".repeat(100) });
    const parser = new EnvelopeStreamParser();
    expect(parser.feed(raw.subarray(0, 60))).toEqual([]);
    expect(parser.pendingBytes()).toBe(60); // not silently discarded
  });

  it("test_invalid_json_payload_skipped", () => {
    const bad_payload = Buffer.from("{not json");
    const bad = Buffer.concat([packHeader(0x00, bad_payload.length), bad_payload]);
    const parser = new EnvelopeStreamParser();
    expect(parser.feed(Buffer.concat([bad, _frame({ ok: true })]))).toEqual([{ ok: true }]);
  });

  it("test_non_dict_payload_skipped", () => {
    const arr = Buffer.concat([packHeader(0x00, 7), Buffer.from("[1,2,3]")]);
    const parser = new EnvelopeStreamParser();
    expect(parser.feed(arr)).toEqual([]);
  });

  it("test_empty_chunk_is_noop", () => {
    const parser = new EnvelopeStreamParser();
    expect(parser.feed(Buffer.alloc(0))).toEqual([]);
    expect(parser.feed(_frame({ a: 1 }))).toEqual([{ a: 1 }]);
  });

  it("test_error_trailer_logged_not_yielded", () => {
    // A trailer carrying an error is skipped but logged for diagnostics.
    const parser = new EnvelopeStreamParser();
    const out = caplog.at_level(WARNING, "transport.codec", () =>
      parser.feed(Buffer.concat([_frame({ a: 1 }), _frame({ error: { code: "boom" } }, 0x02)])),
    );

    expect(out).toEqual([{ a: 1 }]); // error trailer never yielded
    expect(caplog.records.some((r) => r.getMessage().includes("error trailer"))).toBe(true);
  });

  it("test_success_trailer_not_logged", () => {
    // A normal (empty / non-error) trailer is skipped silently.
    const parser = new EnvelopeStreamParser();
    const out = caplog.at_level(WARNING, "transport.codec", () =>
      parser.feed(Buffer.concat([_frame({ a: 1 }), _frame({}, 0x02)])),
    );

    expect(out).toEqual([{ a: 1 }]);
    expect(caplog.records.length).toBe(0);
  });

  it("test_equivalence_with_parse_streaming_frames", () => {
    // For every systematic split, incremental == one-shot parsing.
    //
    // Feeds the same byte stream at every possible 2-split point and verifies the concatenated incremental output
    // equals ConnectCodec.parseStreamingFrames on the whole stream.
    const stream = Buffer.concat([
      _frame({ event: { start: { pid: 9 } } }),
      _frame({ event: { data: { stdout: "MQ==" } } }),
      _frame({ event: { data: { stderr: "Mg==" } } }),
      _frame({ event: { end: { exitCode: 0 } } }),
      _frame({}, 0x02),
    ]);
    const expected = ConnectCodec.parseStreamingFrames(stream);
    expect(expected.length).toBe(4);

    for (let split = 1; split < stream.length; split++) {
      const parser = new EnvelopeStreamParser();
      const got = _feed_all(parser, [stream.subarray(0, split), stream.subarray(split)]);
      expect(got, `mismatch at split=${split}`).toEqual(expected);
    }
  });

  it("test_equivalence_random_three_way_splits", () => {
    // Three-way splits (including 0-length chunks) stay equivalent.
    const stream = Buffer.concat([
      _frame({ a: 1 }),
      _frame({ b: 2 }),
      _frame({ c: 3 }),
      _frame({ error: { code: "boom" } }, 0x02),
    ]);
    const expected = ConnectCodec.parseStreamingFrames(stream);

    // Deterministic PRNG (mulberry32, seed 42) in place of `random.Random(42)`.
    let s = 42;
    const rand = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const randrange = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo));

    for (let n = 0; n < 50; n++) {
      const i = randrange(0, stream.length + 1);
      const j = randrange(0, stream.length + 1);
      const cuts = [i, j].sort((a, b) => a - b);
      const chunks = [stream.subarray(0, cuts[0]), stream.subarray(cuts[0], cuts[1]), stream.subarray(cuts[1])];
      const parser = new EnvelopeStreamParser();
      expect(_feed_all(parser, chunks)).toEqual(expected);
    }
  });
});

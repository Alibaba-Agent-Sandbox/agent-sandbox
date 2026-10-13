/**
 * Connect protocol (application/connect+json) codec.
 *
 * Streaming responses use binary envelope framing (已实测验证):
 *   flags (1 byte) + length (4 bytes big-endian) + JSON payload
 *   flags=0x00: data frame, flags=0x02: end-of-stream/trailer frame
 *
 * The Python module uses `orjson` when installed (compact UTF-8 output, strict parsing); this port mirrors that
 * behaviour (`HAS_ORJSON = true`).
 */

import { ValueError } from "../models/_pydantic.js";
import { PyFloat, pyJsonDumps, pyStrip } from "../utils/_pyformat.js";
import { getLogger } from "../utils/logging.js";

export class JSONDecodeError extends ValueError {
  constructor(message: string) {
    super(message);
    this.name = "JSONDecodeError";
  }
}

export const HAS_ORJSON = true;

/** Encode object to JSON bytes (compact, UTF-8 — orjson style). */
export function json_encode(obj: unknown): Buffer {
  return Buffer.from(pyJsonDumps(obj, { ensure_ascii: false, separators: [",", ":"], orjson: true }), "utf-8");
}

/** Decode JSON bytes/str to object. */
export function json_decode(data: Uint8Array | string): any {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    } catch {
      throw new JSONDecodeError("str is not valid UTF-8: surrogates not allowed: line 1 column 1 (char 0)");
    }
  }
  try {
    const parsed = NEEDS_NUMBER_SOURCE.test(text) ? parseOrjsonNumbers(text) : JSON.parse(text);
    // JSON.parse is laxer than orjson for lone surrogate escapes and overflowing numbers.
    if (STRICTER_THAN_JS.test(text)) {
      const strict = orjsonDiagnose(text);
      if (strict !== null) throw new JSONDecodeError(strict);
    }
    return parsed;
  } catch (e) {
    if (e instanceof JSONDecodeError) throw e;
    const diagnosed = orjsonDiagnose(text);
    if (diagnosed !== null) throw new JSONDecodeError(diagnosed);
    throw new JSONDecodeError(`${(e as Error).message}: line 1 column 1 (char 0)`);
  }
}

const NEEDS_NUMBER_SOURCE = /\d{16}|\.\d|\d[eE]/;
const U64_MAX = 18446744073709551615n;
const I64_MIN = -9223372036854775808n;

const ORJSON_NUMBER = /(-?(?:0|[1-9]\d*))(?:\.\d+)?(?:[eE][-+]?\d+)?/y;
const ORJSON_NUMBER_TAG = "\u0000orjson:";

/**
 * orjson's number model: a literal with a fraction or exponent is a float (whole values become {@link PyFloat}),
 * `-0` is the integer 0, integers beyond 2**53 stay exact up to 64 bits (`bigint`) and are floats beyond that.
 *
 * `JSON.parse`'s reviver `context.source` exists only on Node 22+, so the literal text is tagged before parsing.
 */
function orjsonNumberFromSource(src: string): number | bigint | PyFloat {
  if (/[.eE]/.test(src)) {
    const value = Number.parseFloat(src);
    return Number.isInteger(value) || !Number.isFinite(value) ? new PyFloat(value) : value;
  }
  const asNumber = Number(src);
  if (Number.isSafeInteger(asNumber)) return asNumber === 0 ? 0 : asNumber;
  const big = BigInt(src);
  return big >= I64_MIN && big <= U64_MAX ? big : new PyFloat(asNumber);
}

function tagOrjsonNumbers(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"') {
      let end = i + 1;
      while (end < text.length) {
        const c = text[end] as string;
        if (c === "\\") {
          end += 2;
          continue;
        }
        end += 1;
        if (c === '"') break;
      }
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      ORJSON_NUMBER.lastIndex = i;
      const match = ORJSON_NUMBER.exec(text);
      if (match && match.index === i) {
        out += JSON.stringify(ORJSON_NUMBER_TAG + match[0]);
        i += match[0].length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function restoreOrjsonNumbers(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith(ORJSON_NUMBER_TAG)) return orjsonNumberFromSource(value.slice(ORJSON_NUMBER_TAG.length));
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = restoreOrjsonNumbers(value[i]);
    return value;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      (value as Record<string, unknown>)[key] = restoreOrjsonNumbers((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function parseOrjsonNumbers(text: string): unknown {
  return restoreOrjsonNumbers(JSON.parse(tagOrjsonNumbers(text)));
}

class OrjsonFail extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
  }
}

const STRICTER_THAN_JS = /\\u[dD][0-9a-fA-F]|[eE][+-]?\d{3}|\d{300}/;

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

/**
 * The text of `orjson.JSONDecodeError` (3.13) for a document that `JSON.parse` rejected: `<reason>: line L column C
 * (char P)`, positions counted in code points. Returns `null` when the document is valid for this scanner.
 */
export function orjsonDiagnose(text: string): string | null {
  if (text.length === 0) return "Input is a zero-length, empty document: line 1 column 1 (char 0)";
  if (text.charCodeAt(0) === 0xfeff) return "UTF-8 byte order mark (BOM) is not supported: line 1 column 1 (char 0)";
  const cps = Array.from(text, (c) => c.codePointAt(0) as number);
  const n = cps.length;
  let pos = 0;
  const fail = (message: string, at: number): never => {
    throw new OrjsonFail(message, at);
  };
  const eof = (): never => fail("unexpected end of data", n);
  const skipWs = (): void => {
    while (pos < n && WS.has(cps[pos] as number)) pos += 1;
  };
  const isDigit = (c: number | undefined): boolean => c !== undefined && c >= 0x30 && c <= 0x39;
  const hex4 = (at: number): number => {
    let v = 0;
    for (let i = 0; i < 4; i += 1) {
      const c = cps[at + i];
      if (c === undefined) return -2;
      const d = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x61 && c <= 0x66 ? c - 0x57 : c >= 0x41 && c <= 0x46 ? c - 0x37 : -1;
      if (d < 0) return -1;
      v = v * 16 + d;
    }
    return v;
  };
  const literal = (word: string): void => {
    const start = pos;
    for (let i = 0; i < word.length; i += 1) {
      const c = cps[start + i];
      if (c === undefined) {
        if (i === n - start) return eof();
        break;
      }
      if (c !== word.charCodeAt(i)) return fail(`invalid literal, expected '${word}'`, start);
    }
    pos = start + word.length;
  };
  const string = (): void => {
    pos += 1;
    for (;;) {
      if (pos >= n) return eof();
      const c = cps[pos] as number;
      if (c === 0x22) {
        pos += 1;
        return;
      }
      if (c < 0x20) return fail("unexpected control character in string", pos);
      if (c !== 0x5c) {
        pos += 1;
        continue;
      }
      const esc = pos;
      const e = cps[pos + 1];
      if (e === undefined) return eof();
      if (e < 0x80 && '"\\/bfnrt'.includes(String.fromCharCode(e))) {
        pos += 2;
        continue;
      }
      if (e !== 0x75) return fail("invalid escaped sequence in string", esc);
      const v = hex4(pos + 2);
      if (v === -2) return eof();
      if (v === -1) return fail("invalid escaped sequence in string", esc);
      pos += 6;
      if (v >= 0xdc00 && v <= 0xdfff) {
        if (pos >= n) return eof();
        return fail("invalid high surrogate in string", esc);
      }
      if (v >= 0xd800 && v <= 0xdbff) {
        if (pos >= n) return eof();
        if (cps[pos] !== 0x5c) return fail("no low surrogate in string", esc);
        if (pos + 1 >= n) return eof();
        if (cps[pos + 1] !== 0x75) return fail("no low surrogate in string", esc);
        for (let i = 0; i < 4; i += 1) {
          const c = cps[pos + 2 + i];
          if (c === undefined) return eof();
          const low = c | 0x20;
          const fits =
            i === 0 ? low === 0x64 : i === 1 ? low >= 0x63 && low <= 0x66 : isDigit(c) || (low >= 0x61 && low <= 0x66);
          if (!fits) return fail(hex4(pos + 2) >= 0 ? "invalid low surrogate in string" : "invalid escape in string", esc);
        }
        pos += 6;
      }
    }
  };
  const number = (): void => {
    const start = pos;
    if (cps[pos] === 0x2d) {
      pos += 1;
      if (pos >= n) return eof();
      if (!isDigit(cps[pos])) return fail("no digit after sign", pos);
    }
    if (cps[pos] === 0x30) {
      pos += 1;
      if (isDigit(cps[pos])) return fail("number with leading zero is not allowed", pos - 1);
    } else {
      while (isDigit(cps[pos])) pos += 1;
    }
    if (cps[pos] === 0x2e) {
      pos += 1;
      if (pos >= n) return eof();
      if (!isDigit(cps[pos])) return fail("no digit after decimal point", pos);
      while (isDigit(cps[pos])) pos += 1;
    }
    if (cps[pos] === 0x65 || cps[pos] === 0x45) {
      pos += 1;
      if (cps[pos] === 0x2b || cps[pos] === 0x2d) pos += 1;
      if (pos >= n) return eof();
      if (!isDigit(cps[pos])) return fail("no digit after exponent sign", pos);
      while (isDigit(cps[pos])) pos += 1;
    }
    if (!Number.isFinite(Number(String.fromCodePoint(...cps.slice(start, pos))))) {
      return fail("number is infinity when parsed as double", start);
    }
  };
  const value = (): void => {
    skipWs();
    if (pos >= n) return eof();
    const c = cps[pos] as number;
    if (c === 0x22) return string();
    if (c === 0x7b) return object();
    if (c === 0x5b) return array();
    if (c === 0x74) return literal("true");
    if (c === 0x66) return literal("false");
    if (c === 0x6e) return literal("null");
    if (c === 0x2d || isDigit(c)) return number();
    if (c === 0x2b || c === 0x2e) return fail("no digit after sign", pos);
    return fail("unexpected character, expected a JSON value", pos);
  };
  const object = (): void => {
    pos += 1;
    skipWs();
    if (pos >= n) return eof();
    if (cps[pos] === 0x7d) {
      pos += 1;
      return;
    }
    for (;;) {
      skipWs();
      if (pos >= n) return eof();
      if (cps[pos] !== 0x22) return fail("unexpected character, expected a string key", pos);
      string();
      skipWs();
      if (pos >= n) return eof();
      if (cps[pos] !== 0x3a) return fail("unexpected character, expected ':' after key", pos);
      pos += 1;
      value();
      skipWs();
      if (pos >= n) return eof();
      const c = cps[pos];
      if (c === 0x7d) {
        pos += 1;
        return;
      }
      if (c !== 0x2c) return fail("unexpected character, expected ',' or '}'", pos);
      const comma = pos;
      pos += 1;
      skipWs();
      if (pos >= n) return eof();
      if (cps[pos] === 0x7d) return fail("trailing comma is not allowed", comma);
    }
  };
  const array = (): void => {
    pos += 1;
    skipWs();
    if (pos >= n) return eof();
    if (cps[pos] === 0x5d) {
      pos += 1;
      return;
    }
    for (;;) {
      value();
      skipWs();
      if (pos >= n) return eof();
      const c = cps[pos];
      if (c === 0x5d) {
        pos += 1;
        return;
      }
      if (c !== 0x2c) return fail("unexpected character, expected ',' or ']'", pos);
      const comma = pos;
      pos += 1;
      skipWs();
      if (pos >= n) return eof();
      if (cps[pos] === 0x5d) return fail("trailing comma is not allowed", comma);
    }
  };
  try {
    skipWs();
    if (pos >= n) return "input data is empty: line 1 column 1 (char 0)";
    value();
    skipWs();
    if (pos < n) fail("unexpected content after document", pos);
  } catch (e) {
    if (!(e instanceof OrjsonFail)) throw e;
    let line = 1;
    let lastNl = -1;
    for (let i = 0; i < e.pos && i < n; i += 1) {
      if (cps[i] === 0x0a) {
        line += 1;
        lastNl = i;
      }
    }
    return `${e.message}: line ${line} column ${e.pos - lastNl} (char ${e.pos})`;
  }
  return null;
}

export const jsonEncode = json_encode;
export const jsonDecode = json_decode;

export const CONNECT_CONTENT_TYPE = "application/connect+json";

const logger = getLogger("transport.codec");

function pyTypeNameOf(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "bigint") return "int";
  if (v instanceof PyFloat) return "float";
  return "dict";
}

function isDict(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Encode/decode Connect protocol messages.
 *
 * The Connect protocol uses JSON encoding with content type 'application/connect+json'. RPC endpoints follow the
 * pattern: /{package}.{Service}/{Method}
 */
export class ConnectCodec {
  static content_type: string = CONNECT_CONTENT_TYPE;
  content_type: string = CONNECT_CONTENT_TYPE;

  static FRAME_FLAG_DATA = 0x00;
  static FRAME_FLAG_TRAILER = 0x02;
  static FRAME_HEADER_SIZE = 5; // 1 byte flags + 4 bytes length

  FRAME_FLAG_DATA = ConnectCodec.FRAME_FLAG_DATA;
  FRAME_FLAG_TRAILER = ConnectCodec.FRAME_FLAG_TRAILER;
  FRAME_HEADER_SIZE = ConnectCodec.FRAME_HEADER_SIZE;

  /** Encode a Connect RPC request body. */
  static encodeRequest(payload: Record<string, unknown>): Buffer {
    return json_encode(payload);
  }
  encodeRequest(payload: Record<string, unknown>): Buffer {
    return ConnectCodec.encodeRequest(payload);
  }

  /** Decode a Connect RPC response body. */
  static decodeResponse(data: Uint8Array | string): Record<string, any> {
    const result = json_decode(data);
    if (!isDict(result)) {
      throw new ValueError(`Expected dict response, got ${pyTypeNameOf(result)}`);
    }
    return result;
  }
  decodeResponse(data: Uint8Array | string): Record<string, any> {
    return ConnectCodec.decodeResponse(data);
  }

  /**
   * Decode a single streaming frame (one line of NDJSON).
   *
   * Connect streaming responses contain JSON objects separated by newlines.
   * Each object has a 'result' field with the actual data.
   */
  static decodeStreamingFrame(line: Uint8Array | string): Record<string, any> {
    let text: string;
    if (typeof line === "string") text = line;
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(line);
      } catch {
        throw new ValueError("'utf-8' codec can't decode bytes");
      }
    }
    text = pyStrip(text);
    if (!text) return {};
    const result = json_decode(text);
    if (!isDict(result)) {
      throw new ValueError(`Expected dict frame, got ${pyTypeNameOf(result)}`);
    }
    return result;
  }
  decodeStreamingFrame(line: Uint8Array | string): Record<string, any> {
    return ConnectCodec.decodeStreamingFrame(line);
  }

  /**
   * Build a Connect RPC endpoint path.
   *
   * Example: buildRpcPath("process", "Process", "Start") -> "/process.Process/Start"
   */
  static buildRpcPath(pkg: string, service: string, method: string): string {
    return `/${pkg}.${service}/${method}`;
  }
  buildRpcPath(pkg: string, service: string, method: string): string {
    return ConnectCodec.buildRpcPath(pkg, service, method);
  }

  /**
   * Parse binary envelope-framed streaming response into JSON frames.
   *
   * Connect streaming format (已实测验证):
   *   [flags: 1 byte][length: 4 bytes big-endian][JSON payload: variable]
   *   Repeated for each frame.
   *
   * Flags: 0x00 = data frame (contains event JSON), 0x02 = end-of-stream/trailer frame (skip)
   */
  static parseStreamingFrames(data: Uint8Array): Record<string, any>[] {
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const frames: Record<string, any>[] = [];
    let pos = 0;
    while (pos < buf.length) {
      if (pos + 5 > buf.length) break; // Incomplete header
      const flags = buf[pos] as number;
      const length = buf.readUInt32BE(pos + 1);
      pos += 5;
      if (pos + length > buf.length) break; // Incomplete payload
      const payload = buf.subarray(pos, pos + length);
      pos += length;

      if (flags === 0x02) continue; // Trailer frame, skip
      if (payload.length === 0) continue;

      try {
        const frame = json_decode(payload);
        if (isDict(frame)) frames.push(frame);
      } catch {
        continue;
      }
    }
    return frames;
  }
  parseStreamingFrames(data: Uint8Array): Record<string, any>[] {
    return ConnectCodec.parseStreamingFrames(data);
  }
}

/**
 * Incremental parser for Connect binary envelope-framed streams.
 *
 * Feed raw network chunks via `feed`; each call returns the frames that became complete with that chunk (possibly an
 * empty list).  Frame semantics match `ConnectCodec.parseStreamingFrames` exactly (trailer/end frames skipped,
 * unparseable payloads skipped, non-dict payloads skipped).
 */
export class EnvelopeStreamParser {
  _buf: Buffer = Buffer.alloc(0);

  /** Absorb `chunk` and return frames completed by this chunk (wire order). */
  feed(chunk: Uint8Array): Record<string, any>[] {
    if (chunk && chunk.length) {
      this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : Buffer.from(chunk);
    }

    const frames: Record<string, any>[] = [];
    const headerSize = ConnectCodec.FRAME_HEADER_SIZE;
    let offset = 0;
    for (;;) {
      const remaining = this._buf.length - offset;
      if (remaining < headerSize) break; // Incomplete header — wait for more bytes
      const flags = this._buf[offset] as number;
      const length = this._buf.readUInt32BE(offset + 1);
      const frameEnd = headerSize + length;
      if (remaining < frameEnd) break; // Incomplete payload — wait for more bytes
      const payload = Buffer.from(this._buf.subarray(offset + headerSize, offset + frameEnd));
      offset += frameEnd;

      if (flags === ConnectCodec.FRAME_FLAG_TRAILER) {
        // End-of-stream/trailer frame, skip (an error trailer is only logged; HTTP-level error mapping applies).
        if (payload.length) {
          let trailer: unknown;
          try {
            trailer = json_decode(payload);
          } catch {
            trailer = null;
          }
          if (isDict(trailer) && trailer["error"]) {
            logger.warning("Connect stream ended with error trailer: %s", trailer["error"]);
          }
        }
        continue;
      }

      if (payload.length === 0) continue;

      let frame: unknown;
      try {
        frame = json_decode(payload);
      } catch {
        continue;
      }
      if (isDict(frame)) frames.push(frame);
    }
    if (offset) this._buf = this._buf.subarray(offset);
    return frames;
  }

  /** Number of buffered bytes belonging to an incomplete final frame. */
  pendingBytes(): number {
    return this._buf.length;
  }
}

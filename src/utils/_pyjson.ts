/**
 * CPython `json.loads` (scanner, error texts, `bytes` encoding detection) shared by the transport (httpx
 * `Response.json()`), the API layer and the MCP runtime.
 *
 * Value model (`floats: "number"`, the default): floats are JS numbers, ints beyond 2**53 are `bigint`, objects are
 * null-prototype dicts.
 *
 * `floats: "py"` keeps Python's int/float distinction for server data: a float with an integral value (`2.0`, `1e3`,
 * `1e400` -> inf, NaN) is a {@link PyFloat}; a non-integral float is a plain `number` (which every formatter already
 * renders as a float); integers outside the safe range are `bigint`; objects are ordinary objects.
 */

import { ValueError } from "../models/value_error.js";
import { PY_KEY_ORDER, PyFloat } from "./_pyformat.js";
import { UnicodeDecodeError, _utf8DecodeError } from "./_pyos.js";

/** Python `json.JSONDecodeError`. */
export class JSONDecodeError extends ValueError {
  readonly msg: string;
  readonly doc: string;
  readonly pos: number;
  readonly lineno: number;
  readonly colno: number;
  constructor(msg: string, doc: string, pos: number) {
    const cp = codePointIndex(doc, pos);
    const head = doc.slice(0, pos);
    const lineno = countChar(head, "\n") + 1;
    const nl = head.lastIndexOf("\n");
    const colno = nl === -1 ? cp + 1 : cp - codePointIndex(doc, nl);
    super(`${msg}: line ${lineno} column ${colno} (char ${cp})`);
    this.name = "JSONDecodeError";
    this.msg = msg;
    this.doc = doc;
    this.pos = cp;
    this.lineno = lineno;
    this.colno = colno;
  }
}

function countChar(text: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === ch) n++;
  return n;
}

function codePointIndex(doc: string, utf16Index: number): number {
  let n = 0;
  const end = Math.min(utf16Index, doc.length);
  for (let i = 0; i < end; i++) {
    const c = doc.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < doc.length) {
      const d = doc.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// json.loads
// ---------------------------------------------------------------------------

const WS = new Set([" ", "\t", "\n", "\r"]);
const NUMBER_RE = /(-?(?:0|[1-9][0-9]*))(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

class StopIter {
  constructor(readonly idx: number) {}
}

type JsonObject = Record<string, unknown>;

/** Keys JS iterates first and in numeric order (canonical array indices). */
const ARRAY_INDEX_RE = /^(?:0|[1-9][0-9]{0,9})$/;

export interface LoadsOptions {
  /** See the module comment; `"number"` is the default. */
  floats?: "number" | "py";
}

class Scanner {
  private readonly py: boolean;
  constructor(
    private readonly s: string,
    opts: LoadsOptions = {},
  ) {
    this.py = opts.floats === "py";
  }

  private float(n: number): number | PyFloat {
    if (!this.py) return n;
    return Number.isInteger(n) || !Number.isFinite(n) ? new PyFloat(n) : n;
  }

  skipWs(idx: number): number {
    while (idx < this.s.length && WS.has(this.s[idx] as string)) idx++;
    return idx;
  }

  parseString(quoteIdx: number): [string, number] {
    const s = this.s;
    let end = quoteIdx + 1;
    let out = "";
    for (;;) {
      let chunkEnd = end;
      while (chunkEnd < s.length) {
        const c = s.charCodeAt(chunkEnd);
        if (c === 0x22 || c === 0x5c || c < 0x20) break;
        chunkEnd++;
      }
      if (chunkEnd >= s.length) {
        throw new JSONDecodeError("Unterminated string starting at", s, quoteIdx);
      }
      out += s.slice(end, chunkEnd);
      const term = s[chunkEnd] as string;
      end = chunkEnd + 1;
      if (term === '"') return [out, end];
      if (term !== "\\") {
        throw new JSONDecodeError("Invalid control character at", s, chunkEnd);
      }
      if (end >= s.length) {
        throw new JSONDecodeError("Unterminated string starting at", s, quoteIdx);
      }
      const esc = s[end] as string;
      if (esc !== "u") {
        const mapped = ESCAPES[esc];
        if (mapped === undefined) {
          throw new JSONDecodeError("Invalid \\escape", s, end - 1);
        }
        out += mapped;
        end += 1;
        continue;
      }
      const hex = (at: number): number => {
        const h = s.slice(at, at + 4);
        if (h.length < 4 || !/^[0-9a-fA-F]{4}$/.test(h)) {
          throw new JSONDecodeError("Invalid \\uXXXX escape", s, at - 1);
        }
        return parseInt(h, 16);
      };
      const uni = hex(end + 1);
      end += 5;
      if (uni >= 0xd800 && uni <= 0xdbff && s[end] === "\\" && s[end + 1] === "u") {
        const uni2 = hex(end + 2);
        if (uni2 >= 0xdc00 && uni2 <= 0xdfff) {
          out += String.fromCharCode(uni, uni2);
          end += 6;
          continue;
        }
      }
      out += String.fromCharCode(uni);
    }
  }

  parseObject(openIdx: number): [JsonObject, number] {
    const s = this.s;
    const obj: JsonObject = (this.py ? {} : Object.create(null)) as JsonObject;
    const order: string[] = [];
    let hasIndexKey = false;
    const finish = (): JsonObject => {
      if (hasIndexKey && order.length > 1) {
        const js = Object.keys(obj);
        if (js.some((k, i) => k !== order[i])) {
          Object.defineProperty(obj, PY_KEY_ORDER, { value: order, enumerable: false, configurable: true, writable: true });
        }
      }
      return obj;
    };
    let end = this.skipWs(openIdx + 1);
    if (s[end] === "}") return [obj, end + 1];
    for (;;) {
      if (s[end] !== '"') {
        throw new JSONDecodeError("Expecting property name enclosed in double quotes", s, end);
      }
      const [key, afterKey] = this.parseString(end);
      end = this.skipWs(afterKey);
      if (s[end] !== ":") throw new JSONDecodeError("Expecting ':' delimiter", s, end);
      end = this.skipWs(end + 1);
      let value: unknown;
      try {
        [value, end] = this.scanOnce(end);
      } catch (exc) {
        if (exc instanceof StopIter) throw new JSONDecodeError("Expecting value", s, exc.idx);
        throw exc;
      }
      if (!Object.hasOwn(obj, key)) {
        order.push(key);
        if (!hasIndexKey && ARRAY_INDEX_RE.test(key)) hasIndexKey = true;
      }
      Object.defineProperty(obj, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      end = this.skipWs(end);
      const next = s[end];
      if (next === "}") return [finish(), end + 1];
      if (next !== ",") throw new JSONDecodeError("Expecting ',' delimiter", s, end);
      end = this.skipWs(end + 1);
    }
  }

  parseArray(openIdx: number): [unknown[], number] {
    const s = this.s;
    const arr: unknown[] = [];
    let end = this.skipWs(openIdx + 1);
    if (s[end] === "]") return [arr, end + 1];
    for (;;) {
      try {
        const [value, next] = this.scanOnce(end);
        arr.push(value);
        end = next;
      } catch (exc) {
        if (exc instanceof StopIter) throw new JSONDecodeError("Expecting value", s, exc.idx);
        throw exc;
      }
      end = this.skipWs(end);
      const next = s[end];
      if (next === "]") return [arr, end + 1];
      if (next !== ",") throw new JSONDecodeError("Expecting ',' delimiter", s, end);
      end = this.skipWs(end + 1);
    }
  }

  scanOnce(idx: number): [unknown, number] {
    const s = this.s;
    if (idx >= s.length) throw new StopIter(idx);
    const ch = s[idx] as string;
    if (ch === '"') return this.parseString(idx);
    if (ch === "{") return this.parseObject(idx);
    if (ch === "[") return this.parseArray(idx);
    if (ch === "n" && s.startsWith("null", idx)) return [null, idx + 4];
    if (ch === "t" && s.startsWith("true", idx)) return [true, idx + 4];
    if (ch === "f" && s.startsWith("false", idx)) return [false, idx + 5];
    NUMBER_RE.lastIndex = idx;
    const m = NUMBER_RE.exec(s);
    if (m && (ch === "-" || (ch >= "0" && ch <= "9"))) {
      const [whole, intPart = "", frac, exp] = m;
      if (frac || exp) return [this.float(Number.parseFloat(whole)), idx + whole.length];
      const asNumber = Number(intPart);
      return [Number.isSafeInteger(asNumber) ? asNumber : BigInt(intPart), idx + whole.length];
    }
    if (ch === "N" && s.startsWith("NaN", idx)) return [this.float(Number.NaN), idx + 3];
    if (ch === "I" && s.startsWith("Infinity", idx)) return [this.float(Infinity), idx + 8];
    if (ch === "-" && s.startsWith("-Infinity", idx)) return [this.float(-Infinity), idx + 9];
    throw new StopIter(idx);
  }
}

/** Python `json.loads(str)`, including the CPython error messages. */
export function pyJsonLoads(text: string, opts: LoadsOptions = {}): unknown {
  if (text.startsWith("\ufeff")) {
    throw new JSONDecodeError("Unexpected UTF-8 BOM (decode using utf-8-sig)", text, 0);
  }
  const scanner = new Scanner(text, opts);
  const start = scanner.skipWs(0);
  let value: unknown;
  let end: number;
  try {
    [value, end] = scanner.scanOnce(start);
  } catch (exc) {
    if (exc instanceof StopIter) throw new JSONDecodeError("Expecting value", text, exc.idx);
    throw exc;
  }
  end = scanner.skipWs(end);
  if (end !== text.length) throw new JSONDecodeError("Extra data", text, end);
  return value;
}

function strictUtf8(buf: Uint8Array): string {
  const problem = _utf8DecodeError(buf);
  if (problem !== null) throw new UnicodeDecodeError(problem);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
}

function decodeUtf32(buf: Buffer, littleEndian: boolean, skip: number): string {
  if ((buf.length - skip) % 4 !== 0) throw new ValueError("truncated data");
  let out = "";
  for (let i = skip; i < buf.length; i += 4) {
    const cp = littleEndian ? buf.readUInt32LE(i) : buf.readUInt32BE(i);
    if (cp > 0x10ffff) throw new ValueError("code point not in range(0x110000)");
    out += String.fromCodePoint(cp);
  }
  return out;
}

function decodeUtf16(buf: Buffer, littleEndian: boolean, skip: number): string {
  if ((buf.length - skip) % 2 !== 0) throw new ValueError("truncated data");
  const body = buf.subarray(skip);
  return new TextDecoder(littleEndian ? "utf-16le" : "utf-16be", { fatal: true, ignoreBOM: true }).decode(body);
}

/**
 * Python `json.loads(bytes)`: the encoding is sniffed with
 * `json.detect_encoding` and the text is then parsed like `loads(str)`.
 */
export function pyJsonLoadsBytes(buf: Buffer, opts: LoadsOptions = {}): unknown {
  let text: string;
  const startsWith = (...bytes: number[]): boolean =>
    buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);
  if (startsWith(0xff, 0xfe, 0x00, 0x00)) text = decodeUtf32(buf, true, 4);
  else if (startsWith(0x00, 0x00, 0xfe, 0xff)) text = decodeUtf32(buf, false, 4);
  else if (startsWith(0xff, 0xfe)) text = decodeUtf16(buf, true, 2);
  else if (startsWith(0xfe, 0xff)) text = decodeUtf16(buf, false, 2);
  else if (startsWith(0xef, 0xbb, 0xbf)) {
    text = strictUtf8(buf.subarray(3));
  } else if (buf.length >= 4 && buf[0] === 0) {
    text = buf[1] ? decodeUtf16(buf, false, 0) : decodeUtf32(buf, false, 0);
  } else if (buf.length >= 4 && buf[1] === 0) {
    text = buf[2] || buf[3] ? decodeUtf16(buf, true, 0) : decodeUtf32(buf, true, 0);
  } else if (buf.length === 2 && buf[0] === 0) {
    text = decodeUtf16(buf, false, 0);
  } else if (buf.length === 2 && buf[1] === 0) {
    text = decodeUtf16(buf, true, 0);
  } else {
    text = strictUtf8(buf);
  }
  return pyJsonLoads(text, opts);
}

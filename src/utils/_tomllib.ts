/**
 * Line-by-line port of CPython 3.11 `tomllib` (`_parser.py` / `_re.py`), used by `config_cmd` so that
 *
 *  - integers and floats keep their Python distinction (`60` vs `60.0`),
 *  - tables keep file order (`Map`, also for integer-like keys),
 *  - error messages for a corrupted `~/.ebx/config.toml` are the exact `TOMLDecodeError` texts the Python CLI prints
 *    ("Invalid statement (at line 1, column 4)"), including the `UnicodeDecodeError` for non UTF-8 files.
 *
 * Value model: `str` -> string, `bool` -> boolean, `int` -> number (safe range) or bigint, `float` -> {@link PyFloat},
 * arrays -> arrays, tables -> `Map<string, unknown>`, date/time values -> {@link TomlTemporal} (`str()` text of the
 * corresponding `datetime` objects).
 */

import { PyFloat, pyStrRepr } from "./_pyformat.js";
import { UnicodeDecodeError } from "./_pyos.js";

export class TOMLDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TOMLDecodeError";
  }
}

/** Python `date` / `datetime` / `time` value; only `str()` is needed by the CLI. */
export class TomlTemporal {
  constructor(readonly text: string) {}
  __str__(): string {
    return this.text;
  }
  toString(): string {
    return this.text;
  }

  /** Python type name (`date`, `datetime` or `time`), used by pydantic style error messages. */
  get __pytype__(): string {
    if (/^\d{4}-\d\d-\d\d$/.test(this.text)) return "date";
    return this.text.includes("-") && this.text.includes(" ") ? "datetime" : "time";
  }

  /** Python `repr()` of the corresponding `datetime` object. */
  __repr__(): string {
    const kind = this.__pytype__;
    const m = /^(?:(\d{4})-(\d\d)-(\d\d))?(?: ?(\d\d):(\d\d):(\d\d)(?:\.(\d{6}))?(?:([+-])(\d\d):(\d\d))?)?$/.exec(this.text);
    if (!m) return this.text;
    const n = (x: string | undefined): number => Number(x);
    if (kind === "date") return `datetime.date(${n(m[1])}, ${n(m[2])}, ${n(m[3])})`;
    const parts: number[] = [];
    if (kind === "datetime") parts.push(n(m[1]), n(m[2]), n(m[3]));
    parts.push(n(m[4]), n(m[5]));
    const micro = m[7] === undefined ? 0 : n(m[7]);
    const sec = n(m[6]);
    if (micro) parts.push(sec, micro);
    else if (sec) parts.push(sec);
    let body = parts.join(", ");
    if (m[8] !== undefined) {
      const total = (m[8] === "-" ? -1 : 1) * (n(m[9]) * 3600 + n(m[10]) * 60);
      let tz: string;
      if (total === 0) tz = "datetime.timezone.utc";
      else {
        const days = Math.floor(total / 86400);
        const secs = total - days * 86400;
        const fields = [...(days ? [`days=${days}`] : []), ...(secs ? [`seconds=${secs}`] : [])];
        tz = `datetime.timezone(datetime.timedelta(${fields.join(", ")}))`;
      }
      body += `, tzinfo=${tz}`;
    }
    return `datetime.${kind}(${body})`;
  }
}

export type Table = Map<string, unknown>;

const ASCII_CTRL = new Set<string>();
for (let i = 0; i < 32; i++) ASCII_CTRL.add(String.fromCharCode(i));
ASCII_CTRL.add("\x7f");

const without = (base: Set<string>, ...drop: string[]): Set<string> => {
  const s = new Set(base);
  for (const d of drop) s.delete(d);
  return s;
};

const ILLEGAL_BASIC_STR_CHARS = without(ASCII_CTRL, "\t");
const ILLEGAL_MULTILINE_BASIC_STR_CHARS = without(ASCII_CTRL, "\t", "\n");
const ILLEGAL_LITERAL_STR_CHARS = ILLEGAL_BASIC_STR_CHARS;
const ILLEGAL_MULTILINE_LITERAL_STR_CHARS = ILLEGAL_MULTILINE_BASIC_STR_CHARS;
const ILLEGAL_COMMENT_CHARS = ILLEGAL_BASIC_STR_CHARS;

const TOML_WS = new Set([" ", "\t"]);
const TOML_WS_AND_NEWLINE = new Set([" ", "\t", "\n"]);
const BARE_KEY_CHARS = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_");
const KEY_INITIAL_CHARS = new Set([...BARE_KEY_CHARS, '"', "'"]);
const HEXDIGIT_CHARS = new Set("0123456789abcdefABCDEF");

const BASIC_STR_ESCAPE_REPLACEMENTS: Record<string, string> = {
  "\\b": "\u0008",
  "\\t": "\u0009",
  "\\n": "\u000a",
  "\\f": "\u000c",
  "\\r": "\u000d",
  '\\"': "\u0022",
  "\\\\": "\u005c",
};

const MAX_KEY_PARTS = 1000;

type Key = readonly string[];

function keyRepr(key: Key): string {
  return `(${key.map(pyStrRepr).join(", ")}${key.length === 1 ? "," : ""})`;
}

class KeyError extends Error {}

const FROZEN = 0;
const EXPLICIT_NEST = 1;

interface FlagNode {
  flags: Set<number>;
  recursive_flags: Set<number>;
  nested: Map<string, FlagNode>;
}

const newNode = (): FlagNode => ({ flags: new Set(), recursive_flags: new Set(), nested: new Map() });

class Flags {
  private _flags = new Map<string, FlagNode>();
  private _pending = new Map<string, [Key, number]>();

  add_pending(key: Key, flag: number): void {
    this._pending.set(JSON.stringify([key, flag]), [key, flag]);
  }

  finalize_pending(): void {
    for (const [key, flag] of this._pending.values()) this.set(key, flag, false);
    this._pending.clear();
  }

  unset_all(key: Key): void {
    let cont = this._flags;
    for (const k of key.slice(0, -1)) {
      const node = cont.get(k);
      if (node === undefined) return;
      cont = node.nested;
    }
    cont.delete(key[key.length - 1] as string);
  }

  set(key: Key, flag: number, recursive: boolean): void {
    let cont = this._flags;
    for (const k of key.slice(0, -1)) {
      let node = cont.get(k);
      if (node === undefined) {
        node = newNode();
        cont.set(k, node);
      }
      cont = node.nested;
    }
    const stem = key[key.length - 1] as string;
    let node = cont.get(stem);
    if (node === undefined) {
      node = newNode();
      cont.set(stem, node);
    }
    (recursive ? node.recursive_flags : node.flags).add(flag);
  }

  is_(key: Key, flag: number): boolean {
    if (!key.length) return false;
    let cont = this._flags;
    for (const k of key.slice(0, -1)) {
      const inner = cont.get(k);
      if (inner === undefined) return false;
      if (inner.recursive_flags.has(flag)) return true;
      cont = inner.nested;
    }
    const node = cont.get(key[key.length - 1] as string);
    if (node !== undefined) return node.flags.has(flag) || node.recursive_flags.has(flag);
    return false;
  }
}

class NestedDict {
  dict: Table = new Map();

  get_or_create_nest(key: Key, access_lists = true): Table {
    let cont: unknown = this.dict;
    for (const k of key) {
      const m = cont as Table;
      if (!m.has(k)) m.set(k, new Map());
      cont = m.get(k);
      if (access_lists && Array.isArray(cont)) cont = cont[cont.length - 1];
      if (!(cont instanceof Map)) throw new KeyError("There is no nest behind this key");
    }
    return cont as Table;
  }

  append_nest_to_list(key: Key): void {
    const cont = this.get_or_create_nest(key.slice(0, -1));
    const last = key[key.length - 1] as string;
    if (cont.has(last)) {
      const list = cont.get(last);
      if (!Array.isArray(list)) throw new KeyError("An object other than list found behind this key");
      list.push(new Map());
    } else {
      cont.set(last, [new Map()]);
    }
  }
}

interface Output {
  data: NestedDict;
  flags: Flags;
}

function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function suffixedErr(src: string, pos: number, msg: string): TOMLDecodeError {
  let coord: string;
  if (pos >= src.length) {
    coord = "end of document";
  } else {
    let line = 1;
    let lastNl = -1;
    for (let i = 0; i < pos; i++) {
      if (src.charCodeAt(i) === 10) {
        line++;
        lastNl = i;
      }
    }
    const column = line === 1 ? cpLen(src.slice(0, pos)) + 1 : cpLen(src.slice(lastNl + 1, pos)) + 1;
    coord = `line ${line}, column ${column}`;
  }
  return new TOMLDecodeError(`${msg} (at ${coord})`);
}

function skipChars(src: string, pos: number, chars: Set<string>): number {
  while (pos < src.length && chars.has(src[pos] as string)) pos++;
  return pos;
}

function skipUntil(src: string, pos: number, expect: string, errorOn: Set<string>, errorOnEof: boolean): number {
  let newPos = src.indexOf(expect, pos);
  if (newPos === -1) {
    newPos = src.length;
    if (errorOnEof) throw suffixedErr(src, newPos, `Expected ${pyStrRepr(expect)}`);
  }
  let bad = false;
  for (let i = pos; i < newPos; i++) {
    if (errorOn.has(src[i] as string)) {
      bad = true;
      break;
    }
  }
  if (bad) {
    while (!errorOn.has(src[pos] as string)) pos++;
    throw suffixedErr(src, pos, `Found invalid character ${pyStrRepr(src[pos] as string)}`);
  }
  return newPos;
}

function skipComment(src: string, pos: number): number {
  if (src[pos] === "#") return skipUntil(src, pos + 1, "\n", ILLEGAL_COMMENT_CHARS, false);
  return pos;
}

function skipCommentsAndArrayWs(src: string, pos: number): number {
  for (;;) {
    const before = pos;
    pos = skipChars(src, pos, TOML_WS_AND_NEWLINE);
    pos = skipComment(src, pos);
    if (pos === before) return pos;
  }
}

// --- number / date regexes (sticky, anchored at `pos` like `Pattern.match(src, pos)`) ---------------------------------

const TIME_RE_STR = "([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\\.([0-9]{1,6})[0-9]*)?";
const RE_NUMBER = new RegExp(
  "0(?:x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|b[01](?:_?[01])*|o[0-7](?:_?[0-7])*)|" +
    "[+-]?(?:0|[1-9](?:_?[0-9])*)(?<floatpart>(?:\\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?)",
  "y",
);
const RE_LOCALTIME = new RegExp(TIME_RE_STR, "y");
const RE_DATETIME = new RegExp(
  "([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])" +
    `(?:[Tt ]${TIME_RE_STR}(?:([Zz])|([+-])([01][0-9]|2[0-3]):([0-5][0-9]))?)?`,
  "y",
);

function matchAt(re: RegExp, src: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(src);
}

function isLeap(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] as number;
}

/** `match_to_datetime`: `null` stands for Python's `ValueError`. */
function matchToDatetime(m: RegExpExecArray): TomlTemporal | null {
  const [, ys, ms, ds, hs, mins, ss, micros, zulu, signStr, offH, offM] = m;
  const year = Number(ys);
  const month = Number(ms);
  const day = Number(ds);
  if (year < 1 || day > daysInMonth(year, month)) return null;
  const date = `${ys}-${ms}-${ds}`;
  if (hs === undefined) return new TomlTemporal(date);
  let text = `${date} ${hs}:${mins}:${ss}`;
  if (micros) {
    const padded = micros.padEnd(6, "0");
    if (padded !== "000000") text += `.${padded}`;
  }
  if (signStr) text += Number(offH) === 0 && Number(offM) === 0 ? "+00:00" : `${signStr}${offH}:${offM}`;
  else if (zulu) text += "+00:00";
  return new TomlTemporal(text);
}

function matchToLocaltime(m: RegExpExecArray): TomlTemporal {
  const [, hs, mins, ss, micros] = m;
  let text = `${hs}:${mins}:${ss}`;
  if (micros) {
    const padded = micros.padEnd(6, "0");
    if (padded !== "000000") text += `.${padded}`;
  }
  return new TomlTemporal(text);
}

function pyIntFromMatch(text: string): number | bigint {
  const clean = text.replace(/_/g, "");
  const big = BigInt(clean);
  return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
}

function parseFloatText(text: string): PyFloat {
  const t = text.replace(/_/g, "");
  const low = t.toLowerCase();
  if (low === "inf" || low === "+inf") return new PyFloat(Infinity);
  if (low === "-inf") return new PyFloat(-Infinity);
  if (low === "nan" || low === "+nan" || low === "-nan") return new PyFloat(NaN);
  return new PyFloat(Number(t));
}

// --- statement rules ---------------------------------------------------------------------------------------------------

function createDictRule(src: string, pos: number, out: Output): [number, Key] {
  pos += 1;
  pos = skipChars(src, pos, TOML_WS);
  let key: Key;
  [pos, key] = parseKey(src, pos);

  if (out.flags.is_(key, EXPLICIT_NEST) || out.flags.is_(key, FROZEN)) {
    throw suffixedErr(src, pos, `Cannot declare ${keyRepr(key)} twice`);
  }
  out.flags.set(key, EXPLICIT_NEST, false);
  try {
    out.data.get_or_create_nest(key);
  } catch (e) {
    if (e instanceof KeyError) throw suffixedErr(src, pos, "Cannot overwrite a value");
    throw e;
  }
  if (!src.startsWith("]", pos)) throw suffixedErr(src, pos, "Expected ']' at the end of a table declaration");
  return [pos + 1, key];
}

function createListRule(src: string, pos: number, out: Output): [number, Key] {
  pos += 2;
  pos = skipChars(src, pos, TOML_WS);
  let key: Key;
  [pos, key] = parseKey(src, pos);

  if (out.flags.is_(key, FROZEN)) throw suffixedErr(src, pos, `Cannot mutate immutable namespace ${keyRepr(key)}`);
  out.flags.unset_all(key);
  out.flags.set(key, EXPLICIT_NEST, false);
  try {
    out.data.append_nest_to_list(key);
  } catch (e) {
    if (e instanceof KeyError) throw suffixedErr(src, pos, "Cannot overwrite a value");
    throw e;
  }
  if (!src.startsWith("]]", pos)) throw suffixedErr(src, pos, "Expected ']]' at the end of an array declaration");
  return [pos + 2, key];
}

function keyValueRule(src: string, pos: number, out: Output, header: Key): number {
  let key: Key;
  let value: unknown;
  [pos, key, value] = parseKeyValuePair(src, pos);
  const keyParent = key.slice(0, -1);
  const keyStem = key[key.length - 1] as string;
  const absKeyParent = [...header, ...keyParent];

  for (let i = 1; i < key.length; i++) {
    const contKey = [...header, ...key.slice(0, i)];
    if (out.flags.is_(contKey, EXPLICIT_NEST)) throw suffixedErr(src, pos, `Cannot redefine namespace ${keyRepr(contKey)}`);
    out.flags.add_pending(contKey, EXPLICIT_NEST);
  }

  if (out.flags.is_(absKeyParent, FROZEN)) {
    throw suffixedErr(src, pos, `Cannot mutate immutable namespace ${keyRepr(absKeyParent)}`);
  }

  let nest: Table;
  try {
    nest = out.data.get_or_create_nest(absKeyParent);
  } catch (e) {
    if (e instanceof KeyError) throw suffixedErr(src, pos, "Cannot overwrite a value");
    throw e;
  }
  if (nest.has(keyStem)) throw suffixedErr(src, pos, "Cannot overwrite a value");
  if (value instanceof Map || Array.isArray(value)) out.flags.set([...header, ...key], FROZEN, true);
  nest.set(keyStem, value);
  return pos;
}

function parseKeyValuePair(src: string, pos: number): [number, Key, unknown] {
  let key: Key;
  [pos, key] = parseKey(src, pos);
  if (src[pos] !== "=") throw suffixedErr(src, pos, "Expected '=' after a key in a key/value pair");
  pos += 1;
  pos = skipChars(src, pos, TOML_WS);
  let value: unknown;
  [pos, value] = parseValue(src, pos);
  return [pos, key, value];
}

function parseKey(src: string, pos: number): [number, Key] {
  let part: string;
  [pos, part] = parseKeyPart(src, pos);
  let key: string[] = [part];
  pos = skipChars(src, pos, TOML_WS);
  for (;;) {
    if (src[pos] !== ".") return [pos, key];
    pos += 1;
    pos = skipChars(src, pos, TOML_WS);
    [pos, part] = parseKeyPart(src, pos);
    key = [...key, part];
    if (key.length > MAX_KEY_PARTS) throw new RangeError(`TOML key has more than the allowed ${MAX_KEY_PARTS} parts`);
    pos = skipChars(src, pos, TOML_WS);
  }
}

function parseKeyPart(src: string, pos: number): [number, string] {
  const char = src[pos];
  if (char !== undefined && BARE_KEY_CHARS.has(char)) {
    const start = pos;
    pos = skipChars(src, pos, BARE_KEY_CHARS);
    return [pos, src.slice(start, pos)];
  }
  if (char === "'") return parseLiteralStr(src, pos);
  if (char === '"') return parseOneLineBasicStr(src, pos);
  throw suffixedErr(src, pos, "Invalid initial character for a key part");
}

function parseOneLineBasicStr(src: string, pos: number): [number, string] {
  return parseBasicStr(src, pos + 1, false);
}

function parseArray(src: string, pos: number): [number, unknown[]] {
  pos += 1;
  const array: unknown[] = [];
  pos = skipCommentsAndArrayWs(src, pos);
  if (src.startsWith("]", pos)) return [pos + 1, array];
  for (;;) {
    let val: unknown;
    [pos, val] = parseValue(src, pos);
    array.push(val);
    pos = skipCommentsAndArrayWs(src, pos);
    const c = src.slice(pos, pos + 1);
    if (c === "]") return [pos + 1, array];
    if (c !== ",") throw suffixedErr(src, pos, "Unclosed array");
    pos += 1;
    pos = skipCommentsAndArrayWs(src, pos);
    if (src.startsWith("]", pos)) return [pos + 1, array];
  }
}

function parseInlineTable(src: string, pos: number): [number, Table] {
  pos += 1;
  const nested = new NestedDict();
  const flags = new Flags();
  pos = skipChars(src, pos, TOML_WS);
  if (src.startsWith("}", pos)) return [pos + 1, nested.dict];
  for (;;) {
    let key: Key;
    let value: unknown;
    [pos, key, value] = parseKeyValuePair(src, pos);
    const keyParent = key.slice(0, -1);
    const keyStem = key[key.length - 1] as string;
    if (flags.is_(key, FROZEN)) throw suffixedErr(src, pos, `Cannot mutate immutable namespace ${keyRepr(key)}`);
    let nest: Table;
    try {
      nest = nested.get_or_create_nest(keyParent, false);
    } catch (e) {
      if (e instanceof KeyError) throw suffixedErr(src, pos, "Cannot overwrite a value");
      throw e;
    }
    if (nest.has(keyStem)) throw suffixedErr(src, pos, `Duplicate inline table key ${pyStrRepr(keyStem)}`);
    nest.set(keyStem, value);
    pos = skipChars(src, pos, TOML_WS);
    const c = src.slice(pos, pos + 1);
    if (c === "}") return [pos + 1, nested.dict];
    if (c !== ",") throw suffixedErr(src, pos, "Unclosed inline table");
    if (value instanceof Map || Array.isArray(value)) flags.set(key, FROZEN, true);
    pos += 1;
    pos = skipChars(src, pos, TOML_WS);
  }
}

function parseBasicStrEscape(src: string, pos: number, multiline = false): [number, string] {
  const escapeId = src.slice(pos, pos + 2);
  pos += 2;
  if (multiline && (escapeId === "\\ " || escapeId === "\\\t" || escapeId === "\\\n")) {
    if (escapeId !== "\\\n") {
      pos = skipChars(src, pos, TOML_WS);
      if (pos >= src.length) return [pos, ""];
      if (src[pos] !== "\n") throw suffixedErr(src, pos, "Unescaped '\\' in a string");
      pos += 1;
    }
    pos = skipChars(src, pos, TOML_WS_AND_NEWLINE);
    return [pos, ""];
  }
  if (escapeId === "\\u") return parseHexChar(src, pos, 4);
  if (escapeId === "\\U") return parseHexChar(src, pos, 8);
  const rep = Object.prototype.hasOwnProperty.call(BASIC_STR_ESCAPE_REPLACEMENTS, escapeId)
    ? BASIC_STR_ESCAPE_REPLACEMENTS[escapeId]
    : undefined;
  if (rep === undefined) throw suffixedErr(src, pos, "Unescaped '\\' in a string");
  return [pos, rep];
}

function parseHexChar(src: string, pos: number, hexLen: number): [number, string] {
  const hex = src.slice(pos, pos + hexLen);
  let ok = hex.length === hexLen;
  if (ok) for (const ch of hex) if (!HEXDIGIT_CHARS.has(ch)) ok = false;
  if (!ok) throw suffixedErr(src, pos, "Invalid hex value");
  pos += hexLen;
  const n = parseInt(hex, 16);
  if (!((n >= 0 && n <= 55295) || (n >= 57344 && n <= 1114111))) {
    throw suffixedErr(src, pos, "Escaped character is not a Unicode scalar value");
  }
  return [pos, String.fromCodePoint(n)];
}

function parseLiteralStr(src: string, pos: number): [number, string] {
  pos += 1;
  const start = pos;
  pos = skipUntil(src, pos, "'", ILLEGAL_LITERAL_STR_CHARS, true);
  return [pos + 1, src.slice(start, pos)];
}

function parseMultilineStr(src: string, pos: number, literal: boolean): [number, string] {
  pos += 3;
  if (src.startsWith("\n", pos)) pos += 1;
  let delim: string;
  let result: string;
  if (literal) {
    delim = "'";
    const endPos = skipUntil(src, pos, "'''", ILLEGAL_MULTILINE_LITERAL_STR_CHARS, true);
    result = src.slice(pos, endPos);
    pos = endPos + 3;
  } else {
    delim = '"';
    [pos, result] = parseBasicStr(src, pos, true);
  }
  if (!src.startsWith(delim, pos)) return [pos, result];
  pos += 1;
  if (!src.startsWith(delim, pos)) return [pos, result + delim];
  pos += 1;
  return [pos, result + delim.repeat(2)];
}

function parseBasicStr(src: string, pos: number, multiline: boolean): [number, string] {
  const errorOn = multiline ? ILLEGAL_MULTILINE_BASIC_STR_CHARS : ILLEGAL_BASIC_STR_CHARS;
  let result = "";
  let start = pos;
  for (;;) {
    if (pos >= src.length) throw suffixedErr(src, pos, "Unterminated string");
    const char = src[pos] as string;
    if (char === '"') {
      if (!multiline) return [pos + 1, result + src.slice(start, pos)];
      if (src.startsWith('"""', pos)) return [pos + 3, result + src.slice(start, pos)];
      pos += 1;
      continue;
    }
    if (char === "\\") {
      result += src.slice(start, pos);
      let parsed: string;
      [pos, parsed] = parseBasicStrEscape(src, pos, multiline);
      result += parsed;
      start = pos;
      continue;
    }
    if (errorOn.has(char)) throw suffixedErr(src, pos, `Illegal character ${pyStrRepr(char)}`);
    pos += 1;
  }
}

function parseValue(src: string, pos: number): [number, unknown] {
  const char = src[pos];

  if (char === '"') {
    if (src.startsWith('"""', pos)) return parseMultilineStr(src, pos, false);
    return parseOneLineBasicStr(src, pos);
  }
  if (char === "'") {
    if (src.startsWith("'''", pos)) return parseMultilineStr(src, pos, true);
    return parseLiteralStr(src, pos);
  }
  if (char === "t" && src.startsWith("true", pos)) return [pos + 4, true];
  if (char === "f" && src.startsWith("false", pos)) return [pos + 5, false];
  if (char === "[") return parseArray(src, pos);
  if (char === "{") return parseInlineTable(src, pos);

  const dt = matchAt(RE_DATETIME, src, pos);
  if (dt) {
    const obj = matchToDatetime(dt);
    if (obj === null) throw suffixedErr(src, pos, "Invalid date or datetime");
    return [pos + dt[0].length, obj];
  }
  const lt = matchAt(RE_LOCALTIME, src, pos);
  if (lt) return [pos + lt[0].length, matchToLocaltime(lt)];

  const num = matchAt(RE_NUMBER, src, pos);
  if (num) {
    const end = pos + num[0].length;
    if (num.groups?.["floatpart"]) return [end, parseFloatText(num[0])];
    return [end, pyIntFromMatch(num[0])];
  }

  const first3 = src.slice(pos, pos + 3);
  if (first3 === "inf" || first3 === "nan") return [pos + 3, parseFloatText(first3)];
  const first4 = src.slice(pos, pos + 4);
  if (first4 === "-inf" || first4 === "+inf" || first4 === "-nan" || first4 === "+nan") return [pos + 4, parseFloatText(first4)];

  throw suffixedErr(src, pos, "Invalid value");
}

/** `tomllib.loads(s)`. */
export function loads(s: string): Table {
  const src = s.replace(/\r\n/g, "\n");
  let pos = 0;
  const out: Output = { data: new NestedDict(), flags: new Flags() };
  let header: Key = [];

  for (;;) {
    pos = skipChars(src, pos, TOML_WS);
    if (pos >= src.length) break;
    let char = src[pos] as string;
    if (char === "\n") {
      pos += 1;
      continue;
    }
    if (KEY_INITIAL_CHARS.has(char)) {
      pos = keyValueRule(src, pos, out, header);
      pos = skipChars(src, pos, TOML_WS);
    } else if (char === "[") {
      const second = src[pos + 1];
      out.flags.finalize_pending();
      if (second === "[") [pos, header] = createListRule(src, pos, out);
      else [pos, header] = createDictRule(src, pos, out);
      pos = skipChars(src, pos, TOML_WS);
    } else if (char !== "#") {
      throw suffixedErr(src, pos, "Invalid statement");
    }

    pos = skipComment(src, pos);

    if (pos >= src.length) break;
    char = src[pos] as string;
    if (char !== "\n") throw suffixedErr(src, pos, "Expected newline or end of document after a statement");
    pos += 1;
  }
  return out.data.dict;
}

/**
 * `bytes.decode()` (strict UTF-8) with CPython's `UnicodeDecodeError` text; the BOM is kept like Python's `utf-8`
 * codec does.
 */
export function decodeUtf8Strict(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    throw new UnicodeDecodeError(describeUtf8Error(buf));
  }
}

function describeUtf8Error(buf: Buffer): string {
  const n = buf.length;
  let i = 0;
  const fail = (start: number, end: number, reason: string): string => {
    if (end === start + 1) {
      return `'utf-8' codec can't decode byte 0x${(buf[start] as number).toString(16).padStart(2, "0")} in position ${start}: ${reason}`;
    }
    return `'utf-8' codec can't decode bytes in position ${start}-${end - 1}: ${reason}`;
  };
  while (i < n) {
    const b = buf[i] as number;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    if (b < 0xc2 || b > 0xf4) return fail(i, i + 1, "invalid start byte");
    const need = b < 0xe0 ? 1 : b < 0xf0 ? 2 : 3;
    for (let k = 1; k <= need; k++) {
      if (i + k >= n) return fail(i, n, "unexpected end of data");
      const c = buf[i + k] as number;
      let lo = 0x80;
      let hi = 0xbf;
      if (k === 1) {
        if (b === 0xe0) lo = 0xa0;
        else if (b === 0xed) hi = 0x9f;
        else if (b === 0xf0) lo = 0x90;
        else if (b === 0xf4) hi = 0x8f;
      }
      if (c < lo || c > hi) return fail(i, i + k, "invalid continuation byte");
    }
    i += need + 1;
  }
  return "'utf-8' codec can't decode bytes: invalid data";
}

/** `tomllib.load(fp)`: decode the raw file bytes, then parse. */
export function loadBytes(buf: Buffer): Table {
  return loads(decodeUtf8Strict(buf));
}

/**
 * Port of the parts of `python-dotenv` 1.2.4 that `easy_sandbox` uses: `dotenv_values(path)` (parser, escape decoding,
 * `${VAR:-default}` interpolation with `override=True`, BOM strip, universal-newline reading, FIFO-aware file check).
 *
 * The returned mapping is a `Map` so that Python's `values.get(name)` / iteration order carry over unchanged.
 */

import * as fs from "node:fs";
import { UnicodeDecodeError, _utf8DecodeError } from "./_pyos.js";
import { pyRstrip } from "./_pyformat.js";
import { stdGetLogger } from "./logging.js";

const logger = stdGetLogger("dotenv.main");

/** One parse warning per path, mtime, size, and source line. A second read of the same file stays quiet. */
const _dotenvParseWarned = new Set<string>();

function warnDotenvParse(dotenvPath: string, line: number): void {
  let token = `${dotenvPath}\0${line}`;
  if (dotenvPath) {
    try {
      const st = fs.statSync(dotenvPath, { bigint: true });
      token = `${dotenvPath}\0${String(st.mtimeNs)}\0${String(st.size)}\0${line}`;
    } catch {
      /* path is not a stable file; fall back to the line token */
    }
  }
  if (_dotenvParseWarned.has(token)) return;
  _dotenvParseWarned.add(token);
  logger.warning("python-dotenv could not parse statement starting at line %s", line);
}

export class DotenvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Error";
  }
}

export { UnicodeDecodeError };

const sticky = (src: string, flags = ""): RegExp => new RegExp(src, `y${flags}u`);

// Python `re` `\s` (str.isspace) differs from JS `\s`: it has \x1c-\x1f and \x85 but not U+FEFF.
const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_WS_NO_NL = "\\t\\v\\f\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

const _multiline_whitespace = sticky(`[${PY_WS}]*`);
const _whitespace = sticky(`[${PY_WS_NO_NL}]*`);
const _export = sticky(`(?:export[${PY_WS_NO_NL}]+)?`);
const _single_quoted_key = sticky("'([^']+)'");
const _unquoted_key = sticky(`([^=#${PY_WS}]+)`);
const _equal_sign = sticky(`(=[${PY_WS_NO_NL}]*)`);
const _single_quoted_value = sticky("'((?:\\\\.|[^'\\\\])*)'", "s");
const _double_quoted_value = sticky('"((?:\\\\.|[^"\\\\])*)"', "s");
const _unquoted_value = sticky("([^\\r\\n]*)");
const _comment = sticky(`(?:[${PY_WS_NO_NL}]*#[^\\r\\n]*)?`);
const _end_of_line = sticky(`[${PY_WS_NO_NL}]*(?:\\r\\n|\\n|\\r|$)`);
const _rest_of_line = sticky("[^\\r\\n]*(?:\\r|\\n|\\r\\n)?");
const _double_quote_escapes = /\\[\\'"abfnrtv]/gu;
const _single_quote_escapes = /\\[\\']/gu;

export interface Original {
  string: string;
  line: number;
}

export interface Binding {
  key: string | null;
  value: string | null;
  original: Original;
  error: boolean;
}

const ESCAPES: Record<string, string> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

function decodeEscapes(regex: RegExp, s: string): string {
  return s.replace(regex, (m) => ESCAPES[m.slice(1)] as string);
}

function countNewlines(s: string): number {
  return (s.match(/\r\n|\n|\r/g) ?? []).length;
}

class Reader {
  readonly string: string;
  chars = 0;
  line = 1;
  markChars = 0;
  markLine = 1;

  constructor(text: string) {
    this.string = text.startsWith("\ufeff") ? text.slice(1) : text;
  }

  hasNext(): boolean {
    return this.chars < this.string.length;
  }

  setMark(): void {
    this.markChars = this.chars;
    this.markLine = this.line;
  }

  getMarked(): Original {
    return { string: this.string.slice(this.markChars, this.chars), line: this.markLine };
  }

  peek(count: number): string {
    return this.string.slice(this.chars, this.chars + count);
  }

  readRegex(regex: RegExp): string[] {
    regex.lastIndex = this.chars;
    const match = regex.exec(this.string);
    if (match === null) throw new DotenvParseError("read_regex: Pattern not found");
    const consumed = match[0];
    this.chars += consumed.length;
    this.line += countNewlines(consumed);
    return match.slice(1).map((g) => g as string);
  }
}

function parseKey(reader: Reader): string | null {
  const char = reader.peek(1);
  if (char === "#") return null;
  if (char === "'") return reader.readRegex(_single_quoted_key)[0] as string;
  return reader.readRegex(_unquoted_key)[0] as string;
}

function parseUnquotedValue(reader: Reader): string {
  const part = reader.readRegex(_unquoted_value)[0] as string;
  return pyRstrip(part.replace(new RegExp(`[${PY_WS}]+#[^\\n]*`, "u"), ""));
}

function parseValue(reader: Reader): string {
  const char = reader.peek(1);
  if (char === "'") {
    return decodeEscapes(_single_quote_escapes, reader.readRegex(_single_quoted_value)[0] as string);
  }
  if (char === '"') {
    return decodeEscapes(_double_quote_escapes, reader.readRegex(_double_quoted_value)[0] as string);
  }
  if (char === "" || char === "\n" || char === "\r") return "";
  return parseUnquotedValue(reader);
}

export function parseBinding(reader: Reader): Binding {
  reader.setMark();
  try {
    reader.readRegex(_multiline_whitespace);
    if (!reader.hasNext()) {
      return { key: null, value: null, original: reader.getMarked(), error: false };
    }
    reader.readRegex(_export);
    const key = parseKey(reader);
    reader.readRegex(_whitespace);
    let value: string | null;
    if (reader.peek(1) === "=") {
      const equalSign = reader.readRegex(_equal_sign)[0] as string;
      if (equalSign.length > 1 && reader.peek(1) === "#") value = "";
      else value = parseValue(reader);
    } else {
      value = null;
    }
    reader.readRegex(_comment);
    reader.readRegex(_end_of_line);
    return { key, value, original: reader.getMarked(), error: false };
  } catch (e) {
    if (!(e instanceof DotenvParseError)) throw e;
    reader.readRegex(_rest_of_line);
    return { key: null, value: null, original: reader.getMarked(), error: true };
  }
}

export function* parseStream(text: string): Generator<Binding> {
  const reader = new Reader(text);
  while (reader.hasNext()) yield parseBinding(reader);
}

const POSIX_VARIABLE = /\$\{([^}:]*)(?::-([^}]*))?\}/gu;

function resolveVariable(value: string, env: Map<string, string>): string {
  let out = "";
  let cursor = 0;
  POSIX_VARIABLE.lastIndex = 0;
  for (const m of value.matchAll(POSIX_VARIABLE)) {
    const start = m.index as number;
    if (start > cursor) out += value.slice(cursor, start);
    const name = m[1] as string;
    const dflt = m[2] !== undefined ? m[2] : "";
    out += env.has(name) ? (env.get(name) as string) : dflt;
    cursor = start + m[0].length;
  }
  if (cursor < value.length) out += value.slice(cursor);
  return out;
}

function isFileOrFifo(path: string): boolean {
  try {
    const st = fs.statSync(path);
    return st.isFile() || st.isFIFO();
  } catch {
    return false;
  }
}

function readTextUniversal(path: string): string {
  const buf = fs.readFileSync(path);
  const problem = _utf8DecodeError(buf);
  if (problem !== null) throw new UnicodeDecodeError(problem);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf).replace(/\r\n?/g, "\n");
}

export interface DotenvValuesOptions {
  stream?: string | null;
  interpolate?: boolean;
}

/** `dotenv.dotenv_values(dotenv_path, ...)` (`override=True`, `encoding="utf-8"`). */
export function dotenvValues(
  dotenvPath: string | { toString(): string } | null,
  opts: DotenvValuesOptions = {},
): Map<string, string | null> {
  const interpolate = opts.interpolate ?? true;
  let text = "";
  const p = dotenvPath === null ? "" : String(dotenvPath);
  if (p && isFileOrFifo(p)) text = readTextUniversal(p);
  else if (opts.stream !== undefined && opts.stream !== null) text = opts.stream.replace(/\r\n?/g, "\n");

  const raw: [string, string | null][] = [];
  for (const mapping of parseStream(text)) {
    if (mapping.error) warnDotenvParse(p, mapping.original.line);
    if (mapping.key !== null) raw.push([mapping.key, mapping.value]);
  }
  const out = new Map<string, string | null>();
  if (!interpolate) {
    for (const [k, v] of raw) out.set(k, v);
    return out;
  }
  for (const [name, value] of raw) {
    let result: string | null;
    if (value === null) result = null;
    else {
      const env = new Map<string, string>();
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env.set(k, v);
      for (const [k, v] of out) env.set(k, v ?? "");
      result = resolveVariable(value, env);
    }
    out.set(name, result);
  }
  return out;
}

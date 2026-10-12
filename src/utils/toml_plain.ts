/** TOML text/bytes as plain JS data (objects, arrays, numbers, strings) on top of the strict `_tomllib` port. */

import { PyFloat } from "./_pyformat.js";
import { TomlTemporal, loadBytes, loads } from "./_tomllib.js";

export interface PlainOptions {
  /** Keep TOML floats as `PyFloat` so `5.0` stays distinguishable from `5`. */
  keepFloats?: boolean;
}

export function tomlToPlain(v: unknown, opts: PlainOptions = {}): unknown {
  if (v instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, item] of v) {
      Object.defineProperty(out, k, { value: tomlToPlain(item, opts), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  if (v instanceof PyFloat) return opts.keepFloats ? v : v.value;
  if (v instanceof TomlTemporal) return v.text;
  if (Array.isArray(v)) return v.map((x) => tomlToPlain(x, opts));
  if (typeof v === "bigint") return Number(v);
  return v;
}

export function parseTomlText(text: string, opts: PlainOptions = {}): Record<string, unknown> {
  return tomlToPlain(loads(text), opts) as Record<string, unknown>;
}

export function parseTomlBytes(buf: Buffer, opts: PlainOptions = {}): Record<string, unknown> {
  return tomlToPlain(loadBytes(buf), opts) as Record<string, unknown>;
}

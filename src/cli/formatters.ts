/**
 * Output formatters for CLI commands (port of `cli/formatters.py`).
 *
 * Supports three modes: table, JSON, and quiet.
 *
 * ```ts
 * const fmt = getFormatter(ctx);
 * fmt.printTable(["ID", "Status"], rows);
 * ```
 */

import { type Context } from "./kit.js";
import { echo } from "./io.js";
import { pyEntries, pyStr } from "../utils/_pyformat.js";
import { orjsonDumps } from "./_orjson.js";
import { len } from "../utils/_py.js";
import { paint } from "./color.js";
import { renderTable } from "./table.js";
import { OUTPUT_META_KEY, type OutputManager } from "./output.js";

export interface OutputFormatterOptions {
  use_json?: boolean;
  quiet?: boolean;
  no_color?: boolean;
}

/** Base formatter that dispatches to the right format. */
export class OutputFormatter {
  use_json: boolean;
  quiet: boolean;
  no_color: boolean;

  constructor(opts: OutputFormatterOptions = {}) {
    this.use_json = opts.use_json ?? false;
    this.quiet = opts.quiet ?? false;
    this.no_color = opts.no_color ?? false;
  }

  /** Print a success message. */
  printSuccess(message: string): void {
    if (this.quiet) return;
    if (this.use_json) this._printJson(new Map<string, unknown>([["status", "success"], ["message", message]]));
    else _clickEchoGreen(message, this.no_color);
  }

  /** Print an error message with optional code and suggestion. */
  printError(message: string, opts: { suggestion?: string; code?: string } = {}): void {
    const { suggestion = "", code = "" } = opts;
    if (this.use_json) {
      const data = new Map<string, unknown>([["status", "error"], ["message", message]]);
      if (code) data.set("code", code);
      if (suggestion) data.set("suggestion", suggestion);
      this._printJson(data);
    } else {
      const parts: string[] = [];
      if (code) parts.push(`[${code}] `);
      parts.push(message);
      _clickEchoRed(parts.join(""), this.no_color);
      if (suggestion && !this.quiet) echo(`  Suggestion: ${suggestion}`, { err: true });
    }
  }

  /** Print data as a table, JSON, or quiet tab-separated. */
  printTable(headers: string[], rows: string[][]): void {
    if (this.use_json) {
      const items = rows.map((row) => {
        const item = new Map<string, unknown>();
        const n = Math.min(headers.length, row.length);
        for (let i = 0; i < n; i++) item.set(headers[i] as string, row[i]);
        return item;
      });
      this._printJson(items);
      return;
    }
    if (this.quiet) {
      for (const row of rows) echo(row.join("\t"));
      return;
    }
    echo(renderTable(headers, rows, this.no_color ? undefined : (text) => paint(text, "bold")));
  }

  /** Print a dict as key-value pairs, JSON, or quiet values. */
  printDict(data: Record<string, unknown> | Map<string, unknown>): void {
    const entries: Array<[string, unknown]> = data instanceof Map ? [...data.entries()] : pyEntries(data);
    if (this.use_json) {
      this._printJson(data);
      return;
    }
    if (this.quiet) {
      for (const [, v] of entries) echo(pyStr(v));
      return;
    }
    let maxKeyLen = 0;
    for (const [k] of entries) maxKeyLen = Math.max(maxKeyLen, len(pyStr(k)));
    for (const [k, v] of entries) {
      const key = pyStr(k);
      echo(`${key}${" ".repeat(Math.max(0, maxKeyLen - len(key)))}  ${pyStr(v)}`);
    }
  }

  /** Print raw data (for JSON mode mostly). */
  printData(data: unknown): void {
    if (this.use_json) this._printJson(data);
    else echo(pyStr(data));
  }

  /** Print data as indent-2 JSON (`orjson.dumps(data, option=OPT_INDENT_2)`, errors included). */
  _printJson(data: unknown): void {
    echo(orjsonDumps(data));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

export function _clickEchoGreen(msg: string, noColor = false): void {
  if (noColor) echo(msg);
  else echo(paint(msg, "green"));
}

export function _clickEchoRed(msg: string, noColor = false): void {
  if (noColor) echo(msg, { err: true });
  else echo(paint(msg, "red"), { err: true });
}

/**
 * Get an {@link OutputFormatter} from the Click context.
 *
 * When the {@link OutputManager} is available in `ctx.meta` the legacy formatter is configured from it; otherwise this
 * falls back to the `ctx.obj` dict (`json`, `quiet`, `no_color`).
 */
export function getFormatter(ctx: Context | null | undefined): OutputFormatter {
  const mgr = ctx ? (ctx.meta[OUTPUT_META_KEY] as OutputManager | undefined) : undefined;
  if (mgr !== undefined && mgr !== null) {
    return new OutputFormatter({ use_json: mgr.jsonMode, quiet: mgr.quiet, no_color: mgr.noColor });
  }
  const obj = (ctx ? ctx.obj : null) ?? {};
  return new OutputFormatter({
    use_json: Boolean(obj["json"] ?? false),
    quiet: Boolean(obj["quiet"] ?? false),
    no_color: Boolean(obj["no_color"] ?? false),
  });
}

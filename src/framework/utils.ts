/**
 * Port of `click/utils.py` + the style helpers of `click/termui.py` (Click 8.5) that the CLI uses:
 * `echo`, `style`, `secho`, `unstyle`, `format_filename`, `make_str`, `_make_default_short_help`, plus the Python
 * exit/interrupt exception types the framework needs (`SystemExit`, `KeyboardInterrupt`, `EOFError`).
 */

import { isatty, sys, type TextOutput } from "./io.js";
import { resolveColorDefault } from "./globals.js";
import { stripAnsi } from "./formatting.js";
import { pyStr, splitWhitespace } from "./py.js";

/** Python `SystemExit`: thrown by `sysExit()`; `Command.main` and `CliRunner` translate it into an exit code. */
export class SystemExit extends Error {
  readonly code: number | string | null;
  constructor(code: number | string | null = null) {
    super(`SystemExit: ${String(code)}`);
    this.name = "SystemExit";
    this.code = code;
  }
}

/** `sys.exit(code)`. */
export function sysExit(code: number | string | null = null): never {
  throw new SystemExit(code);
}

/** Python `KeyboardInterrupt` (Ctrl+C). */
export class KeyboardInterrupt extends Error {
  constructor() {
    super("KeyboardInterrupt");
    this.name = "KeyboardInterrupt";
  }
}

/** Python `EOFError` (stdin closed while a prompt was waiting). */
export class EOFError extends Error {
  constructor(message = "EOF when reading a line") {
    super(message);
    this.name = "EOFError";
  }
}

/** Python `OSError` carrying an `errno`-like code (used for the EPIPE handling in `Command.main`). */
export class OSError extends Error {
  errno?: number;
  code?: string;
  constructor(message: string, errno?: number, code?: string) {
    super(message);
    this.name = "OSError";
    this.errno = errno;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// ANSI policy
// ---------------------------------------------------------------------------

type StripPolicy = (stream: unknown, color: boolean | null) => boolean;

let stripPolicyOverride: StripPolicy | null = null;

/** Replace the "should this stream have its ANSI codes stripped" policy (used by `CliRunner`). Returns the old one. */
export function setShouldStripAnsi(policy: StripPolicy | null): StripPolicy | null {
  const old = stripPolicyOverride;
  stripPolicyOverride = policy;
  return old;
}

/** `click._compat.should_strip_ansi`. */
export function shouldStripAnsi(stream: unknown = null, color: boolean | null = null): boolean {
  if (stripPolicyOverride) return stripPolicyOverride(stream, color);
  if (color === null) {
    return !isatty(stream as { isatty?: () => boolean } | null);
  }
  return !color;
}

// ---------------------------------------------------------------------------
// echo / style
// ---------------------------------------------------------------------------

export interface EchoOptions {
  file?: TextOutput | null;
  nl?: boolean;
  err?: boolean;
  color?: boolean | null;
}

/** `click.echo(message, file=None, nl=True, err=False, color=None)`. */
export function echo(message: unknown = null, opts: EchoOptions = {}): void {
  const { nl = true, err = false } = opts;
  const file: TextOutput | null = opts.file ?? (err ? sys.stderr : sys.stdout);
  if (file === null) return;

  let out: string;
  if (message === null || message === undefined) out = "";
  else if (typeof message === "string") out = message;
  else out = pyStr(message);

  if (nl) out += "\n";
  if (!out) {
    file.flush();
    return;
  }
  if (shouldStripAnsi(file, resolveColorDefault(opts.color ?? null))) out = stripAnsi(out);
  file.write(out);
  file.flush();
}

const ANSI_COLORS: Record<string, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  reset: 39,
  bright_black: 90,
  bright_red: 91,
  bright_green: 92,
  bright_yellow: 93,
  bright_blue: 94,
  bright_magenta: 95,
  bright_cyan: 96,
  bright_white: 97,
};
const ANSI_RESET_ALL = "\x1b[0m";

export type ColorSpec = number | [number, number, number] | string;

function interpretColor(color: ColorSpec, offset = 0): string {
  if (typeof color === "string" && color in ANSI_COLORS) return String((ANSI_COLORS[color] as number) + offset);
  if (typeof color === "number") {
    if (Number.isInteger(color) && color >= 0 && color <= 255) return `${38 + offset};5;${color}`;
  } else if (Array.isArray(color) && color.length === 3 && color.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) {
    return `${38 + offset};2;${color[0]};${color[1]};${color[2]}`;
  }
  throw new Error(`ValueError: Unknown color '${String(color)}'`);
}

export interface StyleOptions {
  fg?: ColorSpec | null;
  bg?: ColorSpec | null;
  bold?: boolean | null;
  dim?: boolean | null;
  underline?: boolean | null;
  overline?: boolean | null;
  italic?: boolean | null;
  blink?: boolean | null;
  reverse?: boolean | null;
  strikethrough?: boolean | null;
  reset?: boolean;
}

/** `click.style(text, fg=..., bg=..., bold=..., ...)`. */
export function style(text: unknown, opts: StyleOptions = {}): string {
  const t = typeof text === "string" ? text : pyStr(text);
  const bits: string[] = [];
  const isSet = (v: unknown): boolean => v !== undefined && v !== null;
  if (isSet(opts.fg)) bits.push(`\x1b[${interpretColor(opts.fg as ColorSpec)}m`);
  if (isSet(opts.bg)) bits.push(`\x1b[${interpretColor(opts.bg as ColorSpec, 10)}m`);
  if (isSet(opts.bold)) bits.push(`\x1b[${opts.bold ? 1 : 22}m`);
  if (isSet(opts.dim)) bits.push(`\x1b[${opts.dim ? 2 : 22}m`);
  if (isSet(opts.underline)) bits.push(`\x1b[${opts.underline ? 4 : 24}m`);
  if (isSet(opts.overline)) bits.push(`\x1b[${opts.overline ? 53 : 55}m`);
  if (isSet(opts.italic)) bits.push(`\x1b[${opts.italic ? 3 : 23}m`);
  if (isSet(opts.blink)) bits.push(`\x1b[${opts.blink ? 5 : 25}m`);
  if (isSet(opts.reverse)) bits.push(`\x1b[${opts.reverse ? 7 : 27}m`);
  if (isSet(opts.strikethrough)) bits.push(`\x1b[${opts.strikethrough ? 9 : 29}m`);
  bits.push(t);
  if (opts.reset ?? true) bits.push(ANSI_RESET_ALL);
  return bits.join("");
}

/** `click.unstyle`. */
export function unstyle(text: string): string {
  return stripAnsi(text);
}

/** `click.secho`. */
export function secho(message: unknown, opts: EchoOptions & StyleOptions = {}): void {
  const { file, nl, err, color, ...styles } = opts;
  if (message !== null && message !== undefined) message = style(message, styles);
  echo(message, { file, nl, err, color });
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------

/** `click.utils.format_filename(filename)`. */
export function formatFilename(filename: string, shorten = false): string {
  if (shorten) {
    const idx = Math.max(filename.lastIndexOf("/"), process.platform === "win32" ? filename.lastIndexOf("\\") : -1);
    filename = filename.slice(idx + 1);
  }
  return filename;
}

/** `click.utils.make_str`. */
export function makeStr(value: unknown): string {
  return typeof value === "string" ? value : pyStr(value);
}

/** `click.utils._make_default_short_help`. */
export function makeDefaultShortHelp(help: string, maxLength = 45): string {
  const paragraphEnd = help.indexOf("\n\n");
  if (paragraphEnd !== -1) help = help.slice(0, paragraphEnd);
  let words = splitWhitespace(help);
  if (!words.length) return "";
  if (words[0] === "\b") words = words.slice(1);

  let totalLength = 0;
  const lastIndex = words.length - 1;
  let i = 0;
  let truncated = false;
  for (i = 0; i < words.length; i++) {
    const word = words[i] as string;
    totalLength += [...word].length + (i > 0 ? 1 : 0);
    if (totalLength > maxLength) {
      truncated = true;
      break;
    }
    if (word[word.length - 1] === ".") return words.slice(0, i + 1).join(" ");
    if (totalLength === maxLength && i !== lastIndex) {
      truncated = true;
      break;
    }
  }
  if (!truncated) return words.join(" ");

  totalLength += 3;
  while (i > 0) {
    totalLength -= [...(words[i] as string)].length + (i > 0 ? 1 : 0);
    if (totalLength <= maxLength) break;
    i -= 1;
  }
  return `${words.slice(0, i).join(" ")}...`;
}

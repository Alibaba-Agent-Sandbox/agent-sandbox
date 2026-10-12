/**
 * Port of `click/exceptions.py` (Click 8.5): the exception hierarchy and the exact message formats.
 *
 * Differences forced by TypeScript are limited to `NoArgsIsHelpError`, whose help text is rendered asynchronously
 * (lazy command groups load their sub-commands with dynamic `import()`); build it with `await
 * NoArgsIsHelpError.create(ctx)`.
 */

import type { Command, Context, Parameter } from "./core.js";
import { resolveColorDefault } from "./globals.js";
import { sys, type TextOutput } from "./io.js";
import { getCloseMatches } from "./difflib.js";
import { pyStrRepr, sortedStrings } from "./py.js";
import { echo, formatFilename } from "./utils.js";

function reprAll(items: Iterable<string>): string {
  return [...items].map(pyStrRepr).join(", ");
}

/** `_join_param_hints`. */
export function joinParamHints(paramHint: readonly string[] | string | null | undefined): string | null {
  if (paramHint !== null && paramHint !== undefined && typeof paramHint !== "string") {
    return paramHint.map(pyStrRepr).join(" / ");
  }
  return paramHint ?? null;
}

/** `_format_possibilities`. */
export function formatPossibilities(possibilities: string[]): string {
  const possibilityStr = reprAll(sortedStrings(possibilities));
  if (possibilities.length === 1) return `Did you mean ${possibilityStr}?`;
  return `(Did you mean one of: ${possibilityStr}?)`;
}

/** `click.ClickException`: shown as `Error: <message>` on stderr, exit code 1. */
export class ClickException extends Error {
  static exit_code = 1;
  readonly show_color: boolean | null;
  readonly message: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    this.show_color = resolveColorDefault();
    this.message = message;
  }

  get exit_code(): number {
    return (this.constructor as typeof ClickException).exit_code;
  }

  formatMessage(): string {
    return this.message;
  }

  toString(): string {
    return this.message;
  }

  show(file: TextOutput | null = null): void {
    if (file === null) file = sys.stderr;
    echo(`Error: ${this.formatMessage()}`, { file, color: this.show_color });
  }
}

/** `click.UsageError`: shows the usage line + "Try '<cmd> --help' for help." and exits with code 2. */
export class UsageError extends ClickException {
  static override exit_code = 2;
  ctx: Context | null;
  cmd: Command | null;

  constructor(message: string, ctx: Context | null = null) {
    super(message);
    this.ctx = ctx;
    this.cmd = this.ctx ? this.ctx.command : null;
  }

  override show(file: TextOutput | null = null): void {
    if (file === null) file = sys.stderr;
    let color: boolean | null = null;
    let hint = "";
    if (this.ctx !== null && this.ctx.command.getHelpOption(this.ctx) !== null) {
      const helpNames = this.ctx.command.getHelpOptionNames(this.ctx);
      // Longest help option name; ties resolve to the first one like Python's `max(..., key=len)`.
      let longest = helpNames[0] as string;
      for (const n of helpNames) if ([...n].length > [...longest].length) longest = n;
      hint = `Try '${this.ctx.commandPath} ${longest}' for help.`;
      hint = `${hint}\n`;
    }
    if (this.ctx !== null) {
      color = this.ctx.color;
      echo(`${this.ctx.getUsage()}\n${hint}`, { file, color });
    }
    echo(`Error: ${this.formatMessage()}`, { file, color });
  }
}

/** `click.BadParameter`. */
export class BadParameter extends UsageError {
  param: Parameter | null;
  param_hint: readonly string[] | string | null;

  constructor(
    message: string,
    ctx: Context | null = null,
    param: Parameter | null = null,
    paramHint: readonly string[] | string | null = null,
  ) {
    super(message, ctx);
    this.param = param;
    this.param_hint = paramHint;
  }

  override formatMessage(): string {
    let paramHint: readonly string[] | string | null;
    if (this.param_hint !== null) paramHint = this.param_hint;
    else if (this.param !== null) paramHint = this.param.getErrorHint(this.ctx);
    else return `Invalid value: ${this.message}`;
    return `Invalid value for ${joinParamHints(paramHint)}: ${this.message}`;
  }
}

/** `click.MissingParameter`. */
export class MissingParameter extends BadParameter {
  readonly param_type: string | null;

  constructor(
    message: string | null = null,
    ctx: Context | null = null,
    param: Parameter | null = null,
    paramHint: readonly string[] | string | null = null,
    paramType: string | null = null,
  ) {
    super(message || "", ctx, param, paramHint);
    this.param_type = paramType;
  }

  override formatMessage(): string {
    let hintSrc: readonly string[] | string | null;
    if (this.param_hint !== null) hintSrc = this.param_hint;
    else if (this.param !== null) hintSrc = this.param.getErrorHint(this.ctx);
    else hintSrc = null;

    const joined = joinParamHints(hintSrc);
    const paramHint = joined ? ` ${joined}` : "";

    let paramType = this.param_type;
    if (paramType === null && this.param !== null) paramType = this.param.param_type_name;

    let msg = this.message;
    if (this.param !== null) {
      const msgExtra = this.param.type.getMissingMessage(this.param, this.ctx);
      if (msgExtra) {
        if (msg) msg += `. ${msgExtra}`;
        else msg = msgExtra;
      }
    }
    msg = msg ? ` ${msg}` : "";

    let missing: string;
    if (paramType === "argument") missing = "Missing argument";
    else if (paramType === "option") missing = "Missing option";
    else if (paramType === "parameter") missing = "Missing parameter";
    else missing = `Missing ${paramType}`;

    return `${missing}${paramHint}.${msg}`;
  }

  override toString(): string {
    if (!this.message) {
      const paramName = this.param ? this.param.name : null;
      return `Missing parameter: ${paramName === null ? "None" : paramName}`;
    }
    return this.message;
  }
}

/** `click.NoSuchOption`. */
export class NoSuchOption extends UsageError {
  readonly option_name: string;
  readonly possibilities: string[] | null;

  constructor(
    optionName: string,
    message: string | null = null,
    possibilities: Iterable<string> | null = null,
    ctx: Context | null = null,
  ) {
    super(message ?? `No such option ${pyStrRepr(optionName)}.`, ctx);
    this.option_name = optionName;
    const list = possibilities ? [...possibilities] : [];
    this.possibilities = list.length ? getCloseMatches(optionName, list) : null;
  }

  override formatMessage(): string {
    if (!this.possibilities || !this.possibilities.length) return this.message;
    return `${this.message} ${formatPossibilities(this.possibilities)}`;
  }
}

/** `click.NoSuchCommand` (Click 8.5 raises it from `Group.resolve_command`). */
export class NoSuchCommand extends UsageError {
  readonly command_name: string;
  readonly possibilities: string[] | null;

  constructor(
    commandName: string,
    message: string | null = null,
    possibilities: Iterable<string> | null = null,
    ctx: Context | null = null,
  ) {
    super(message ?? `No such command ${pyStrRepr(commandName)}.`, ctx);
    this.command_name = commandName;
    const list = possibilities ? [...possibilities] : [];
    this.possibilities = list.length ? getCloseMatches(commandName, list) : null;
  }

  override formatMessage(): string {
    if (!this.possibilities || !this.possibilities.length) return this.message;
    return `${this.message} ${formatPossibilities(this.possibilities)}`;
  }
}

/** `click.BadOptionUsage`. */
export class BadOptionUsage extends UsageError {
  readonly option_name: string;
  constructor(optionName: string, message: string, ctx: Context | null = null) {
    super(message, ctx);
    this.option_name = optionName;
  }
}

/** `click.BadArgumentUsage`. */
export class BadArgumentUsage extends UsageError {}

/** `click.exceptions.NoArgsIsHelpError`: shows the help page instead of an error (`no_args_is_help=True`). */
export class NoArgsIsHelpError extends UsageError {
  declare ctx: Context;

  constructor(ctx: Context, help: string) {
    super(help, ctx);
  }

  /** The Python constructor calls `ctx.get_help()`; here that is asynchronous, hence a factory. */
  static async create(ctx: Context): Promise<NoArgsIsHelpError> {
    return new NoArgsIsHelpError(ctx, await ctx.getHelp());
  }

  override show(file: TextOutput | null = null): void {
    echo(this.formatMessage(), { file, err: true, color: this.ctx.color });
  }
}

/** `click.FileError`. */
export class FileError extends ClickException {
  readonly ui_filename: string;
  readonly filename: string;

  constructor(filename: string, hint: string | null = null) {
    super(hint ?? "unknown error");
    this.ui_filename = formatFilename(filename);
    this.filename = filename;
  }

  override formatMessage(): string {
    return `Could not open file ${pyStrRepr(this.ui_filename)}: ${this.message}`;
  }
}

/** `click.Abort`: raised on Ctrl+C / refused confirmation; `Command.main` prints "Aborted!" and exits 1. */
export class Abort extends Error {
  constructor(message = "") {
    super(message);
    this.name = "Abort";
  }
}

/** `click.exceptions.Exit`: `ctx.exit(code)`. */
export class Exit extends Error {
  readonly exit_code: number;
  constructor(code = 0) {
    super(`Exit(${code})`);
    this.name = "Exit";
    this.exit_code = code;
  }
}

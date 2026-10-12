/**
 * Port of `click/core.py` (Click 8.5): `Context`, `Command`, `Group`, `Parameter`, `Option`, `Argument`.
 *
 * Conventions (see `src/cli/commands/README.md` for the full guide):
 *  - option/argument/command *attributes* keep Click's snake_case names (`is_flag`, `help_option_names`, ...);
 *  - methods are camelCase (`ctx.getHelp()`, `group.addCommand()`);
 *  - Python `None` is `null`, "no value yet" is the `UNSET` sentinel, tuples are arrays;
 *  - everything that may call user code or load a lazy command is `async` (callbacks, parsing, invoking, help
 *    rendering of groups);
 *  - a command callback has the signature `(ctx, params) => unknown | Promise<unknown>` where `params` holds the
 *    values by parameter name (what Click passes as `**kwargs`), and `ctx` is what `@click.pass_context` injects.
 */

import { Abort, BadParameter, ClickException, Exit, MissingParameter, NoArgsIsHelpError, NoSuchCommand, UsageError } from "./exceptions.js";
import { HelpFormatter, joinOptions, splitOpt } from "./formatting.js";
import { contextStorage } from "./globals.js";
import { sys } from "./io.js";
import { OptionParser } from "./parser.js";
import { capitalize, cleandoc, cmpStr, isIdentifier, len, pyStr, pyStrRepr } from "./py.js";
import { FLAG_NEEDS_VALUE, UNSET } from "./sentinels.js";
import { confirm, prompt } from "./termui.js";
import { BOOL, BoolParamType, FLOAT, INT, IntRange, ParamType, STRING, StringParamType, UNPROCESSED, ValueError, convertType, isNumberRange } from "./types.js";
import { EOFError, KeyboardInterrupt, OSError, SystemExit, echo, makeDefaultShortHelp, makeStr, style, sysExit } from "./utils.js";
import { warn } from "./warnings.js";
import * as nodePath from "node:path";
import * as fs from "node:fs";

export { UNSET, FLAG_NEEDS_VALUE };

/** Values of a command's parameters, by name. */
export type Params = Record<string, any>;

/** A command callback: `(ctx, params)`. */
export type Callback = (ctx: Context, params: Params) => unknown;

const HELP_OPTION_STORAGE_NAME = "_click_default_help";

function formatDeprecatedLabel(deprecated: boolean | string): string {
  const label = "DEPRECATED";
  if (typeof deprecated === "string") return `(${label}: ${deprecated})`;
  return `(${label})`;
}

function formatDeprecatedSuffix(deprecated: boolean | string): string {
  if (typeof deprecated === "string") return ` ${deprecated}`;
  return "";
}

function batch<V>(iterable: readonly V[], batchSize: number): V[][] {
  const out: V[][] = [];
  for (let i = 0; i + batchSize <= iterable.length; i += batchSize) out.push(iterable.slice(i, i + batchSize));
  return out;
}

/** `augment_usage_errors(ctx, param)` as a wrapper: attaches the context / parameter to usage errors. */
export async function augmentUsageErrors<T>(ctx: Context, param: Parameter | null, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BadParameter) {
      if (e.ctx === null) e.ctx = ctx;
      if (param !== null && e.param === null) e.param = param;
    } else if (e instanceof UsageError) {
      if (e.ctx === null) e.ctx = ctx;
    }
    throw e;
  }
}

/** `iter_params_for_processing`: eager parameters first, then in invocation order, then declaration order. */
export function iterParamsForProcessing(invocationOrder: readonly Parameter[], declarationOrder: readonly Parameter[]): Parameter[] {
  const keyed = declarationOrder.map((item, i) => {
    const idx = invocationOrder.indexOf(item);
    return { item, eager: !item.is_eager, idx: idx < 0 ? Number.POSITIVE_INFINITY : idx, i };
  });
  keyed.sort((a, b) => {
    if (a.eager !== b.eager) return a.eager ? 1 : -1;
    if (a.idx !== b.idx) return a.idx < b.idx ? -1 : 1;
    return a.i - b.i;
  });
  return keyed.map((k) => k.item);
}

/** `click.core.ParameterSource` (numeric order matters: lower = more explicit). */
export enum ParameterSource {
  COMMANDLINE = 1,
  ENVIRONMENT = 2,
  DEFAULT_MAP = 3,
  DEFAULT = 4,
  PROMPT = 5,
}

export interface ContextOptions {
  parent?: Context | null;
  info_name?: string | null;
  obj?: any;
  auto_envvar_prefix?: string | null;
  default_map?: Record<string, any> | null;
  terminal_width?: number | null;
  max_content_width?: number | null;
  resilient_parsing?: boolean;
  allow_extra_args?: boolean | null;
  allow_interspersed_args?: boolean | null;
  ignore_unknown_options?: boolean | null;
  help_option_names?: string[] | null;
  token_normalize_func?: ((token: string) => string) | null;
  color?: boolean | null;
  show_default?: boolean | null;
}

type CloseCallback = () => unknown;

/** `click.Context`: the state of one command invocation. */
export class Context {
  static formatter_class: new (opts: { width?: number | null; max_width?: number | null }) => HelpFormatter = HelpFormatter;

  parent: Context | null;
  command: Command;
  info_name: string | null;
  params: Params = {};
  args: string[] = [];
  _protected_args: string[] = [];
  _opt_prefixes: Set<string>;
  obj: any;
  _meta: Record<string, any>;
  default_map: Record<string, any> | null;
  invoked_subcommand: string | null = null;
  terminal_width: number | null;
  max_content_width: number | null;
  allow_extra_args: boolean;
  allow_interspersed_args: boolean;
  ignore_unknown_options: boolean;
  help_option_names: string[];
  token_normalize_func: ((token: string) => string) | null;
  resilient_parsing: boolean;
  auto_envvar_prefix: string | null;
  color: boolean | null;
  show_default: boolean | null;
  _close_callbacks: CloseCallback[] = [];
  _pending_close: Array<Promise<unknown>> = [];
  _depth = 0;
  _parameter_source: Map<string, ParameterSource> = new Map();
  _param_default_explicit: Map<string, boolean> = new Map();

  constructor(command: Command, opts: ContextOptions = {}) {
    const parent = opts.parent ?? null;
    this.parent = parent;
    this.command = command;
    this.info_name = opts.info_name ?? null;
    this._opt_prefixes = parent ? new Set(parent._opt_prefixes) : new Set();

    let obj = opts.obj ?? null;
    if (obj === null && parent !== null) obj = parent.obj;
    this.obj = obj;
    this._meta = parent ? parent.meta : {};

    let defaultMap = opts.default_map ?? null;
    if (defaultMap === null && this.info_name !== null && parent !== null && parent.default_map !== null) {
      defaultMap = parent.default_map[this.info_name] ?? null;
    }
    this.default_map = defaultMap;

    let terminalWidth = opts.terminal_width ?? null;
    if (terminalWidth === null && parent !== null) terminalWidth = parent.terminal_width;
    this.terminal_width = terminalWidth;

    let maxContentWidth = opts.max_content_width ?? null;
    if (maxContentWidth === null && parent !== null) maxContentWidth = parent.max_content_width;
    this.max_content_width = maxContentWidth;

    this.allow_extra_args = opts.allow_extra_args ?? command.allow_extra_args;
    this.allow_interspersed_args = opts.allow_interspersed_args ?? command.allow_interspersed_args;
    this.ignore_unknown_options = opts.ignore_unknown_options ?? command.ignore_unknown_options;

    let helpOptionNames = opts.help_option_names ?? null;
    if (helpOptionNames === null) {
      helpOptionNames = parent !== null ? parent.help_option_names : ["--help"];
    }
    this.help_option_names = helpOptionNames;

    let tokenNormalize = opts.token_normalize_func ?? null;
    if (tokenNormalize === null && parent !== null) tokenNormalize = parent.token_normalize_func;
    this.token_normalize_func = tokenNormalize;

    this.resilient_parsing = opts.resilient_parsing ?? false;

    let autoEnvvarPrefix = opts.auto_envvar_prefix ?? null;
    if (autoEnvvarPrefix === null) {
      if (parent !== null && parent.auto_envvar_prefix !== null && this.info_name !== null) {
        autoEnvvarPrefix = `${parent.auto_envvar_prefix}_${this.info_name.toUpperCase()}`;
      }
    } else {
      autoEnvvarPrefix = autoEnvvarPrefix.toUpperCase();
    }
    if (autoEnvvarPrefix !== null) autoEnvvarPrefix = autoEnvvarPrefix.replace(/-/g, "_");
    this.auto_envvar_prefix = autoEnvvarPrefix;

    let color = opts.color ?? null;
    if (color === null && parent !== null) color = parent.color;
    this.color = color;

    let showDefault = opts.show_default ?? null;
    if (showDefault === null && parent !== null) showDefault = parent.show_default;
    this.show_default = showDefault;
  }

  /** `ctx.meta`: a dict shared with all parent / child contexts. */
  get meta(): Record<string, any> {
    return this._meta;
  }

  toInfoDict(): Record<string, unknown> {
    return {
      command: this.command.toInfoDict(this),
      info_name: this.info_name,
      allow_extra_args: this.allow_extra_args,
      allow_interspersed_args: this.allow_interspersed_args,
      ignore_unknown_options: this.ignore_unknown_options,
      auto_envvar_prefix: this.auto_envvar_prefix,
    };
  }

  /** `with ctx:`. Runs `fn` with this context as the current one; closes the context when the outermost scope exits. */
  async run<T>(fn: (ctx: Context) => Promise<T> | T): Promise<T> {
    this._depth += 1;
    let failure: { error: unknown } | null = null;
    try {
      return await contextStorage.run(this, async () => fn(this));
    } catch (e) {
      failure = { error: e };
      throw e;
    } finally {
      this._depth -= 1;
      if (this._depth === 0) await this._closeWithExceptionInfo(failure);
    }
  }

  /** `with ctx.scope(cleanup=...):`. */
  async scope<T>(fn: (ctx: Context) => Promise<T> | T, cleanup = true): Promise<T> {
    if (!cleanup) this._depth += 1;
    try {
      return await this.run(fn);
    } finally {
      if (!cleanup) this._depth -= 1;
    }
  }

  makeFormatter(): HelpFormatter {
    return new (this.constructor as typeof Context).formatter_class({
      width: this.terminal_width,
      max_width: this.max_content_width,
    });
  }

  /** `ctx.with_resource(cm)`: enters a resource, closes it with the context. */
  withResource<V>(resource: { enter(): V; exit(): unknown }): V {
    const v = resource.enter();
    this.callOnClose(() => resource.exit());
    return v;
  }

  /** `ctx.call_on_close(f)`. */
  callOnClose<F extends CloseCallback>(f: F): F {
    this._close_callbacks.push(f);
    return f;
  }

  /** `ctx.close()`. Callbacks run in reverse registration order. */
  close(): void {
    const errors: unknown[] = [];
    while (this._close_callbacks.length) {
      const cb = this._close_callbacks.pop() as CloseCallback;
      try {
        const r = cb();
        if (r instanceof Promise) this._pending_close.push(r);
      } catch (e) {
        errors.push(e);
      }
    }
    if (errors.length) throw errors[0];
  }

  async _closeWithExceptionInfo(_failure: { error: unknown } | null): Promise<void> {
    let first: { error: unknown } | null = null;
    try {
      this.close();
    } catch (e) {
      first = { error: e };
    }
    const pending = this._pending_close;
    this._pending_close = [];
    for (const p of pending) {
      try {
        await p;
      } catch (e) {
        first ??= { error: e };
      }
    }
    if (first !== null) throw first.error;
  }

  get commandPath(): string {
    let rv = "";
    if (this.info_name !== null) rv = this.info_name;
    if (this.parent !== null) {
      const parentCommandPath: string[] = [this.parent.commandPath];
      if (this.parent.command instanceof Command) {
        for (const param of this.parent.command.getParams(this)) {
          parentCommandPath.push(...param.getUsagePieces(this));
        }
      }
      rv = `${parentCommandPath.join(" ")} ${rv}`;
    }
    return rv.replace(/^[ \t\n\r\x0b\x0c]+/, "");
  }

  findRoot(): Context {
    let node: Context = this;
    while (node.parent !== null) node = node.parent;
    return node;
  }

  /** `ctx.find_object(type)`. With `Object` it finds the nearest plain-dict `obj` (what `ensure_object(dict)` does). */
  findObject<V>(objectType: new (...args: any[]) => V): V | null {
    let node: Context | null = this;
    while (node !== null) {
      if (matchesType(node.obj, objectType)) return node.obj as V;
      node = node.parent;
    }
    return null;
  }

  /** `ctx.ensure_object(type)`. */
  ensureObject<V>(objectType: new (...args: any[]) => V): V {
    let rv = this.findObject(objectType);
    if (rv === null) {
      rv = new objectType();
      this.obj = rv;
    }
    return rv;
  }

  _defaultMapHas(name: string | null): boolean {
    return (
      name !== null &&
      this.default_map !== null &&
      Object.prototype.hasOwnProperty.call(this.default_map, name) &&
      this.default_map[name] !== UNSET
    );
  }

  lookupDefault(name: string, call = true): any {
    if (!this._defaultMapHas(name)) return null;
    const value = (this.default_map as Record<string, any>)[name];
    if (call && typeof value === "function") return value();
    return value;
  }

  fail(message: string): never {
    throw new UsageError(message, this);
  }

  abort(): never {
    throw new Abort();
  }

  exit(code = 0): never {
    this.close();
    throw new Exit(code);
  }

  getUsage(): string {
    return this.command.getUsage(this);
  }

  getHelp(): Promise<string> {
    return this.command.getHelp(this);
  }

  _makeSubContext(command: Command): Context {
    return new (this.constructor as typeof Context)(command, { info_name: command.name, parent: this });
  }

  /**
   * `ctx.invoke(callback, ...)`.
   *  - `invoke(command, kwargs?)` calls the command's callback in a sub-context, filling in the defaults of
   *    parameters not present in `kwargs` (Click 8 semantics).
   *  - `invoke(fn, ...args)` calls `fn(...args)` with this context active.
   */
  invoke(callback: Command, kwargs?: Params): Promise<any>;
  invoke<R>(callback: (...args: any[]) => R | Promise<R>, ...args: any[]): Promise<R>;
  async invoke(callback: Command | ((...args: any[]) => unknown), ...rest: any[]): Promise<any> {
    if (callback instanceof Command) {
      const otherCmd = callback;
      const kwargs: Params = { ...((rest[0] as Params | undefined) ?? {}) };
      if (otherCmd.callback === null) {
        throw new TypeError("The given command does not have a callback that can be invoked.");
      }
      const fn = otherCmd.callback;
      const ctx = this._makeSubContext(otherCmd);
      for (const param of otherCmd.params) {
        if (!(param.name in kwargs) && param.expose_value) {
          let defaultValue = param.getDefault(ctx);
          if (defaultValue === UNSET) defaultValue = null;
          kwargs[param.name] = param.typeCastValue(ctx, defaultValue);
        }
      }
      Object.assign(ctx.params, kwargs);
      return await augmentUsageErrors(this, null, () => ctx.run(() => fn(ctx, kwargs)));
    }
    const fn = callback;
    return await augmentUsageErrors(this, null, () => this.run(() => fn(...rest)));
  }

  /** `ctx.forward(cmd, kwargs?)`: `invoke` with this context's params as defaults. */
  async forward(cmd: Command, kwargs: Params = {}): Promise<any> {
    if (!(cmd instanceof Command)) throw new TypeError("Callback is not a command.");
    const merged: Params = { ...kwargs };
    for (const key of Object.keys(this.params)) {
      if (!(key in merged)) merged[key] = this.params[key];
    }
    return this.invoke(cmd, merged);
  }

  setParameterSource(name: string, source: ParameterSource): void {
    this._parameter_source.set(name, source);
  }

  getParameterSource(name: string): ParameterSource | null {
    return this._parameter_source.get(name) ?? null;
  }
}

function matchesType(obj: unknown, type: new (...args: any[]) => unknown): boolean {
  if (type === (Object as unknown)) return obj !== null && typeof obj === "object" && !Array.isArray(obj) && isPlainObject(obj);
  if (type === (Array as unknown)) return Array.isArray(obj);
  return obj instanceof type;
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export interface CommandAttrs {
  context_settings?: Record<string, any> | null;
  callback?: Callback | null;
  params?: Parameter[] | null;
  help?: string | null;
  epilog?: string | null;
  short_help?: string | null;
  options_metavar?: string | null;
  add_help_option?: boolean;
  no_args_is_help?: boolean | null;
  hidden?: boolean;
  deprecated?: boolean | string;
}

/** `click.Command`. */
export class Command {
  static context_class: typeof Context = Context;
  allow_extra_args = false;
  allow_interspersed_args = true;
  ignore_unknown_options = false;

  name: string | null;
  context_settings: Record<string, any>;
  callback: Callback | null;
  params: Parameter[];
  help: string | null;
  epilog: string | null;
  options_metavar: string | null;
  short_help: string | null;
  add_help_option: boolean;
  _help_option: Option | null = null;
  no_args_is_help: boolean;
  hidden: boolean;
  deprecated: boolean | string;

  constructor(name: string | null, attrs: CommandAttrs = {}) {
    this.name = name;
    this.context_settings = attrs.context_settings ?? {};
    this.callback = attrs.callback ?? null;
    this.params = attrs.params ?? [];
    this.help = attrs.help ?? null;
    this.epilog = attrs.epilog ?? null;
    this.options_metavar = attrs.options_metavar === undefined ? "[OPTIONS]" : attrs.options_metavar;
    this.short_help = attrs.short_help ?? null;
    this.add_help_option = attrs.add_help_option ?? true;
    this.no_args_is_help = attrs.no_args_is_help ?? false;
    this.hidden = attrs.hidden ?? false;
    this.deprecated = attrs.deprecated ?? false;
  }

  toInfoDict(ctx: Context): Record<string, unknown> {
    return {
      name: this.name,
      params: this.getParams(ctx).map((p) => p.toInfoDict()),
      help: this.help,
      epilog: this.epilog,
      short_help: this.short_help,
      hidden: this.hidden,
      deprecated: this.deprecated,
    };
  }

  toString(): string {
    return `<${this.constructor.name} ${this.name}>`;
  }

  getUsage(ctx: Context): string {
    const formatter = ctx.makeFormatter();
    this.formatUsage(ctx, formatter);
    return formatter.getvalue().replace(/\n+$/, "");
  }

  getParams(ctx: Context): Parameter[] {
    let params = this.params;
    const helpOption = this.getHelpOption(ctx);
    if (helpOption !== null) params = [...params, helpOption];

    const opts = params.flatMap((p) => p.opts);
    const optCounts = new Map<string, number>();
    for (const o of opts) optCounts.set(o, (optCounts.get(o) ?? 0) + 1);
    for (const [opt, count] of optCounts) {
      if (count > 1) warn(`The parameter ${opt} is used more than once. Remove its duplicate as parameters should be unique.`);
    }

    const nameCounts = new Map<string, number>();
    for (const p of params) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
    for (const [dup, count] of nameCounts) {
      if (count <= 1) continue;
      const sharers = params.filter((p) => p.name === dup);
      if (helpOption !== null && sharers.includes(helpOption)) {
        warn(`The name ${pyStrRepr(dup)} is reserved for the automatic help option. Give the parameter a different name.`);
      } else if (sharers.some((p) => p instanceof Argument)) {
        warn(
          `The name ${pyStrRepr(dup)} is used by an argument and another parameter. They will overwrite each other's value during parsing. Give each parameter a unique name.`,
        );
      }
    }
    return params;
  }

  formatUsage(ctx: Context, formatter: HelpFormatter): void {
    const pieces = this.collectUsagePieces(ctx);
    formatter.writeUsage(ctx.commandPath, pieces.join(" "));
  }

  collectUsagePieces(ctx: Context): string[] {
    const rv: string[] = this.options_metavar ? [this.options_metavar] : [];
    for (const param of this.getParams(ctx)) rv.push(...param.getUsagePieces(ctx));
    return rv;
  }

  getHelpOptionNames(ctx: Context): string[] {
    const all = new Set(ctx.help_option_names);
    for (const param of this.params) {
      for (const name of [...param.opts, ...param.secondary_opts]) all.delete(name);
    }
    return [...all];
  }

  getHelpOption(ctx: Context): Option | null {
    const names = this.getHelpOptionNames(ctx);
    if (!names.length || !this.add_help_option) return null;
    if (this._help_option === null) {
      this._help_option = new Option([...names, HELP_OPTION_STORAGE_NAME], {
        is_flag: true,
        expose_value: false,
        is_eager: true,
        help: "Show this message and exit.",
        callback: showHelp,
      });
    }
    return this._help_option;
  }

  makeParser(ctx: Context): OptionParser {
    const parser = new OptionParser(ctx);
    for (const param of this.getParams(ctx)) param.addToParser(parser, ctx);
    return parser;
  }

  async getHelp(ctx: Context): Promise<string> {
    const formatter = ctx.makeFormatter();
    await this.formatHelp(ctx, formatter);
    return formatter.getvalue().replace(/\n+$/, "");
  }

  getShortHelpStr(limit = 45): string {
    let text: string;
    if (this.short_help) text = cleandoc(this.short_help);
    else if (this.help) text = makeDefaultShortHelp(this.help, limit);
    else text = "";
    if (this.deprecated) text = `${text} ${formatDeprecatedLabel(this.deprecated)}`;
    return text.trim();
  }

  async formatHelp(ctx: Context, formatter: HelpFormatter): Promise<void> {
    this.formatUsage(ctx, formatter);
    this.formatHelpText(ctx, formatter);
    this.formatArguments(ctx, formatter);
    await this.formatOptions(ctx, formatter);
    this.formatEpilog(ctx, formatter);
  }

  formatHelpText(_ctx: Context, formatter: HelpFormatter): void {
    let text: string;
    if (this.help !== null) text = cleandoc(this.help).split("\f")[0] as string;
    else text = "";
    if (this.deprecated) {
      const label = formatDeprecatedLabel(this.deprecated);
      text = text ? `${text} ${label}` : label;
    }
    if (text) {
      formatter.writeParagraph();
      formatter.indentation(() => formatter.writeText(text));
    }
  }

  async formatOptions(ctx: Context, formatter: HelpFormatter): Promise<void> {
    const opts: Array<[string, string]> = [];
    for (const param of this.getParams(ctx)) {
      const rv = param.getHelpRecord(ctx);
      if (rv !== null && !(param instanceof Argument)) opts.push(rv);
    }
    if (opts.length) formatter.section("Options", () => formatter.writeDl(opts));
  }

  formatArguments(ctx: Context, formatter: HelpFormatter): void {
    const args: Array<[string, string]> = [];
    for (const param of this.getParams(ctx)) {
      const rv = param.getHelpRecord(ctx);
      if (rv !== null && param instanceof Argument) args.push(rv);
    }
    if (args.length) formatter.section("Positional arguments", () => formatter.writeDl(args));
  }

  formatEpilog(_ctx: Context, formatter: HelpFormatter): void {
    if (this.epilog) {
      const epilog = cleandoc(this.epilog);
      formatter.writeParagraph();
      formatter.indentation(() => formatter.writeText(epilog));
    }
  }

  async makeContext(infoName: string | null, args: string[], parent: Context | null = null, extra: ContextOptions = {}): Promise<Context> {
    const merged: ContextOptions = { ...this.context_settings, ...extra };
    const ctx = new (this.constructor as typeof Command).context_class(this, { ...merged, info_name: infoName, parent });
    await ctx.scope(async () => {
      await this.parseArgs(ctx, args);
    }, false);
    return ctx;
  }

  async parseArgs(ctx: Context, args: string[]): Promise<string[]> {
    if (!args.length && this.no_args_is_help && !ctx.resilient_parsing) {
      throw await NoArgsIsHelpError.create(ctx);
    }
    const parser = this.makeParser(ctx);
    const [opts, restArgs, paramOrder] = parser.parseArgs(args);
    args = restArgs;

    for (const param of iterParamsForProcessing(paramOrder, this.getParams(ctx))) {
      [, args] = await param.handleParseResult(ctx, opts, args);
    }

    for (const name of Object.keys(ctx.params)) {
      if (ctx.params[name] === UNSET) ctx.params[name] = null;
    }

    if (args.length && !ctx.allow_extra_args && !ctx.resilient_parsing) {
      const n = args.length;
      ctx.fail(`Got unexpected extra argument${n === 1 ? "" : "s"} (${args.map((a) => makeStr(a)).join(" ")})`);
    }

    ctx.args = args;
    for (const p of parser.opt_prefixes) ctx._opt_prefixes.add(p);
    return args;
  }

  async invoke(ctx: Context): Promise<any> {
    if (this.deprecated) {
      const message = `DeprecationWarning: The command ${pyStrRepr(this.name ?? "None")} is deprecated.${formatDeprecatedSuffix(this.deprecated)}`;
      echo(style(message, { fg: "red" }), { err: true });
    }
    if (this.callback !== null) {
      return ctx.invoke(this.callback, ctx, ctx.params);
    }
    return undefined;
  }

  /**
   * `Command.main()`: parse `args`, run the command, and (standalone mode) turn the outcome into a `SystemExit`
   * exactly like Click: usage errors print help hints and exit 2, `Abort` prints "Aborted!" and exits 1, ...
   * Throws `SystemExit` in standalone mode; with `standalone_mode: false` it returns the command's value.
   */
  async main(opts: MainOptions = {}): Promise<any> {
    const {
      standalone_mode: standaloneMode = true,
      windows_expand_args: windowsExpandArgs = true,
      complete_var: _completeVar,
      args: argsOpt,
      prog_name: progNameOpt,
      ...extra
    } = opts;
    let args: string[];
    if (argsOpt === undefined || argsOpt === null) {
      args = process.argv.slice(2);
      if (process.platform === "win32" && windowsExpandArgs) args = expandArgs(args);
    } else {
      args = [...argsOpt];
    }
    const progName = progNameOpt ?? detectProgramName();

    try {
      try {
        const ctx = await this.makeContext(progName, args, null, extra);
        return await ctx.run(async () => {
          const rv = await this.invoke(ctx);
          if (!standaloneMode) return rv;
          ctx.exit();
        });
      } catch (e) {
        if (e instanceof EOFError || e instanceof KeyboardInterrupt) {
          echo(null, { file: sys.stderr });
          throw new Abort();
        }
        if (e instanceof ClickException) {
          if (!standaloneMode) throw e;
          e.show();
          return sysExit(e.exit_code);
        }
        if (e instanceof OSError && (e.errno === 32 || e.code === "EPIPE")) {
          return sysExit(1);
        }
        if ((e as { code?: string } | null)?.code === "EPIPE") {
          return sysExit(1);
        }
        throw e;
      }
    } catch (e) {
      if (e instanceof Exit) {
        if (standaloneMode) return sysExit(e.exit_code);
        return e.exit_code;
      }
      if (e instanceof Abort) {
        if (!standaloneMode) throw e;
        echo("Aborted!", { file: sys.stderr });
        return sysExit(1);
      }
      throw e;
    }
  }
}

export interface MainOptions extends ContextOptions {
  args?: readonly string[] | null;
  prog_name?: string | null;
  complete_var?: string | null;
  standalone_mode?: boolean;
  windows_expand_args?: boolean;
}

/** `click.utils._detect_program_name` for a Node entry point. */
export function detectProgramName(path: string | null = null): string {
  const p = path || process.argv[1] || "";
  return nodePath.basename(p).replace(/\.(?:[cm]?js|ts)$/, "");
}

/** `click.utils._expand_args`: user (`~`), env (`$VAR`) and glob expansion (used on Windows only). */
export function expandArgs(args: readonly string[], user = true, env = true): string[] {
  const out: string[] = [];
  for (let arg of args) {
    if (user && (arg === "~" || arg.startsWith("~/") || arg.startsWith("~\\"))) {
      arg = (process.env.HOME ?? process.env.USERPROFILE ?? "~") + arg.slice(1);
    }
    if (env) {
      arg = arg.replace(/\$(\w+)|\$\{([^}]*)\}|%([^%]+)%/g, (m, a, b, c) => process.env[(a ?? b ?? c) as string] ?? m);
    }
    let matches: string[] = [];
    if (/[*?[]/.test(arg)) {
      try {
        const globSync = (fs as unknown as { globSync?: (p: string) => string[] }).globSync;
        matches = globSync ? globSync(arg) : [];
      } catch {
        matches = [];
      }
    }
    if (!matches.length) out.push(arg);
    else out.push(...matches);
  }
  return out;
}

async function showHelp(ctx: Context, _param: Parameter, value: unknown): Promise<void> {
  if (value && !ctx.resilient_parsing) {
    echo(await ctx.getHelp(), { color: ctx.color });
    ctx.exit();
  }
}

export interface GroupAttrs extends CommandAttrs {
  commands?: Map<string, Command> | Record<string, Command> | Command[] | null;
  invoke_without_command?: boolean;
  subcommand_metavar?: string | null;
  chain?: boolean;
  result_callback?: ((value: any, ctx: Context, params: Params) => unknown) | null;
}

function checkNestedChain(baseCommand: Group, cmdName: string, cmd: Command, register = false): void {
  if (!baseCommand.chain || !(cmd instanceof Group)) return;
  let message: string;
  if (register) {
    message = `It is not possible to add the group ${pyStrRepr(cmdName)} to another group ${pyStrRepr(baseCommand.name ?? "None")} that is in chain mode.`;
  } else {
    message = `Found the group ${pyStrRepr(cmdName)} as subcommand to another group  ${pyStrRepr(baseCommand.name ?? "None")} that is in chain mode. This is not supported.`;
  }
  throw new Error(`RuntimeError: ${message}`);
}

/** `click.Group`. */
export class Group extends Command {
  override allow_extra_args = true;
  override allow_interspersed_args = false;
  static command_class: (new (name: string, attrs: CommandAttrs) => Command) | null = null;
  static group_class: (new (name: string, attrs: GroupAttrs) => Group) | "type" | null = null;

  commands: Map<string, Command>;
  invoke_without_command: boolean;
  subcommand_metavar: string;
  chain: boolean;
  _result_callback: ((value: any, ctx: Context, params: Params) => unknown) | null;

  constructor(name: string | null = null, attrs: GroupAttrs = {}) {
    const { commands, invoke_without_command, chain, result_callback, ...rest } = attrs;
    let subcommand_metavar = attrs.subcommand_metavar;
    super(name, rest);

    let cmds: Map<string, Command>;
    if (commands === undefined || commands === null) cmds = new Map();
    else if (commands instanceof Map) cmds = commands;
    else if (Array.isArray(commands)) {
      cmds = new Map();
      for (const c of commands) if (c.name !== null) cmds.set(c.name, c);
    } else cmds = new Map(Object.entries(commands));
    this.commands = cmds;

    this.invoke_without_command = invoke_without_command ?? false;
    this.no_args_is_help = attrs.no_args_is_help ?? !this.invoke_without_command;

    this.chain = chain ?? false;
    if (subcommand_metavar === undefined || subcommand_metavar === null) {
      if (this.chain) {
        subcommand_metavar = this.invoke_without_command
          ? "[COMMAND1] [ARGS]... [COMMAND2 [ARGS]...]..."
          : "COMMAND1 [ARGS]... [COMMAND2 [ARGS]...]...";
      } else if (this.invoke_without_command) subcommand_metavar = "[COMMAND] [ARGS]...";
      else subcommand_metavar = "COMMAND [ARGS]...";
    }
    this.subcommand_metavar = subcommand_metavar;
    this._result_callback = result_callback ?? null;

    if (this.chain) {
      for (const param of this.params) {
        if (param instanceof Argument && !param.required) {
          throw new Error("RuntimeError: A group in chain mode cannot have optional arguments.");
        }
      }
    }
  }

  async toInfoDictAsync(ctx: Context): Promise<Record<string, unknown>> {
    const info = super.toInfoDict(ctx);
    const commands: Record<string, unknown> = {};
    for (const name of await this.listCommands(ctx)) {
      const command = await this.getCommand(ctx, name);
      if (command === null) continue;
      const subCtx = ctx._makeSubContext(command);
      commands[name] = await subCtx.scope(() => command.toInfoDict(subCtx), false);
    }
    return { ...info, commands, chain: this.chain };
  }

  addCommand(cmd: Command, name: string | null = null): void {
    const n = name || cmd.name;
    if (n === null || n === undefined) throw new TypeError("Command has no name.");
    checkNestedChain(this, n, cmd, true);
    this.commands.set(n, cmd);
  }

  /** `@group.command(name, **attrs)`: build a command and register it. */
  command(name: string, attrs: CommandAttrs & { cls?: new (name: string, attrs: CommandAttrs) => Command } = {}): Command {
    const { cls, ...rest } = attrs;
    const klass = cls ?? (this.constructor as typeof Group).command_class ?? Command;
    const cmd = new klass(name, rest);
    this.addCommand(cmd);
    return cmd;
  }

  /** `@group.group(name, **attrs)`: build a sub-group and register it. */
  group(name: string, attrs: GroupAttrs & { cls?: new (name: string, attrs: GroupAttrs) => Group } = {}): Group {
    const { cls, ...rest } = attrs;
    let klass = cls;
    if (klass === undefined) {
      const gc = (this.constructor as typeof Group).group_class;
      if (gc === "type") klass = this.constructor as new (name: string, attrs: GroupAttrs) => Group;
      else klass = gc ?? Group;
    }
    const cmd = new klass(name, rest);
    this.addCommand(cmd);
    return cmd;
  }

  /** `@group.result_callback(replace=False)`. */
  resultCallback(f: (value: any, ctx: Context, params: Params) => unknown, replace = false): typeof f {
    const old = this._result_callback;
    if (old === null || replace) {
      this._result_callback = f;
      return f;
    }
    const fn = async (value: any, ctx: Context, params: Params): Promise<unknown> => {
      const inner = await old(value, ctx, params);
      return f(inner, ctx, params);
    };
    this._result_callback = fn;
    return fn;
  }

  async getCommand(_ctx: Context, cmdName: string): Promise<Command | null> {
    return this.commands.get(cmdName) ?? null;
  }

  async listCommands(_ctx: Context): Promise<string[]> {
    return [...this.commands.keys()].sort(cmpStr);
  }

  override collectUsagePieces(ctx: Context): string[] {
    const rv = super.collectUsagePieces(ctx);
    rv.push(this.subcommand_metavar);
    return rv;
  }

  override async formatOptions(ctx: Context, formatter: HelpFormatter): Promise<void> {
    await super.formatOptions(ctx, formatter);
    await this.formatCommands(ctx, formatter);
  }

  async formatCommands(ctx: Context, formatter: HelpFormatter): Promise<void> {
    const commands: Array<[string, Command]> = [];
    for (const subcommand of await this.listCommands(ctx)) {
      const cmd = await this.getCommand(ctx, subcommand);
      if (cmd === null) continue;
      if (cmd.hidden) continue;
      commands.push([subcommand, cmd]);
    }
    if (commands.length) {
      const limit = formatter.width - 6 - Math.max(...commands.map((c) => len(c[0])));
      const rows: Array<[string, string]> = commands.map(([sub, cmd]) => [sub, cmd.getShortHelpStr(limit)]);
      if (rows.length) formatter.section("Commands", () => formatter.writeDl(rows));
    }
  }

  override async parseArgs(ctx: Context, args: string[]): Promise<string[]> {
    if (!args.length && this.no_args_is_help && !ctx.resilient_parsing) {
      throw await NoArgsIsHelpError.create(ctx);
    }
    const rest = await super.parseArgs(ctx, args);
    if (this.chain) {
      ctx._protected_args = rest;
      ctx.args = [];
    } else if (rest.length) {
      ctx._protected_args = rest.slice(0, 1);
      ctx.args = rest.slice(1);
    }
    return ctx.args;
  }

  override async invoke(ctx: Context): Promise<any> {
    const processResult = async (value: any): Promise<any> => {
      if (this._result_callback !== null) {
        value = await ctx.invoke(this._result_callback, value, ctx, ctx.params);
      }
      return value;
    };

    if (!ctx._protected_args.length) {
      if (this.invoke_without_command) {
        return await ctx.run(async () => {
          const rv = await super.invoke(ctx);
          return await processResult(this.chain ? [] : rv);
        });
      }
      ctx.fail("Missing command.");
    }

    let args = [...ctx._protected_args, ...ctx.args];
    ctx.args = [];
    ctx._protected_args = [];

    if (!this.chain) {
      return await ctx.run(async () => {
        const [cmdName, cmd, restArgs] = await this.resolveCommand(ctx, args);
        ctx.invoked_subcommand = cmdName;
        await super.invoke(ctx);
        const subCtx = await (cmd as Command).makeContext(cmdName, restArgs, ctx);
        return await subCtx.run(async () => processResult(await subCtx.command.invoke(subCtx)));
      });
    }

    return await ctx.run(async () => {
      ctx.invoked_subcommand = args.length ? "*" : null;
      await super.invoke(ctx);

      const contexts: Context[] = [];
      while (args.length) {
        const [cmdName, cmd, restArgs] = await this.resolveCommand(ctx, args);
        const subCtx = await (cmd as Command).makeContext(cmdName, restArgs, ctx, {
          allow_extra_args: true,
          allow_interspersed_args: false,
        });
        contexts.push(subCtx);
        args = subCtx.args;
        subCtx.args = [];
      }

      const rv: unknown[] = [];
      for (const subCtx of contexts) {
        rv.push(await subCtx.run(() => subCtx.command.invoke(subCtx)));
      }
      return await processResult(rv);
    });
  }

  async resolveCommand(ctx: Context, args: string[]): Promise<[string | null, Command | null, string[]]> {
    let cmdName = makeStr(args[0]);
    let cmd = await this.getCommand(ctx, cmdName);
    if (cmd === null && ctx.token_normalize_func !== null) {
      cmdName = ctx.token_normalize_func(cmdName);
      cmd = await this.getCommand(ctx, cmdName);
    }
    if (cmd === null && !ctx.resilient_parsing) {
      if (splitOpt(cmdName)[0]) await this.parseArgs(ctx, args);
      throw new NoSuchCommand(cmdName, null, this.commands.keys(), ctx);
    }
    return [cmd ? cmdName : null, cmd, args.slice(1)];
  }
}

/** `click.CommandCollection`. */
export class CommandCollection extends Group {
  sources: Group[];

  constructor(name: string | null = null, attrs: GroupAttrs & { sources?: Group[] | null } = {}) {
    const { sources, ...rest } = attrs;
    super(name, rest);
    this.sources = sources ?? [];
  }

  addSource(group: Group): void {
    this.sources.push(group);
  }

  override async getCommand(ctx: Context, cmdName: string): Promise<Command | null> {
    const rv = await super.getCommand(ctx, cmdName);
    if (rv !== null) return rv;
    for (const source of this.sources) {
      const found = await source.getCommand(ctx, cmdName);
      if (found !== null) {
        if (this.chain) checkNestedChain(this, cmdName, found);
        return found;
      }
    }
    return null;
  }

  override async listCommands(ctx: Context): Promise<string[]> {
    const rv = new Set<string>(await super.listCommands(ctx));
    for (const source of this.sources) for (const n of await source.listCommands(ctx)) rv.add(n);
    return [...rv].sort(cmpStr);
  }
}

export interface ParameterAttrs {
  type?: unknown;
  required?: boolean;
  default?: any;
  callback?: ((ctx: Context, param: Parameter, value: any) => any) | null;
  nargs?: number | null;
  multiple?: boolean;
  metavar?: string | null;
  expose_value?: boolean;
  is_eager?: boolean;
  envvar?: string | readonly string[] | null;
  deprecated?: boolean | string;
}

/** `click.Parameter` (abstract). */
export abstract class Parameter {
  get param_type_name(): string {
    return "parameter";
  }
  name: string;
  opts: string[];
  secondary_opts: string[];
  type: ParamType;
  required: boolean;
  callback: ((ctx: Context, param: Parameter, value: any) => any) | null;
  nargs: number;
  multiple: boolean;
  expose_value: boolean;
  default: any;
  _default_explicit: boolean;
  is_eager: boolean;
  metavar: string | null;
  envvar: string | readonly string[] | null;
  deprecated: boolean | string;

  constructor(paramDecls: readonly string[] | string | null = null, attrs: ParameterAttrs = {}) {
    const decls = paramDecls === null ? [] : typeof paramDecls === "string" ? [paramDecls] : paramDecls;
    const exposeValue = attrs.expose_value ?? true;
    [this.name, this.opts, this.secondary_opts] = this.parseDecls(decls, exposeValue);
    const deflt = attrs.default === undefined ? UNSET : attrs.default;
    this.type = convertType(attrs.type ?? null, deflt === UNSET ? null : deflt);

    let nargs = attrs.nargs ?? null;
    if (nargs === null) nargs = this.type.is_composite ? this.type.arity : 1;

    this.required = attrs.required ?? false;
    this.callback = attrs.callback ?? null;
    this.nargs = nargs;
    this.multiple = attrs.multiple ?? false;
    this.expose_value = exposeValue;
    this.default = deflt;
    this._default_explicit = deflt !== UNSET;
    this.is_eager = attrs.is_eager ?? false;
    this.metavar = attrs.metavar ?? null;
    this.envvar = attrs.envvar ?? null;
    this.deprecated = attrs.deprecated ?? false;

    if (this.type.is_composite && nargs !== this.type.arity) {
      throw new ValueError(`'nargs' must be ${this.type.arity} (or None) for type ${String(this.type)}, but it was ${nargs}.`);
    }
    if (this.required && this.deprecated) {
      throw new ValueError(
        `The ${this.param_type_name} '${this.humanReadableName}' is deprecated and still required. A deprecated ${this.param_type_name} cannot be required.`,
      );
    }
  }

  static hideUnset(value: any): any {
    return value === UNSET ? null : value;
  }

  toInfoDict(): Record<string, unknown> {
    return {
      name: this.name,
      param_type_name: this.param_type_name,
      opts: this.opts,
      secondary_opts: this.secondary_opts,
      type: this.type.toInfoDict(),
      required: this.required,
      nargs: this.nargs,
      multiple: this.multiple,
      default: Parameter.hideUnset(this.default),
      envvar: this.envvar,
    };
  }

  toString(): string {
    return `<${this.constructor.name} ${this.name}>`;
  }

  protected abstract parseDecls(decls: readonly string[], exposeValue: boolean): [string, string[], string[]];

  get humanReadableName(): string {
    return this.name;
  }

  makeMetavar(ctx: Context): string {
    if (this.metavar !== null) return this.metavar;
    let metavar = this.type.getMetavar(this, ctx);
    if (metavar === null) metavar = this.type.name.toUpperCase();
    if (this.nargs !== 1) metavar += "...";
    return metavar;
  }

  getDefault(ctx: Context, call = true): any {
    let value = ctx.lookupDefault(this.name, false);
    if (value === null && !ctx._defaultMapHas(this.name)) value = this.default;
    if (call && typeof value === "function") value = value();
    return value;
  }

  abstract addToParser(parser: OptionParser, ctx: Context): void;

  consumeValue(ctx: Context, opts: Record<string, any>): [any, ParameterSource] {
    let value: any = Object.prototype.hasOwnProperty.call(opts, this.name) ? opts[this.name] : UNSET;
    let source = value !== UNSET ? ParameterSource.COMMANDLINE : ParameterSource.DEFAULT;

    if (value === UNSET) {
      const envvarValue = this.valueFromEnvvar(ctx);
      if (envvarValue !== null) {
        value = envvarValue;
        source = ParameterSource.ENVIRONMENT;
      }
    }

    if (value === UNSET) {
      const defaultMapValue = ctx.lookupDefault(this.name);
      if (defaultMapValue !== null || ctx._defaultMapHas(this.name)) {
        value = defaultMapValue;
        source = ParameterSource.DEFAULT_MAP;
        if (typeof value === "string" && this.nargs !== 1) value = this.type.splitEnvvarValue(value);
      }
    }

    if (value === UNSET) {
      const defaultValue = this.getDefault(ctx);
      if (defaultValue !== UNSET) {
        value = defaultValue;
        source = ParameterSource.DEFAULT;
      }
    }
    return [value, source];
  }

  typeCastValue(ctx: Context, value: any): any {
    if (value === null || value === undefined) {
      if (this.multiple || this.nargs === -1) return [];
      return value;
    }

    const checkIter = (v: any): any[] => {
      if (typeof v === "string" || v === null || typeof v !== "object" || typeof v[Symbol.iterator] !== "function") {
        throw new BadParameter("Value must be an iterable.", ctx, this);
      }
      return [...v];
    };

    let convert: (v: any) => any;
    if (this.nargs === 1 || this.type.is_composite) {
      convert = (v) => this.type.call(v, this, ctx);
    } else if (this.nargs === -1) {
      convert = (v) => checkIter(v).map((x) => this.type.call(x, this, ctx));
    } else {
      convert = (v) => {
        const arr = checkIter(v);
        if (arr.length !== this.nargs) {
          throw new BadParameter(
            arr.length === 1 ? `Takes ${this.nargs} values but 1 was given.` : `Takes ${this.nargs} values but ${arr.length} were given.`,
            ctx,
            this,
          );
        }
        return arr.map((x) => this.type.call(x, this, ctx));
      };
    }

    if (this.multiple) return checkIter(value).map((x) => convert(x));
    return convert(value);
  }

  valueIsMissing(value: any): boolean {
    if (value === UNSET) return true;
    if ((this.nargs !== 1 || this.multiple) && Array.isArray(value) && value.length === 0) return true;
    return false;
  }

  async processValue(ctx: Context, value: any): Promise<any> {
    if (value === UNSET) {
      if (this.multiple || this.nargs === -1) value = [];
    } else {
      value = this.typeCastValue(ctx, value);
    }

    if (this.required && this.valueIsMissing(value)) throw new MissingParameter(null, ctx, this);

    if (this.callback !== null) {
      if (value === UNSET) value = null;
      const unsetKeys = Object.keys(ctx.params).filter((k) => ctx.params[k] === UNSET);
      if (!unsetKeys.length) {
        value = await this.callback(ctx, this, value);
      } else {
        const cb = this.callback;
        value = await ctx.run(async () => {
          for (const k of unsetKeys) ctx.params[k] = null;
          const result = await cb(ctx, this, value);
          for (const k of unsetKeys) {
            if (k in ctx.params && ctx.params[k] === null) ctx.params[k] = UNSET;
          }
          return result;
        });
      }
    }
    return value;
  }

  resolveEnvvarValue(_ctx: Context): string | null {
    if (!this.envvar) return null;
    if (typeof this.envvar === "string") {
      const rv = process.env[this.envvar];
      if (rv) return rv;
    } else {
      for (const envvar of this.envvar) {
        const rv = process.env[envvar];
        if (rv) return rv;
      }
    }
    return null;
  }

  valueFromEnvvar(ctx: Context): any {
    const rv = this.resolveEnvvarValue(ctx);
    if (rv !== null && this.nargs !== 1) return this.type.splitEnvvarValue(rv);
    return rv;
  }

  async handleParseResult(ctx: Context, opts: Record<string, any>, args: string[]): Promise<[any, string[]]> {
    const existingValue = Object.prototype.hasOwnProperty.call(ctx.params, this.name) ? ctx.params[this.name] : UNSET;
    const existingSource = ctx.getParameterSource(this.name);
    const existingDefaultExplicit = ctx._param_default_explicit.get(this.name) ?? false;

    let [value, src] = await augmentUsageErrors(ctx, this, async (): Promise<[any, ParameterSource]> => {
      let [v, source] = await this.consumeValueAsync(ctx, opts);
      ctx.setParameterSource(this.name, source);

      if (this.deprecated && v !== UNSET && source < ParameterSource.DEFAULT_MAP) {
        const message = `DeprecationWarning: The ${this.param_type_name} ${pyStrRepr(this.humanReadableName)} is deprecated.${formatDeprecatedSuffix(this.deprecated)}`;
        echo(style(message, { fg: "red" }), { err: true });
      }

      try {
        v = await this.processValue(ctx, v);
      } catch (e) {
        if (!ctx.resilient_parsing) throw e;
        v = UNSET;
      }
      return [v, source];
    });

    const slotEmpty = existingValue === UNSET;
    const moreExplicit = existingSource !== null && src < existingSource;
    const sameSource = existingSource !== null && src === existingSource;
    const autoWouldDowngradeExplicit = sameSource && src === ParameterSource.DEFAULT && existingDefaultExplicit && !this._default_explicit;
    const isWinner = slotEmpty || moreExplicit || (sameSource && !autoWouldDowngradeExplicit);

    if (isWinner) {
      if (this.expose_value) {
        ctx.params[this.name] = value;
        ctx._param_default_explicit.set(this.name, this._default_explicit);
      }
    } else if (existingSource !== null) {
      ctx.setParameterSource(this.name, existingSource);
    }
    return [value, args];
  }

  /** Async hook around `consumeValue` (options may prompt). */
  async consumeValueAsync(ctx: Context, opts: Record<string, any>): Promise<[any, ParameterSource]> {
    return this.consumeValue(ctx, opts);
  }

  getHelpRecord(_ctx: Context): [string, string] | null {
    return null;
  }

  getUsagePieces(_ctx: Context): string[] {
    return [];
  }

  getErrorHint(_ctx: Context | null): string {
    const hintList = this.opts.length ? this.opts : [this.humanReadableName];
    return hintList.map((x) => `'${x}'`).join(" / ");
  }
}

export interface OptionAttrs extends ParameterAttrs {
  show_default?: boolean | string | null;
  prompt?: boolean | string;
  confirmation_prompt?: boolean | string;
  prompt_required?: boolean;
  hide_input?: boolean;
  is_flag?: boolean | null;
  flag_value?: any;
  count?: boolean;
  allow_from_autoenv?: boolean;
  help?: string | null;
  hidden?: boolean;
  show_choices?: boolean;
  show_envvar?: boolean;
}

interface HelpExtra {
  envvars?: string[];
  default?: string;
  range?: string;
  required?: string;
}

/** `click.Option`. */
export class Option extends Parameter {
  override get param_type_name(): string {
    return "option";
  }
  prompt: string | null;
  confirmation_prompt: boolean | string;
  prompt_required: boolean;
  hide_input: boolean;
  hidden: boolean;
  _flag_needs_value: boolean;
  is_flag: boolean;
  flag_value: any;
  count: boolean;
  allow_from_autoenv: boolean;
  help: string | null;
  show_default: boolean | string | null;
  show_choices: boolean;
  show_envvar: boolean;

  constructor(paramDecls: readonly string[] | string | null = null, attrs: OptionAttrs = {}) {
    let help = attrs.help ?? null;
    if (help) help = cleandoc(help);
    const deprecated = attrs.deprecated ?? false;
    const { multiple, type } = attrs;
    super(paramDecls, { ...attrs, type, multiple, deprecated });

    const prompt = attrs.prompt ?? false;
    let promptText: string | null;
    if (prompt === true) {
      if (!this.name) throw new TypeError("'name' is required with 'prompt=True'.");
      promptText = capitalize(this.name.replace(/_/g, " "));
    } else if (prompt === false) promptText = null;
    else promptText = prompt;

    if (deprecated) {
      const label = formatDeprecatedLabel(deprecated);
      help = help ? `${help} ${label}` : label;
    }

    this.prompt = promptText;
    this.confirmation_prompt = attrs.confirmation_prompt ?? false;
    this.prompt_required = attrs.prompt_required ?? true;
    this.hide_input = attrs.hide_input ?? false;
    this.hidden = attrs.hidden ?? false;

    const flagValue = attrs.flag_value === undefined ? UNSET : attrs.flag_value;
    [this.is_flag, this._flag_needs_value] = this.inferFlagKind(attrs.is_flag ?? null, flagValue);

    this.type = this.pickType(type ?? null, flagValue, attrs.count ?? false, this.is_flag);

    this.flag_value = flagValue;
    this.count = attrs.count ?? false;
    if (this.count && this.default === UNSET) this.default = 0;

    this.allow_from_autoenv = attrs.allow_from_autoenv ?? true;
    this.help = help;
    this.show_default = attrs.show_default ?? null;
    this.show_choices = attrs.show_choices ?? true;
    this.show_envvar = attrs.show_envvar ?? false;

    this.validate(prompt, deprecated);
  }

  get isBoolFlag(): boolean {
    return this.is_flag && this.type instanceof BoolParamType;
  }

  get flagActivationValue(): any {
    if (this.flag_value === UNSET) return this.is_flag ? true : null;
    return this.flag_value;
  }

  private inferFlagKind(isFlag: boolean | null, flagValue: any): [boolean, boolean] {
    let needsValue = this.prompt !== null && !this.prompt_required;
    if (isFlag === null) {
      if (flagValue !== UNSET) return [true, needsValue];
      if (needsValue) return [false, needsValue];
      if (this.secondary_opts.length) return [true, needsValue];
      return [false, needsValue];
    }
    if (isFlag === false && !needsValue) {
      needsValue = flagValue !== UNSET || this.default === UNSET;
    }
    return [Boolean(isFlag), needsValue];
  }

  private pickType(typeArg: unknown, flagValue: any, count: boolean, isFlag: boolean): ParamType {
    if (typeArg !== null && typeArg !== undefined) return this.type;
    if (count) return new IntRange(0);
    if (!isFlag) return this.type;
    if (flagValue === UNSET || typeof flagValue === "boolean") return new BoolParamType();
    const guessed = convertType(null, flagValue);
    if (guessed instanceof StringParamType && typeof flagValue !== "string" && flagValue !== null) {
      return UNPROCESSED;
    }
    return guessed;
  }

  private resolveLazyDefault(value: any): any {
    if (value === UNSET && this.is_flag) {
      if (this.multiple && !this.required && !this.prompt) return [];
      if (this.isBoolFlag && !this.required) return false;
    }
    if (value === true && this.is_flag && !this.isBoolFlag) return this.flagActivationValue;
    return value;
  }

  private validate(prompt: boolean | string, deprecated: boolean | string): void {
    if (deprecated && prompt) throw new ValueError("`deprecated` options cannot use `prompt`.");
    if (this.nargs === -1) throw new TypeError("nargs=-1 is not supported for options.");
    if (!this.isBoolFlag && this.secondary_opts.length) throw new TypeError("Secondary flag is not valid for non-boolean flag.");
    if (this.isBoolFlag && this.hide_input && this.prompt !== null) {
      throw new TypeError("'prompt' with 'hide_input' is not valid for boolean flag.");
    }
    if (this.count) {
      if (this.multiple) throw new TypeError("'count' is not valid with 'multiple'.");
      if (this.is_flag) throw new TypeError("'count' is not valid with 'is_flag'.");
    }
  }

  override toInfoDict(): Record<string, unknown> {
    const info = super.toInfoDict();
    return {
      ...info,
      default: Parameter.hideUnset(this.resolveLazyDefault(this.default)),
      help: this.help,
      prompt: this.prompt,
      is_flag: this.is_flag,
      flag_value: this.flagActivationValue,
      count: this.count,
      hidden: this.hidden,
    };
  }

  override getDefault(ctx: Context, call = true): any {
    const raw = super.getDefault(ctx, false);
    let value = this.resolveLazyDefault(raw);
    if (value === raw && call && typeof value === "function") value = value();
    return value;
  }

  override getErrorHint(ctx: Context | null): string {
    let result = super.getErrorHint(ctx);
    if (this.show_envvar && this.envvar !== null) {
      result += ` (env var: '${Array.isArray(this.envvar) ? pyStr(this.envvar) : this.envvar}')`;
    }
    return result;
  }

  protected parseDecls(decls: readonly string[], exposeValue: boolean): [string, string[], string[]] {
    const opts: string[] = [];
    const secondaryOpts: string[] = [];
    let name: string | null = null;
    const possibleNames: Array<[string, string]> = [];

    for (const decl of decls) {
      if (isIdentifier(decl)) {
        if (name !== null) throw new TypeError(`Name '${name}' defined twice`);
        name = decl;
      } else {
        const splitChar = decl.slice(0, 1) === "/" ? ";" : "/";
        if (decl.includes(splitChar)) {
          const idx = decl.indexOf(splitChar);
          let first = decl.slice(0, idx);
          let second = decl.slice(idx + 1);
          first = first.replace(/[ \t\n\r\x0b\x0c]+$/, "");
          if (first) {
            possibleNames.push(splitOpt(first));
            opts.push(first);
          }
          second = second.replace(/^[ \t\n\r\x0b\x0c]+/, "");
          if (second) secondaryOpts.push(second);
          if (first === second) {
            throw new ValueError(`Boolean option ${pyStrRepr(decl)} cannot use the same flag for true/false.`);
          }
        } else {
          possibleNames.push(splitOpt(decl));
          opts.push(decl);
        }
      }
    }

    if (name === null && possibleNames.length) {
      const sorted = possibleNames.map((p, i) => ({ p, i })).sort((a, b) => len(b.p[0]) - len(a.p[0]) || a.i - b.i);
      name = (sorted[0] as { p: [string, string] }).p[1].replace(/-/g, "_").toLowerCase();
      if (!isIdentifier(name)) name = null;
    }

    if (name === null) {
      if (!exposeValue) return ["", opts, secondaryOpts];
      throw new TypeError(`Could not determine name for option with declarations ${pyReprList(decls)}`);
    }

    if (!opts.length && !secondaryOpts.length) {
      throw new TypeError(
        `No options defined but a name was passed (${name}). Did you mean to declare an argument instead? Did you mean to pass '--${name}'?`,
      );
    }
    return [name, opts, secondaryOpts];
  }

  addToParser(parser: OptionParser, _ctx: Context): void {
    let action: string;
    if (this.multiple) action = "append";
    else if (this.count) action = "count";
    else action = "store";

    if (this.is_flag) {
      action = `${action}_const`;
      if (this.isBoolFlag && this.secondary_opts.length) {
        parser.addOption({ obj: this, opts: this.opts, dest: this.name, action, const: true });
        parser.addOption({ obj: this, opts: this.secondary_opts, dest: this.name, action, const: false });
      } else {
        parser.addOption({ obj: this, opts: this.opts, dest: this.name, action, const: this.flagActivationValue });
      }
    } else {
      parser.addOption({ obj: this, opts: this.opts, dest: this.name, action, nargs: this.nargs });
    }
  }

  override getHelpRecord(ctx: Context): [string, string] | null {
    if (this.hidden) return null;
    let anyPrefixIsSlash = false;

    const writeOpts = (opts: readonly string[]): string => {
      let [rv, anySlashes] = joinOptions([...opts]);
      if (anySlashes) anyPrefixIsSlash = true;
      if (!this.is_flag && !this.count) rv += ` ${this.makeMetavar(ctx)}`;
      return rv;
    };

    const rv = [writeOpts(this.opts)];
    if (this.secondary_opts.length) rv.push(writeOpts(this.secondary_opts));

    let help = this.help || "";
    const extra = this.getHelpExtra(ctx);
    const extraItems: string[] = [];
    if (extra.envvars !== undefined) extraItems.push(`env var: ${extra.envvars.join(", ")}`);
    if (extra.default !== undefined) extraItems.push(`default: ${extra.default}`);
    if (extra.range !== undefined) extraItems.push(extra.range);
    if (extra.required !== undefined) extraItems.push(extra.required);

    if (extraItems.length) {
      const extraStr = extraItems.join("; ");
      help = help ? `${help}  [${extraStr}]` : `[${extraStr}]`;
    }
    return [rv.join(anyPrefixIsSlash ? "; " : " / "), help];
  }

  getHelpExtra(ctx: Context): HelpExtra {
    const extra: HelpExtra = {};

    if (this.show_envvar) {
      let envvar: string | readonly string[] | null = this.envvar;
      if (envvar === null) {
        if (this.allow_from_autoenv && ctx.auto_envvar_prefix !== null && this.name) {
          envvar = `${ctx.auto_envvar_prefix}_${this.name.toUpperCase()}`;
        }
      }
      if (envvar !== null) {
        extra.envvars = typeof envvar === "string" ? [envvar] : envvar.map((d) => pyStr(d));
      }
    }

    const resilient = ctx.resilient_parsing;
    ctx.resilient_parsing = true;
    let defaultValue: any;
    try {
      defaultValue = this.getDefault(ctx, false);
    } finally {
      ctx.resilient_parsing = resilient;
    }

    let showDefault: boolean | string = false;
    let showDefaultIsStr = false;
    if (this.show_default !== null) {
      if (typeof this.show_default === "string") {
        showDefaultIsStr = showDefault = true;
      } else showDefault = this.show_default;
    } else if (ctx.show_default !== null) {
      showDefault = ctx.show_default;
    }

    if (showDefaultIsStr || (showDefault && defaultValue !== null && defaultValue !== UNSET)) {
      let defaultString: string;
      if (showDefaultIsStr) defaultString = `(${this.show_default})`;
      else if (Array.isArray(defaultValue)) defaultString = defaultValue.map((d) => pyStr(d)).join(", ");
      else if (typeof defaultValue === "function") defaultString = "(dynamic)";
      else if (this.isBoolFlag && this.secondary_opts.length) {
        defaultString = splitOpt((defaultValue ? this.opts : this.secondary_opts)[0] as string)[1];
      } else if (this.isBoolFlag && !this.secondary_opts.length && !defaultValue) defaultString = "";
      else if (typeof defaultValue === "string" && defaultValue === "") defaultString = '""';
      else defaultString = pyStr(defaultValue);

      if (defaultString) extra.default = defaultString;
    }

    if (isNumberRange(this.type) && !(this.count && this.type.min === 0 && this.type.max === null)) {
      const rangeStr = this.type.describeRange();
      if (rangeStr) extra.range = rangeStr;
    }

    if (this.required) extra.required = "required";
    return extra;
  }

  async promptForValue(ctx: Context): Promise<any> {
    let deflt = this.getDefault(ctx);
    if (this.isBoolFlag) {
      if (deflt === UNSET || deflt === null) deflt = null;
      else deflt = Boolean(deflt);
      return confirm(this.prompt as string, { default: deflt });
    }

    const promptKwargs: { show_default?: boolean | string } = {};
    if (this.show_default !== null) promptKwargs.show_default = this.show_default;

    return prompt(this.prompt as string, {
      default: Parameter.hideUnset(deflt),
      type: this.type,
      hide_input: this.hide_input,
      show_choices: this.show_choices,
      confirmation_prompt: this.confirmation_prompt,
      value_proc: (x: string) => this.processValue(ctx, x),
      ...promptKwargs,
    });
  }

  override resolveEnvvarValue(ctx: Context): string | null {
    const rv = super.resolveEnvvarValue(ctx);
    if (rv !== null) return rv;
    if (this.allow_from_autoenv && ctx.auto_envvar_prefix !== null && this.name) {
      const envvar = `${ctx.auto_envvar_prefix}_${this.name.toUpperCase()}`;
      const v = process.env[envvar];
      if (v) return v;
    }
    return null;
  }

  override valueFromEnvvar(ctx: Context): any {
    const rv = this.resolveEnvvarValue(ctx);
    if (rv === null) return null;

    if (this.is_flag && !this.isBoolFlag) {
      if (rv === this.flag_value) return this.flag_value;
      const parsed = BoolParamType.strToBool(rv);
      if (parsed === null) return null;
      return parsed ? this.flag_value : false;
    }

    const valueDepth = (this.nargs !== 1 ? 1 : 0) + (this.multiple ? 1 : 0);
    if (valueDepth > 0) {
      let multiRv: any = this.type.splitEnvvarValue(rv);
      if (this.multiple && this.nargs !== 1) multiRv = batch(multiRv, this.nargs);
      return multiRv;
    }
    return rv;
  }

  override async consumeValueAsync(ctx: Context, opts: Record<string, any>): Promise<[any, ParameterSource]> {
    let [value, source] = this.consumeValue(ctx, opts);

    if (value === FLAG_NEEDS_VALUE) {
      if (this.prompt !== null && !ctx.resilient_parsing) {
        value = await this.promptForValue(ctx);
        source = ParameterSource.PROMPT;
      } else {
        value = this.flagActivationValue;
        source = ParameterSource.COMMANDLINE;
      }
    } else if (
      this.multiple &&
      value !== UNSET &&
      value !== null &&
      typeof value === "object" &&
      typeof value[Symbol.iterator] === "function" &&
      source < ParameterSource.DEFAULT_MAP &&
      [...value].some((v: unknown) => v === FLAG_NEEDS_VALUE)
    ) {
      value = [...value].map((v: unknown) => (v === FLAG_NEEDS_VALUE ? this.flagActivationValue : v));
      source = ParameterSource.COMMANDLINE;
    } else if (
      (value === UNSET || source >= ParameterSource.DEFAULT_MAP) &&
      this.prompt !== null &&
      (this.required || this.prompt_required) &&
      !ctx.resilient_parsing
    ) {
      value = await this.promptForValue(ctx);
      source = ParameterSource.PROMPT;
    }
    return [value, source];
  }

  override async processValue(ctx: Context, value: any): Promise<any> {
    if (this.is_flag && !this.required && this.isBoolFlag && value === UNSET) {
      value = false;
      if (this.callback !== null) value = await this.callback(ctx, this, value);
      return value;
    }
    return super.processValue(ctx, value);
  }
}

function pyReprList(decls: readonly string[]): string {
  return `(${decls.map(pyStrRepr).join(", ")}${decls.length === 1 ? "," : ""})`;
}

export interface ArgumentAttrs extends ParameterAttrs {
  help?: string | null;
}

/** `click.Argument`. */
export class Argument extends Parameter {
  override get param_type_name(): string {
    return "argument";
  }
  help: string | null;

  constructor(paramDecls: readonly string[] | string, attrs: ArgumentAttrs = {}) {
    let required = attrs.required;
    if (required === undefined || required === null) {
      if (attrs.default === undefined) required = (attrs.nargs ?? 1) > 0;
      else required = false;
    }
    if ("multiple" in attrs) throw new TypeError("__init__() got an unexpected keyword argument 'multiple'.");

    const deprecated = attrs.deprecated ?? false;
    let help = attrs.help ?? null;
    if (help) help = cleandoc(help);
    if (deprecated) {
      const label = formatDeprecatedLabel(deprecated);
      help = help ? `${help} ${label}` : label;
    }
    const { help: _h, ...rest } = attrs;
    super(paramDecls, { ...rest, required });
    this.help = help;
  }

  override toInfoDict(): Record<string, unknown> {
    return { ...super.toInfoDict(), help: this.help };
  }

  override get humanReadableName(): string {
    if (this.metavar !== null) return this.metavar;
    return this.name.toUpperCase();
  }

  override makeMetavar(ctx: Context): string {
    if (this.metavar !== null) return this.metavar;
    let v = this.type.getMetavar(this, ctx);
    if (!v) v = this.name.toUpperCase();
    const alreadyBracketed = v.startsWith("[") && v.endsWith("]");
    if (this.deprecated) v += "!";
    if (!this.required && !alreadyBracketed) v = `[${v}]`;
    if (this.nargs !== 1) v += "...";
    return v;
  }

  protected parseDecls(decls: readonly string[], exposeValue: boolean): [string, string[], string[]] {
    if (!decls.length) {
      if (!exposeValue) return ["", [], []];
      throw new TypeError("Argument is marked as exposed, but does not have a name.");
    }
    let name: string;
    let arg: string;
    if (decls.length === 1) {
      arg = decls[0] as string;
      name = arg.replace(/-/g, "_").toLowerCase();
    } else {
      throw new TypeError(`Arguments take exactly one parameter declaration, got ${decls.length}: ${pyReprList(decls)}.`);
    }
    return [name, [arg], []];
  }

  override getUsagePieces(ctx: Context): string[] {
    return [this.makeMetavar(ctx)];
  }

  override getHelpRecord(ctx: Context): [string, string] | null {
    if (this.help === null) return null;
    return [this.makeMetavar(ctx), this.help];
  }

  override getErrorHint(ctx: Context | null): string {
    if (ctx !== null) return `'${this.makeMetavar(ctx)}'`;
    return `'${this.humanReadableName}'`;
  }

  addToParser(parser: OptionParser, _ctx: Context): void {
    parser.addArgument({ dest: this.name, nargs: this.nargs, obj: this });
  }
}

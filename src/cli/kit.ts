/**
 * Declarative command definitions on top of `commander`.
 *
 * Command modules describe their commands with {@link command} / {@link group} / {@link option} / {@link argument}
 * (plain data plus an async callback `(ctx, params)`); {@link buildCommand} turns that description into a `commander`
 * command tree, which does the parsing, validation, `--help` rendering and usage errors. This file only maps names,
 * defaults, environment fallbacks and value types between the two and gives callbacks a small {@link Context}.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { Argument as CommanderArgument, Command as CommanderCommand, CommanderError, type HelpContext, InvalidArgumentError, Option as CommanderOption } from "commander";

import { cleandoc } from "../utils/_py.js";
import { closeMatches } from "../utils/suggest.js";
import { Abort, EOFError, Exit, KeyboardInterrupt, SystemExit, UsageError, type UsageContext, CliError } from "./errors.js";
import { echo, getTerminalSize, sys } from "./io.js";
import { Choice, ParamError, type ParamType } from "./types.js";

// ---------------------------------------------------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------------------------------------------------

// Command parameters and the shared context bag are heterogeneous (flags, paths, callbacks).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bag = Record<string, any>;

export type Params = Bag;

export interface OptionAttrs {
  help?: string | (() => string);
  default?: unknown;
  is_flag?: boolean;
  type?: ParamType;
  required?: boolean;
  envvar?: string | readonly string[];
  metavar?: string;
  multiple?: boolean;
  hidden?: boolean;
  show_default?: boolean;
}

export interface ArgumentAttrs {
  default?: unknown;
  type?: ParamType;
  required?: boolean;
  envvar?: string | readonly string[];
  metavar?: string;
  /** `-1`: collect every remaining word. */
  nargs?: number;
}

export interface Option {
  readonly kind: "option";
  readonly decls: readonly string[];
  readonly attrs: OptionAttrs;
  readonly name: string;
}

export interface Argument {
  readonly kind: "argument";
  readonly decls: readonly string[];
  readonly attrs: ArgumentAttrs;
  readonly name: string;
}

export type Param = Option | Argument;
export type Callback = (ctx: Context, params: Params) => unknown;

/** A subcommand whose module is only imported when the command line names it (keeps `--help` and startup fast). */
export interface LazyEntry {
  /** One-line description shown in the parent's command listing. */
  help: string;
  /** Heading of the parent's command listing this entry appears under. */
  heading: string;
  load(): Promise<Command>;
}

export interface CommandAttrs {
  help?: string | (() => string);
  /** Additional help evaluated only when help is rendered, never while parsing an action. */
  helpFooter?: () => string;
  params?: readonly Param[] | (() => readonly Param[]);
  callback?: Callback;
  hidden?: boolean;
  /** Printed by `--version` (root command only). */
  version?: string;
  lazy?: Record<string, LazyEntry>;
}

export class Command {
  readonly help: string;
  readonly helpFooter: (() => string) | undefined;
  readonly params: readonly Param[];
  callback: Callback | null;
  readonly hidden: boolean;
  readonly version: string | null;
  readonly lazy: Map<string, LazyEntry>;
  /** Present for groups. */
  readonly commands: Map<string, Command> | null;

  constructor(
    public name: string,
    attrs: CommandAttrs = {},
    isGroup = false,
  ) {
    this.help = typeof attrs.help === "function" ? "" : attrs.help ?? "";
    if (typeof attrs.help === "function") Object.defineProperty(this, "help", { get: attrs.help });
    this.helpFooter = attrs.helpFooter;
    this.params = typeof attrs.params === "function" ? [] : attrs.params ?? [];
    if (typeof attrs.params === "function") Object.defineProperty(this, "params", { get: attrs.params });
    this.callback = attrs.callback ?? null;
    this.hidden = attrs.hidden ?? false;
    this.version = attrs.version ?? null;
    this.lazy = new Map(Object.entries(attrs.lazy ?? {}));
    this.commands = isGroup ? new Map() : null;
  }

  /** Names of the subcommands (registered and lazy). */
  listCommands(): string[] {
    return [...(this.commands?.keys() ?? []), ...this.lazy.keys()];
  }

  /** The subcommand called `name`, importing it when it is lazy; `null` when there is none. */
  async getCommand(name: string): Promise<Command | null> {
    return this.commands?.get(name) ?? (await this.lazy.get(name)?.load()) ?? null;
  }

  /** Create a subcommand of this group and register it. */
  command(name: string, attrs: CommandAttrs = {}): Command {
    const cmd = new Command(name, attrs);
    this.addCommand(cmd);
    return cmd;
  }

  /** Register `cmd` as a subcommand of this group (under `name`, default its own name). */
  addCommand(cmd: Command, name?: string): void {
    if (this.commands === null) throw new Error(`'${this.name}' is not a group`);
    this.commands.set(name ?? cmd.name, cmd);
  }
}

export const command = (name: string, attrs: CommandAttrs = {}): Command => new Command(name, attrs);
export const group = (name: string, attrs: CommandAttrs = {}): Command => new Command(name, attrs, true);

const isDecl = (d: string): boolean => d.startsWith("-");

function paramName(decls: readonly string[]): string {
  const explicit = decls.find((d) => !isDecl(d));
  if (explicit !== undefined) return explicit;
  const long = decls.find((d) => d.startsWith("--"));
  const pick = (long ?? (decls[0] as string)).split("/")[0] as string;
  return pick.replace(/^-+/, "").replaceAll("-", "_").toLowerCase();
}

const toDecls = (d: string | readonly string[]): readonly string[] => (typeof d === "string" ? [d] : d);

/** A `--on/--off` declaration is a boolean flag pair. */
export const option = (decls: string | readonly string[], attrs: OptionAttrs = {}): Option => ({
  kind: "option",
  decls: toDecls(decls),
  attrs: { is_flag: toDecls(decls).some((d) => d.includes("/")) || undefined, ...attrs },
  name: paramName(toDecls(decls)),
});
export const argument = (decls: string | readonly string[], attrs: ArgumentAttrs = {}): Argument => ({ kind: "argument", decls: toDecls(decls), attrs, name: paramName(toDecls(decls)) });

function defaultFor(p: Param): unknown {
  if (p.attrs.default !== undefined) return p.attrs.default;
  if (p.kind === "option") {
    if (p.attrs.multiple) return [];
    if (p.attrs.is_flag) return false;
  } else if (p.attrs.nargs === -1) return [];
  return null;
}

/** The parameter values of `cmd` when nothing is given on the command line. */
export function defaultParams(cmd: Command): Params {
  return Object.fromEntries(cmd.params.map((p) => [p.name, defaultFor(p)]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------------------------------

const ctxStore = new AsyncLocalStorage<Context>();

/** The innermost running command's context (`undefined` when `silent` and none is active). */
export function getCurrentContext(silent: true): Context | undefined;
export function getCurrentContext(silent?: false): Context;
export function getCurrentContext(silent?: boolean): Context | undefined;
export function getCurrentContext(silent = false): Context | undefined {
  const ctx = ctxStore.getStore();
  if (ctx === undefined && !silent) throw new Error("There is no active click context.");
  return ctx;
}

/** What a command callback knows about its invocation: the shared `obj` / `meta`, its parent, its help and usage text. */
export class Context implements UsageContext {
  readonly meta: Bag;
  params: Params = {};
  invoked_subcommand: string | null = null;
  private ownObj: Bag | null = null;

  constructor(
    readonly command: Command,
    readonly parent: Context | null = null,
    readonly info_name: string = command.name,
    readonly cmd: CommanderCommand | null = null,
  ) {
    this.meta = parent === null ? {} : parent.meta;
  }

  get obj(): Bag | null {
    return this.ownObj ?? this.parent?.obj ?? null;
  }
  set obj(value: Bag | null) {
    this.ownObj = value;
  }

  get commandPath(): string {
    return this.parent === null ? this.info_name : `${this.parent.commandPath} ${this.info_name}`;
  }

  ensureObject(_cls?: unknown): Bag {
    if (this.obj === null) this.obj = {};
    return this.obj as Bag;
  }

  findRoot(): Context {
    return this.parent === null ? this : this.parent.findRoot();
  }

  private commander(): CommanderCommand {
    return this.cmd ?? buildCommand(this.command, this.info_name, this.parent?.cmd ?? null);
  }

  getHelp(): string {
    return this.commander().helpInformation();
  }

  usage(): string {
    const cmd = this.commander();
    return `Usage: ${cmd.createHelp().commandUsage(cmd)}`;
  }

  exit(code = 0): never {
    throw new Exit(code);
  }

  fail(message: string): never {
    throw new UsageError(message, this);
  }

  abort(): never {
    throw new Abort();
  }

  /** Run another command's callback in a child context; parameters not in `kwargs` take their declared defaults. */
  async invoke(cmd: Command, kwargs: Params = {}): Promise<unknown> {
    const sub = new Context(cmd, this, cmd.name);
    sub.params = { ...defaultParams(cmd), ...kwargs };
    return await runCallback(sub, cmd);
  }
}

function runCallback(ctx: Context, cmd: Command): Promise<unknown> {
  return ctxStore.run(ctx, async () => (cmd.callback === null ? undefined : await cmd.callback(ctx, ctx.params)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Building the commander tree
// ---------------------------------------------------------------------------------------------------------------------

const FALLBACK_NAME = "__fallback__";

const specs = new WeakMap<CommanderCommand, Command>();
const contexts = new WeakMap<CommanderCommand, Context>();

/** `\b` marks a paragraph as "do not rewrap"; commander never rewraps, so the marker line is dropped. */
export const cleanHelp = (help: string): string =>
  cleandoc(help)
    .split("\n")
    .filter((l) => l !== "\b")
    .join("\n")
    .trim();

/** First sentence of the first paragraph: the one-line summary in a command listing. */
export function shortHelp(help: string): string {
  const paragraph = cleanHelp(help).split(/\n\s*\n/)[0] ?? "";
  const flat = paragraph.split(/\s+/).join(" ");
  const i = flat.indexOf(". ");
  return i === -1 ? flat : flat.slice(0, i + 1);
}

/** Commander wording to the CLI's usage-error wording. */
function reword(message: string): string {
  let m = message.replace(/^error: /, "");
  m = m.replace(/^unknown option '([^']+)'\n\(Did you mean (?:one of )?([^)?]+)\?\)$/, (_, o: string, s: string) => `No such option '${o}'. Did you mean ${s.split(", ").map((x) => `'${x}'`).join(", ")}?`);
  m = m.replace(/^unknown option '([^']+)'$/, "No such option '$1'.");
  m = m.replace(/^missing required argument '([^']+)'$/, "Missing argument '$1'.");
  m = m.replace(/^option '(?:-\w, )?(--[^ ']+)[^']*' argument missing$/, "Option '$1' requires an argument.");
  m = m.replace(/^option '(?:-\w, )?(--[^ ']+)[^']*' argument '[^']*' is invalid\.\s*/, "Invalid value for '$1': ");
  m = m.replace(/^command-argument value '[^']*' is invalid for argument '([^']+)'\.\s*/, "Invalid value for '$1': ");
  m = m.replace(/^too many arguments(?: for '[^']*')?\. Expected \d+ arguments? but got \d+\.$/, "Got unexpected extra arguments.");
  return m;
}

class AbxCommand extends CommanderCommand {
  override error(message: string): never {
    throw new UsageError(reword(message), contextFor(this));
  }

  /** `abx group nope --help` names a missing command; commander would print the group's help instead. */
  override outputHelp(context?: HelpContext | ((str: string) => string)): void {
    const first = this.args[0];
    if (this.commands.length > 0 && first !== undefined && !first.startsWith("-")) throw unknownCommand(this, first);
    super.outputHelp(context as HelpContext);
  }
}

function unknownCommand(groupCmd: CommanderCommand, word: string): UsageError {
  const hint = groupCmd.parent === null ? rootHint(word, groupCmd.commands.filter((c) => c.name() !== FALLBACK_NAME).map((c) => c.name())) : "";
  return new UsageError(`No such command '${word}'.${hint}`, contextFor(groupCmd));
}

function contextFor(cmd: CommanderCommand): Context {
  let ctx = contexts.get(cmd);
  if (ctx === undefined) {
    const parent = cmd.parent === null ? null : contextFor(cmd.parent);
    ctx = new Context(specs.get(cmd) as Command, parent, cmd.name(), cmd);
    contexts.set(cmd, ctx);
  }
  return ctx;
}

const envNames = (envvar: string | readonly string[] | undefined): string[] => (envvar === undefined ? [] : typeof envvar === "string" ? [envvar] : [...envvar]);

function convert(type: ParamType | undefined, value: string): unknown {
  if (type === undefined) return value;
  try {
    return type.convert(value);
  } catch (e) {
    if (e instanceof ParamError) throw new InvalidArgumentError(e.message);
    throw e;
  }
}

function optionFlags(p: Option): { flags: string; pairs: string[] } {
  const shorts = p.decls.filter((d) => isDecl(d) && !d.startsWith("--"));
  const longs = p.decls.filter((d) => d.startsWith("--")).flatMap((d) => d.split("/"));
  const takesValue = !p.attrs.is_flag;
  const metavar = p.attrs.metavar ?? p.attrs.type?.metavar ?? p.name.toUpperCase();
  const value = takesValue ? ` <${metavar}>` : "";
  const [first, ...rest] = longs;
  const primary = [...shorts, ...(first === undefined ? [] : [first])].join(", ") + value;
  return { flags: primary, pairs: rest };
}

function addOption(cmd: CommanderCommand, p: Option): void {
  const { flags, pairs } = optionFlags(p);
  let help = typeof p.attrs.help === "function" ? p.attrs.help() : p.attrs.help ?? "";
  const dflt = p.attrs.default;
  if (p.attrs.show_default && dflt !== undefined && dflt !== null && dflt !== false) help = `${help} [default: ${String(dflt)}]`.trim();
  const opt = new CommanderOption(flags, help || undefined);
  if (p.attrs.hidden) opt.hideHelp();
  const type = p.attrs.type;
  if (!p.attrs.is_flag && (type !== undefined || p.attrs.multiple)) {
    if (type instanceof Choice && type.case_sensitive && !p.attrs.multiple) opt.choices(type.choices);
    // Keep choices for help, but use our converter for stable CLI diagnostics.
    opt.argParser((value: string, prev: unknown) => {
      const converted = convert(type, value);
      return p.attrs.multiple ? [...(Array.isArray(prev) ? prev : []), converted] : converted;
    });
  }
  cmd.addOption(opt);
  for (const neg of pairs) {
    const other = new CommanderOption(neg, `Opposite of ${flags.split(", ").pop()}.`);
    cmd.addOption(p.attrs.hidden ? other.hideHelp() : other);
  }
}

function addArgument(cmd: CommanderCommand, p: Argument): void {
  const variadic = p.attrs.nargs === -1;
  const required = (p.attrs.required ?? true) && envNames(p.attrs.envvar).length === 0;
  const label = (p.attrs.metavar ?? p.name).toUpperCase() + (variadic ? "..." : "");
  const arg = new CommanderArgument(required ? `<${label}>` : `[${label}]`);
  const type = p.attrs.type;
  if (type instanceof Choice && type.case_sensitive) arg.choices(type.choices);
  if (type !== undefined) {
    arg.argParser((value: string, prev: unknown) => {
      const converted = convert(type, value);
      return variadic ? [...(Array.isArray(prev) ? prev : []), converted] : converted;
    });
  }
  cmd.addArgument(arg);
}

function fromEnv(p: Param, ctx: Context): unknown {
  for (const name of envNames(p.attrs.envvar)) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") continue;
    try {
      return p.attrs.type === undefined ? raw : p.attrs.type.convert(raw);
    } catch (e) {
      if (e instanceof ParamError) throw new UsageError(`Invalid value for '${p.name}': ${e.message}`, ctx);
      throw e;
    }
  }
  return undefined;
}

/** Read the option and argument values the parser produced for `cmd`, applying environment fallbacks and defaults. */
function collectParams(cmd: CommanderCommand, spec: Command): Params {
  const ctx = contextFor(cmd);
  const opts = cmd.opts();
  const args = cmd.processedArgs as unknown[];
  const values: Params = {};
  let argIndex = 0;
  for (const p of spec.params) {
    let v: unknown;
    if (p.kind === "argument") {
      v = args[argIndex++];
      if (v === undefined) v = fromEnv(p, ctx);
    } else {
      const { flags, pairs } = optionFlags(p);
      const primary = new CommanderOption(flags);
      const key = primary.attributeName();
      v = opts[key];
      // Commander reads a lone `--no-x` as the negation of an implicit `--x` (default true); here it is a plain flag.
      if (primary.negate && pairs.length === 0) v = cmd.getOptionValueSource(key) === "cli" ? true : undefined;
      for (const neg of pairs) {
        const negKey = new CommanderOption(neg).attributeName();
        if (negKey !== key && cmd.getOptionValueSource(negKey) === "cli") v = false;
      }
      if (v === undefined) v = fromEnv(p, ctx);
    }
    if (v === undefined) v = defaultFor(p);
    if (p.attrs.required && (v === null || v === undefined)) {
      throw new UsageError(p.kind === "option" ? `Missing option '${p.decls.find((d) => d.startsWith("--")) ?? p.decls[0]}'.` : `Missing argument '${p.name.toUpperCase()}'.`, ctx);
    }
    values[p.name] = v;
  }
  return values;
}

function terminalWidth(): number {
  return sys.stdout.isatty() ? getTerminalSize().columns : 80;
}

function configure(cmd: CommanderCommand, spec: Command): void {
  specs.set(cmd, spec);
  cmd
    .exitOverride()
    .helpOption("-h, --help", "Show this message and exit.")
    .helpCommand(false)
    .enablePositionalOptions()
    .configureHelp({ sortSubcommands: spec.lazy.size === 0, subcommandTerm: (sub) => sub.name() })
    .configureOutput({
      writeOut: (s) => {
        sys.stdout.write(s);
        sys.stdout.flush();
      },
      writeErr: (s) => {
        sys.stderr.write(s);
        sys.stderr.flush();
      },
      outputError: () => {},
      getOutHelpWidth: terminalWidth,
      getErrHelpWidth: terminalWidth,
    });
  if (spec.help) cmd.description(cleanHelp(spec.help));
  if (spec.helpFooter) cmd.addHelpText("after", () => spec.helpFooter!());
}

/** The commander command behind `spec`, with its whole subtree. `parent` only matters for the usage line. */
export function buildCommand(
  spec: Command,
  name: string = spec.name,
  parent: CommanderCommand | null = null,
  loaded: ReadonlyMap<string, Command> = new Map(),
): CommanderCommand {
  const cmd = new AbxCommand(name);
  configure(cmd, spec);
  if (parent !== null) cmd.parent = parent;
  if (spec.version !== null) cmd.version(`${name}, version ${spec.version}`, "--version", "Show the version and exit.");
  if (spec.help) cmd.summary(shortHelp(spec.help));
  for (const p of spec.params) {
    if (p.kind === "option") addOption(cmd, p);
    else addArgument(cmd, p);
  }

  if (spec.commands === null) {
    cmd.action(async () => {
      const ctx = contextFor(cmd);
      ctx.params = collectParams(cmd, spec);
      await runCallback(ctx, spec);
    });
    return cmd;
  }

  cmd.hook("preSubcommand", async (_this, sub) => {
    const ctx = contextFor(cmd);
    ctx.params = collectParams(cmd, spec);
    ctx.invoked_subcommand = sub.name() === FALLBACK_NAME ? null : sub.name();
    await runCallback(ctx, spec);
  });
  for (const [subName, subSpec] of spec.commands) {
    const sub = buildCommand(subSpec, subName);
    cmd.addCommand(sub, { hidden: subSpec.hidden });
  }
  for (const [subName, entry] of spec.lazy) {
    const real = loaded.get(subName);
    let sub: CommanderCommand;
    if (real === undefined) {
      sub = new AbxCommand(subName);
      configure(sub, new Command(subName, { help: entry.help }));
    } else sub = buildCommand(real, subName);
    sub.summary(entry.help).helpGroup(entry.heading);
    cmd.addCommand(sub);
  }
  cmd.addCommand(fallbackCommand(), { isDefault: true, hidden: true });
  return cmd;
}

/** Runs when a group is given nothing (print its help) or something it does not know (usage error). */
function fallbackCommand(): CommanderCommand {
  const fallback = new AbxCommand(FALLBACK_NAME);
  fallback.exitOverride().helpOption(false).allowUnknownOption().argument("[words...]");
  fallback.action(() => {
    const groupCmd = fallback.parent as CommanderCommand;
    const ctx = contextFor(groupCmd);
    const words = fallback.args;
    const first = words[0];
    if (first === undefined) {
      echo(groupCmd.helpInformation());
      throw new Exit(groupCmd.parent === null ? 0 : 2);
    }
    if (first.startsWith("-")) throw new UsageError(`No such option '${first}'.`, ctx);
    throw unknownCommand(groupCmd, first);
  });
  return fallback;
}

function rootHint(word: string, names: string[]): string {
  const candidates = closeMatches(word, names, 3, 0.6);
  return candidates.length
    ? ` Did you mean ${candidates.map((c) => `'${c}'`).join(", ")}?`
    : " No similar command. See 'abx --help' for the command list (templates: 'abx template scaffold|install'; named commands in a sandbox: 'abx run SANDBOX NAME').";
}

// ---------------------------------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------------------------------

export interface RunOptions {
  /** Program name shown in usage lines (default: the command's own name). */
  prog_name?: string;
  /** Initial `ctx.obj` of the root command. */
  obj?: Bag;
}

/** The name `args` selects among `spec`'s lazy subcommands: the first word that is not an option or an option value. */
function lazyTarget(spec: Command, args: readonly string[]): string | null {
  const valued = new Set(spec.params.flatMap((p) => (p.kind === "option" && !p.attrs.is_flag ? p.decls.filter(isDecl) : [])));
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") return null;
    if (a.startsWith("-")) {
      if (valued.has(a)) i++;
      continue;
    }
    return spec.lazy.has(a) ? a : null;
  }
  return null;
}

/** Build the command tree for `spec` (importing the lazy subcommand `args` names), run it and return the exit code. Errors are printed here. */
export async function runCommand(spec: Command, args: readonly string[], opts: RunOptions = {}): Promise<number> {
  const loaded = new Map<string, Command>();
  const target = spec.lazy.size > 0 ? lazyTarget(spec, args) : null;
  if (target !== null) loaded.set(target, (await spec.getCommand(target)) as Command);
  const program = buildCommand(spec, opts.prog_name ?? spec.name, null, loaded);
  if (opts.obj !== undefined) contextFor(program).obj = opts.obj;
  try {
    await program.parseAsync([...args], { from: "user" });
    return 0;
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode;
    if (e instanceof EOFError || e instanceof KeyboardInterrupt || e instanceof Abort) {
      if (!(e instanceof Abort)) echo(null, { err: true });
      echo("Aborted!", { err: true });
      return 1;
    }
    if (e instanceof CliError) {
      e.show();
      return e.exit_code;
    }
    if (e instanceof Exit) return e.exit_code;
    if (e instanceof SystemExit) {
      if (e.code === null) return 0;
      if (typeof e.code === "number") return e.code;
      sys.stderr.write(`${e.code}\n`);
      return 1;
    }
    if ((e as { code?: string } | null)?.code === "EPIPE") return 1;
    throw e;
  }
}

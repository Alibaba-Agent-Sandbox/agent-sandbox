/**
 * Port of `click/parser.py` (Click 8.5): the option parser (`_OptionParser`).
 * Click never abbreviates long options; option clustering (`-abc`), `--opt=value`, `--` and
 * `ignore_unknown_options` / `allow_interspersed_args` behave as in Click.
 */

import type { Argument as CoreArgument, Context, Option as CoreOption, Parameter as CoreParameter } from "./core.js";
import { BadArgumentUsage, BadOptionUsage, NoSuchOption, UsageError } from "./exceptions.js";
import { cpSlice, len, pyStrRepr } from "./py.js";
import { FLAG_NEEDS_VALUE, UNSET } from "./sentinels.js";
import { splitOpt } from "./formatting.js";

export { splitOpt };

type Slot = unknown;

/** `_unpack_args`: distribute `args` over the `nargs` spec (negative nargs swallows the rest). */
export function unpackArgs(args: readonly string[], nargsSpec: readonly number[]): [Slot[], string[]] {
  const queue: string[] = [...args];
  const spec: number[] = [...nargsSpec];
  const rv: Slot[] = [];
  let spos: number | null = null;

  const fetch = (): unknown => {
    if (queue.length === 0) return UNSET;
    return spos === null ? (queue.shift() as string) : (queue.pop() as string);
  };

  while (spec.length) {
    const nargs = (spos === null ? spec.shift() : spec.pop()) as number;
    if (nargs === 1) {
      rv.push(fetch());
    } else if (nargs > 1) {
      const x: unknown[] = [];
      for (let i = 0; i < nargs; i++) x.push(fetch());
      if (spos !== null) x.reverse();
      rv.push(x);
    } else if (nargs < 0) {
      if (spos !== null) throw new TypeError("Cannot have two nargs < 0");
      spos = rv.length;
      rv.push(UNSET);
    }
  }

  let remaining = queue;
  if (spos !== null) {
    rv[spos] = [...queue];
    remaining = [];
    const tail = rv.slice(spos + 1).reverse();
    rv.splice(spos + 1, rv.length - (spos + 1), ...tail);
  }
  return [rv, remaining];
}

/** `_normalize_opt`. */
export function normalizeOpt(opt: string, ctx: Context | null): string {
  if (ctx === null || ctx.token_normalize_func === null) return opt;
  const [prefix, rest] = splitOpt(opt);
  return `${prefix}${ctx.token_normalize_func(rest)}`;
}

type Action = "store" | "store_const" | "append" | "append_const" | "count";

class ParserOption {
  readonly shortOpts: string[] = [];
  readonly longOpts: string[] = [];
  readonly prefixes = new Set<string>();
  readonly dest: string | null;
  readonly action: Action;
  readonly nargs: number;
  readonly const: unknown;
  readonly obj: CoreOption;

  constructor(obj: CoreOption, opts: readonly string[], dest: string | null, action: string | null, nargs: number, constant: unknown) {
    for (const opt of opts) {
      const [prefix, value] = splitOpt(opt);
      if (!prefix) throw new Error(`ValueError: Invalid start character for option (${opt})`);
      this.prefixes.add(cpSlice(prefix, 0, 1));
      if (len(prefix) === 1 && len(value) === 1) {
        this.shortOpts.push(opt);
      } else {
        this.longOpts.push(opt);
        this.prefixes.add(prefix);
      }
    }
    this.dest = dest;
    this.action = (action ?? "store") as Action;
    this.nargs = nargs;
    this.const = constant;
    this.obj = obj;
  }

  get takesValue(): boolean {
    return this.action === "store" || this.action === "append";
  }

  process(value: unknown, state: ParsingState): void {
    const dest = this.dest as string;
    switch (this.action) {
      case "store":
        state.opts[dest] = value;
        break;
      case "store_const":
        state.opts[dest] = this.const;
        break;
      case "append": {
        const cur = (state.opts[dest] ??= []) as unknown[];
        cur.push(value);
        break;
      }
      case "append_const": {
        const cur = (state.opts[dest] ??= []) as unknown[];
        cur.push(this.const);
        break;
      }
      case "count":
        state.opts[dest] = ((state.opts[dest] as number | undefined) ?? 0) + 1;
        break;
      default:
        throw new Error(`ValueError: unknown action '${String(this.action)}'`);
    }
    state.order.push(this.obj);
  }
}

class ParserArgument {
  constructor(
    readonly obj: CoreArgument,
    readonly dest: string | null,
    readonly nargs: number = 1,
  ) {}

  process(value: unknown, state: ParsingState): void {
    let v = value;
    if (this.nargs > 1) {
      const seq = v as unknown[];
      const holes = seq.filter((x) => x === UNSET).length;
      if (holes === seq.length) v = UNSET;
      else if (holes !== 0) {
        throw new BadArgumentUsage(`Argument ${pyStrRepr(this.dest as string)} takes ${this.nargs} values.`);
      }
    }
    if (Array.isArray(v) && v.length === 0) v = UNSET;
    state.opts[this.dest as string] = v;
    state.order.push(this.obj);
  }
}

export class ParsingState {
  opts: Record<string, unknown> = {};
  largs: string[] = [];
  order: CoreParameter[] = [];
  constructor(public rargs: string[]) {}
}

/** `click.parser._OptionParser`. */
export class OptionParser {
  ctx: Context | null;
  allow_interspersed_args = true;
  ignore_unknown_options = false;
  private shortOpt = new Map<string, ParserOption>();
  private longOpt = new Map<string, ParserOption>();
  opt_prefixes = new Set<string>(["-", "--"]);
  private args: ParserArgument[] = [];

  constructor(ctx: Context | null = null) {
    this.ctx = ctx;
    if (ctx !== null) {
      this.allow_interspersed_args = ctx.allow_interspersed_args;
      this.ignore_unknown_options = ctx.ignore_unknown_options;
    }
  }

  addOption(opts: {
    obj: CoreOption;
    opts: readonly string[];
    dest: string | null;
    action?: string | null;
    nargs?: number;
    const?: unknown;
  }): void {
    const normalized = opts.opts.map((o) => normalizeOpt(o, this.ctx));
    const option = new ParserOption(opts.obj, normalized, opts.dest, opts.action ?? null, opts.nargs ?? 1, opts.const ?? null);
    for (const p of option.prefixes) this.opt_prefixes.add(p);
    for (const o of option.shortOpts) this.shortOpt.set(o, option);
    for (const o of option.longOpts) this.longOpt.set(o, option);
  }

  addArgument(opts: { obj: CoreArgument; dest: string | null; nargs?: number }): void {
    this.args.push(new ParserArgument(opts.obj, opts.dest, opts.nargs ?? 1));
  }

  parseArgs(args: string[]): [Record<string, unknown>, string[], CoreParameter[]] {
    const state = new ParsingState(args);
    try {
      this.processArgsForOptions(state);
      this.processArgsForArgs(state);
    } catch (e) {
      if (e instanceof UsageError) {
        if (this.ctx === null || !this.ctx.resilient_parsing) throw e;
      } else throw e;
    }
    return [state.opts, state.largs, state.order];
  }

  private processArgsForArgs(state: ParsingState): void {
    const [pargs, args] = unpackArgs([...state.largs, ...state.rargs], this.args.map((x) => x.nargs));
    this.args.forEach((arg, idx) => arg.process(pargs[idx], state));
    state.largs = args;
    state.rargs = [];
  }

  private processArgsForOptions(state: ParsingState): void {
    while (state.rargs.length) {
      const arg = state.rargs.shift() as string;
      const arglen = len(arg);
      if (arg === "--") return;
      if (this.opt_prefixes.has(cpSlice(arg, 0, 1)) && arglen > 1) {
        this.processOpts(arg, state);
      } else if (this.allow_interspersed_args) {
        state.largs.push(arg);
      } else {
        state.rargs.unshift(arg);
        return;
      }
    }
  }

  private matchLongOpt(opt: string, explicitValue: string | null, state: ParsingState): void {
    if (!this.longOpt.has(opt)) {
      throw new NoSuchOption(opt, null, this.longOpt.keys(), this.ctx);
    }
    const option = this.longOpt.get(opt) as ParserOption;
    let value: unknown;
    if (option.takesValue) {
      if (explicitValue !== null) state.rargs.unshift(explicitValue);
      value = this.getValueFromState(opt, option, state);
    } else if (explicitValue !== null) {
      throw new BadOptionUsage(opt, `Option ${pyStrRepr(opt)} does not take a value.`);
    } else {
      value = UNSET;
    }
    option.process(value, state);
  }

  private matchShortOpt(arg: string, state: ParsingState): void {
    let stop = false;
    let i = 1;
    const chars = Array.from(arg);
    const prefix = chars[0] as string;
    const unknownOptions: string[] = [];

    for (const ch of chars.slice(1)) {
      const opt = normalizeOpt(`${prefix}${ch}`, this.ctx);
      const option = this.shortOpt.get(opt);
      i += 1;
      if (!option) {
        if (this.ignore_unknown_options) {
          unknownOptions.push(ch);
          continue;
        }
        throw new NoSuchOption(opt, null, null, this.ctx);
      }
      let value: unknown;
      if (option.takesValue) {
        if (i < chars.length) {
          state.rargs.unshift(chars.slice(i).join(""));
          stop = true;
        }
        value = this.getValueFromState(opt, option, state);
      } else {
        value = UNSET;
      }
      option.process(value, state);
      if (stop) break;
    }
    if (this.ignore_unknown_options && unknownOptions.length) {
      state.largs.push(`${prefix}${unknownOptions.join("")}`);
    }
  }

  private getValueFromState(optionName: string, option: ParserOption, state: ParsingState): unknown {
    const nargs = option.nargs;
    let value: unknown;
    if (state.rargs.length < nargs) {
      if (option.obj._flag_needs_value) {
        value = FLAG_NEEDS_VALUE;
      } else {
        throw new BadOptionUsage(
          optionName,
          nargs === 1
            ? `Option ${pyStrRepr(optionName)} requires an argument.`
            : `Option ${pyStrRepr(optionName)} requires ${nargs} arguments.`,
        );
      }
    } else if (nargs === 1) {
      const nextRarg = state.rargs[0] as string;
      if (option.obj._flag_needs_value && this.opt_prefixes.has(cpSlice(nextRarg, 0, 1)) && len(nextRarg) > 1) {
        value = FLAG_NEEDS_VALUE;
      } else {
        value = state.rargs.shift();
      }
    } else {
      value = state.rargs.splice(0, nargs);
    }
    return value;
  }

  private processOpts(arg: string, state: ParsingState): void {
    let explicitValue: string | null = null;
    let longOpt: string;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      longOpt = arg.slice(0, eq);
      explicitValue = arg.slice(eq + 1);
    } else {
      longOpt = arg;
    }
    const normLongOpt = normalizeOpt(longOpt, this.ctx);
    try {
      this.matchLongOpt(normLongOpt, explicitValue, state);
    } catch (e) {
      if (!(e instanceof NoSuchOption)) throw e;
      if (!this.opt_prefixes.has(cpSlice(arg, 0, 2))) {
        this.matchShortOpt(arg, state);
        return;
      }
      if (!this.ignore_unknown_options) throw e;
      state.largs.push(arg);
    }
  }
}

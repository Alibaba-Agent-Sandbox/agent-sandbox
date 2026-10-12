/**
 * Factories mirroring `click.decorators` for TypeScript (there are no function decorators; each factory returns the
 * object directly):
 *
 * ```ts
 * export const create = command("create", {
 *   help: "Create a new sandbox.",
 *   params: [
 *     option(["--template", "-t"], { help: "Template", default: "base" }),
 *     argument(["description"], { required: false }),
 *   ],
 *   callback: async (ctx, params) => { ... },
 * });
 * ```
 */

import { Argument, Command, Group, Option, type ArgumentAttrs, type CommandAttrs, type Context, type GroupAttrs, type OptionAttrs, type Parameter } from "./core.js";
import { echo } from "./utils.js";

/** `@click.command(name, cls=..., **attrs)`. */
export function command(name: string, attrs: CommandAttrs & { cls?: new (name: string, attrs: CommandAttrs) => Command } = {}): Command {
  const { cls, ...rest } = attrs;
  const Cls = cls ?? Command;
  return new Cls(name, { ...rest, params: rest.params ?? [] });
}

/** `@click.group(name, cls=..., **attrs)`. */
export function group(name: string, attrs: GroupAttrs & { cls?: new (name: string, attrs: GroupAttrs) => Group } = {}): Group {
  const { cls, ...rest } = attrs;
  const Cls = cls ?? Group;
  return new Cls(name, { ...rest, params: rest.params ?? [] });
}

/** `@click.option(*decls, **attrs)`: `decls` is one declaration or an array (`["--json", "-j", "output_json"]`). */
export function option(decls: string | readonly string[], attrs: OptionAttrs & { cls?: new (decls: readonly string[], attrs: OptionAttrs) => Option } = {}): Option {
  const { cls, ...rest } = attrs;
  const Cls = cls ?? Option;
  return new Cls(typeof decls === "string" ? [decls] : decls, rest);
}

/** `@click.argument(*decls, **attrs)`. */
export function argument(decls: string | readonly string[], attrs: ArgumentAttrs & { cls?: new (decls: readonly string[], attrs: ArgumentAttrs) => Argument } = {}): Argument {
  const { cls, ...rest } = attrs;
  const Cls = cls ?? Argument;
  return new Cls(typeof decls === "string" ? [decls] : decls, rest);
}

export interface VersionOptionAttrs extends OptionAttrs {
  /** The version string (or a function producing it). */
  version?: string | (() => string) | null;
  prog_name?: string | null;
  package_name?: string | null;
  /** `%(prog)s`, `%(package)s` and `%(version)s` are substituted. */
  message?: string | null;
}

/** `@click.version_option(...)`. Python resolved the version from package metadata; here pass `version`. */
export function versionOption(decls: string | readonly string[] | null = null, attrs: VersionOptionAttrs = {}): Option {
  let { version = null, prog_name: progName = null, package_name: packageName = null, message = null, ...rest } = attrs;
  message ??= "%(prog)s, version %(version)s";

  const callback = async (ctx: Context, _param: Parameter, value: unknown): Promise<void> => {
    if (!value || ctx.resilient_parsing) return;
    if (progName === null) progName = ctx.findRoot().info_name;
    let v = typeof version === "function" ? version() : version;
    if (v === null || v === undefined) {
      throw new Error(`RuntimeError: Could not determine the version for ${packageName === null ? "None" : `'${packageName}'`} automatically.`);
    }
    const subst: Record<string, string> = { prog: progName ?? "None", package: packageName ?? "None", version: v };
    echo(message!.replace(/%\((\w+)\)s/g, (_m, k: string) => subst[k] ?? ""), { color: ctx.color });
    ctx.exit();
  };

  const d = decls === null ? ["--version"] : typeof decls === "string" ? [decls] : decls;
  return new Option(d.length ? d : ["--version"], {
    is_flag: true,
    expose_value: false,
    is_eager: true,
    help: "Show the version and exit.",
    ...rest,
    callback,
  });
}

/** `@click.help_option(*decls, **attrs)`. */
export function helpOption(decls: string | readonly string[] | null = null, attrs: OptionAttrs = {}): Option {
  const d = decls === null ? ["--help"] : typeof decls === "string" ? [decls] : decls;
  return new Option(d.length ? d : ["--help"], {
    is_flag: true,
    expose_value: false,
    is_eager: true,
    help: "Show this message and exit.",
    callback: async (ctx, _p, value) => {
      if (value && !ctx.resilient_parsing) {
        echo(await ctx.getHelp(), { color: ctx.color });
        ctx.exit();
      }
    },
    ...attrs,
  });
}

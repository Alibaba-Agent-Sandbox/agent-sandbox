#!/usr/bin/env node
// Dump the click command tree of the Node `ebx` (same JSON shape as click_tree.py). Needs `npm run build` (dist/).
// Usage: HOME=$(mktemp -d) EBX_NO_KEYCHAIN=1 node click_tree.mjs > node-tree.json
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dist = resolve(root, "dist");
if (!existsSync(resolve(dist, "cli/main.js"))) {
  console.error("dist/ missing: run `npm run build` first");
  process.exit(0);
}
const { cli } = await import(pathToFileURL(resolve(dist, "cli/main.js")).href);
const { Context, Option, Group, Choice, IntRange, FloatRange, Path: PathT, UNSET } = await import(
  pathToFileURL(resolve(dist, "framework/index.js")).href
);

const jsonable = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(jsonable);
  if (v && v.constructor === Object) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonable(x)]));
  if (typeof v === "function") return `<callable ${v.name}>`;
  if (v && typeof v === "object" && "value" in v && v.constructor?.name === "PyFloat") return v.value;
  if (v === UNSET || String(v?.constructor?.name) === "Sentinel") return null;
  return String(v);
};
const typeRepr = (t) => {
  if (t instanceof Choice) return `Choice(${JSON.stringify(t.choices)}, case_sensitive=${t.case_sensitive})`;
  if (t instanceof IntRange) return `IntRange(${jsonable(t.min)},${jsonable(t.max)},clamp=${t.clamp})`;
  if (t instanceof FloatRange) return `FloatRange(${jsonable(t.min)},${jsonable(t.max)})`;
  if (t instanceof PathT) return `Path(exists=${t.exists},file_okay=${t.file_okay},dir_okay=${t.dir_okay},resolve=${t.resolve_path})`;
  return t.name;
};
const param = (p) => {
  const isOpt = p instanceof Option;
  const d = {
    kind: isOpt ? "option" : "argument", name: p.name, opts: [...p.opts], secondary_opts: [...p.secondary_opts],
    type: typeRepr(p.type), required: p.required, default: jsonable(p.default), multiple: p.multiple, nargs: p.nargs,
    envvar: jsonable(p.envvar), metavar: p.metavar, expose_value: p.expose_value,
  };
  if (isOpt) Object.assign(d, {
    is_flag: p.is_flag, flag_value: jsonable(p.flag_value), count: p.count, hidden: p.hidden, help: p.help,
    show_default: jsonable(p.show_default), prompt: jsonable(p.prompt), hide_input: p.hide_input, is_eager: p.is_eager,
  });
  return d;
};
async function walk(cmd, path, parent) {
  const ctx = new Context(cmd, { info_name: path[path.length - 1], parent });
  const d = {
    path: path.join(" "), type: cmd.constructor.name, name: cmd.name, help: cmd.help, short_help: cmd.short_help,
    epilog: cmd.epilog, hidden: cmd.hidden, deprecated: cmd.deprecated, context_settings: jsonable(cmd.context_settings),
    params: cmd.params.map(param),
  };
  if (cmd instanceof Group) {
    const names = await cmd.listCommands(ctx);
    d.subcommands = names;
    d.children = [];
    for (const n of names) {
      const sub = await cmd.getCommand(ctx, n);
      if (sub) d.children.push(await walk(sub, [...path, n], ctx));
    }
  }
  return d;
}
console.log(JSON.stringify(await walk(cli, ["ebx"], null), null, 1));

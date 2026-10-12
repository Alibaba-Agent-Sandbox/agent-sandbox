// Node counterpart of adv_commands_meta_dump.py. Run: node --import tsx adv_commands_meta_dump.mjs  (HOME isolated)
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fw = await import(pathToFileURL(join(ROOT, "src/framework/index.ts")).href);
const core = await import(pathToFileURL(join(ROOT, "src/framework/core.ts")).href);
const main = await import(pathToFileURL(join(ROOT, "src/cli/main.ts")).href);
const { Context, Group, Option, UNSET } = { ...core, ...fw };

function jv(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "function") return "<callable>";
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isInteger(v) ? v : { __float__: String(v) };
  if (v instanceof fw.PyFloat) return { __float__: String(v.value ?? v) };
  if (Array.isArray(v)) return v.map(jv);
  if (v instanceof Set) return [...v].map(jv).sort();
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), jv(x)]));
  if (typeof v === "object") {
    if (v.constructor && v.constructor !== Object && !("param_type" in v)) return "<" + v.constructor.name + ">";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jv(x)]));
  }
  return String(v);
}
const PARAM_ATTRS = ["name","param_type_name","opts","secondary_opts","required","nargs","multiple","default","envvar","help","hidden","is_flag","flag_value","count","is_eager","expose_value","deprecated","show_default","hide_input","prompt","confirmation_prompt","show_choices","show_envvar","metavar","allow_from_autoenv","prompt_required","_flag_needs_value"];
function paramInfo(p, ctx) {
  const d = {};
  for (const a of PARAM_ATTRS) {
    if (a in p) {
      let v = p[a];
      if (v === UNSET) v = null;
      d[a] = jv(v);
    }
  }
  d.type = jv(p.type.toInfoDict());
  d.has_callback = p.callback != null;
  d.make_metavar = p.makeMetavar(ctx);
  if (p instanceof Option) {
    try { d.default_resolved = jv(p.getDefault(ctx, false) === UNSET ? null : p.getDefault(ctx, false)); } catch (e) { d.default_resolved = "ERR " + e.constructor.name; }
    d.help_record = p.hidden ? null : jv(p.getHelpRecord(ctx));
  }
  return d;
}
const CMD_ATTRS = ["name","help","epilog","short_help","hidden","deprecated","no_args_is_help","options_metavar","add_help_option","context_settings","allow_extra_args","allow_interspersed_args","ignore_unknown_options","invoke_without_command","subcommand_metavar","chain"];
async function cmdInfo(cmd, path) {
  const ctx = new Context(cmd, { info_name: path.join(" ") });
  const d = { class: cmd instanceof Group ? "Group" : "Command" };
  for (const a of CMD_ATTRS) if (a in cmd) d[a] = jv(cmd[a]);
  d.has_callback = cmd.callback != null;
  d.params = cmd.getParams(ctx).map((p) => paramInfo(p, ctx));
  d.usage_pieces = jv(cmd.collectUsagePieces(ctx));
  d.short_help_resolved = cmd.getShortHelpStr(45);
  if (cmd instanceof Group) {
    d.has_result_callback = cmd._result_callback != null;
    d.commands = {};
    for (const n of await cmd.listCommands(ctx)) {
      const sub = await cmd.getCommand(ctx, n);
      if (sub) d.commands[n] = await cmdInfo(sub, [...path, n]);
    }
  }
  return d;
}
await main.cli.whenReady?.();
process.stdout.write(JSON.stringify(await cmdInfo(main.cli, []), null, 1));

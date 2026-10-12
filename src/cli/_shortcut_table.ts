/**
 * Shortcut tables shared by `main` and `commands/config_cmd`. Kept in a leaf module (no import of either) so the two
 * can be loaded in any order.
 */

import { sortedStrings, splitWhitespace } from "../framework/py.js";

/** Core command groups -- always registered, cannot be overridden by shortcuts. Specs are `"commands/<module>:<attr>"`. */
export const _CORE_COMMANDS: Readonly<Record<string, string>> = {
  sandbox: "commands/sandbox:sandbox",
  config: "commands/config_cmd:config",
  mcp: "commands/mcp:mcp",
  provider: "commands/provider:provider",
  template: "commands/template:template",
};

/** Reserved names that user shortcuts cannot override. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(Object.keys(_CORE_COMMANDS).filter((name) => name !== "provider"));

/**
 * Default shortcuts: alias -> human-readable target string. Used by `config_cmd` when generating the default
 * `~/.ebx/config.toml` only. At runtime the config file is the single source of truth -- these values are never merged
 * in implicitly.
 */
export const _DEFAULT_SHORTCUTS: Readonly<Record<string, string>> = {
  create: "sandbox create",
  list: "sandbox list",
  info: "sandbox info",
  kill: "sandbox kill",
  exec: "sandbox exec",
  connect: "sandbox connect",
  upload: "sandbox upload",
  download: "sandbox download",
  run: "sandbox run",
  install: "template install",
  init: "template init",
  deploy: "deploy",
};

/**
 * All valid shortcut targets: human-readable string -> lazy import spec. This includes both default-enabled and
 * additional commands users can enable.
 */
export const _SHORTCUT_TARGET_MAP: Readonly<Record<string, string>> = {
  "sandbox create": "commands/sandbox:create",
  "sandbox list": "commands/sandbox:list_cmd",
  "sandbox info": "commands/sandbox:info",
  "sandbox kill": "commands/sandbox:kill",
  "sandbox exec": "commands/sandbox:exec_cmd",
  "sandbox connect": "commands/sandbox:connect",
  "sandbox upload": "commands/sandbox:upload",
  "sandbox download": "commands/sandbox:download",
  "sandbox run": "commands/sandbox:run_cmd",
  "template install": "commands/template:install_shortcut",
  "template init": "commands/template:init",
  deploy: "commands/deploy:deploy_shortcut",
  "sandbox files list": "commands/sandbox_files:files_list",
  "sandbox process list": "commands/sandbox_process:process_list",
  "sandbox system info": "commands/sandbox_system:system_info",
  "template build": "commands/template:build",
  "template search": "commands/template:search",
};

const _hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Explain an unrecognized shortcut target in plain language.
 *
 * The stored value is the command path only (`template init`), never the full invocation (`ebx template init`). A
 * leading `ebx` is called out on its own; when dropping it leaves a real target, the text includes the command to
 * retry. Any other value gets the same rule plus the target list, grouped by command.
 */
export function _describeInvalidShortcutTarget(target: string, opts: { alias?: string | null } = {}): string {
  const alias = opts.alias ?? null;
  const normalized = splitWhitespace(target).join(" ");
  const sep = normalized.indexOf(" ");
  const head = sep < 0 ? normalized : normalized.slice(0, sep);
  const rest = sep < 0 ? "" : normalized.slice(sep + 1);
  const droppedEbx = head.toLowerCase() === "ebx";
  const stripped = droppedEbx ? rest : null;

  if (stripped && _hasOwn(_SHORTCUT_TARGET_MAP, stripped)) {
    const lines = [`Drop the leading "ebx". The target is the command path only, for example "${stripped}".`];
    if (alias) lines.push(`Try: ebx config set shortcuts.${alias} "${stripped}"`);
    return lines.join("\n");
  }

  let lead: string;
  if (droppedEbx && stripped) {
    lead = `Drop the leading "ebx". "${stripped}" is not a command path. Use a path such as "template init".`;
  } else if (droppedEbx) {
    lead = 'Drop the leading "ebx". The target is the command path only, for example "template init".';
  } else {
    lead = 'Use the command path without the "ebx" prefix, for example "template init".';
  }
  return lead + "\n" + _formatShortcutTargets();
}

/** Render valid shortcut targets grouped by their first word. */
export function _formatShortcutTargets(): string {
  const groups = new Map<string, string[]>();
  const order: string[] = [];
  for (const name of sortedStrings(Object.keys(_SHORTCUT_TARGET_MAP))) {
    const sep = name.indexOf(" ");
    const grp = sep < 0 ? name : name.slice(0, sep);
    const tail = sep < 0 ? "" : name.slice(sep + 1);
    if (!groups.has(grp)) {
      groups.set(grp, []);
      order.push(grp);
    }
    if (tail) (groups.get(grp) as string[]).push(tail);
  }
  const lines = ["Available targets:"];
  for (const grp of order) {
    const tails = groups.get(grp) as string[];
    if (tails.length) lines.push(`  ${grp}: ${tails.join(", ")}`);
    else lines.push(`  ${grp}`);
  }
  return lines.join("\n");
}

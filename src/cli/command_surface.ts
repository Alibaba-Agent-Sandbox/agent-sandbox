/**
 * The fixed `abx` command surface. Hard-coded on purpose: nothing in the user's configuration can add, remove or
 * rename a top-level command. Command specs are `"commands/<module>:<attr>"` lazy import specs.
 *
 * `tests/test_cli/test_command_surface.test.ts` checks `abx --help` against these tables and against
 * `docs/en/reference/cli-commands.md`.
 */

/** Command groups (`abx GROUP ...`). */
export const GROUP_COMMANDS: Readonly<Record<string, { spec: string; help: string }>> = {
  sandbox: { spec: "commands/sandbox:sandbox", help: "Manage sandboxes, their files, processes and commands." },
  template: { spec: "commands/template:template", help: "Discover, scaffold, build, publish and install sandbox templates." },
  config: { spec: "commands/config_cmd:config", help: "Manage persistent credentials and CLI defaults." },
  mcp: { spec: "commands/mcp:mcp", help: "Configure and run Agent Sandbox as an MCP server." },
  provider: { spec: "commands/provider:provider", help: "Install, select and configure sandbox providers." },
};

/** Groups listed under the "Command groups" heading of `abx --help` (`provider` has its own heading). */
export const HELP_GROUPS: ReadonlyArray<string> = ["sandbox", "template", "config", "mcp"];

/**
 * Top-level shortcuts, in help order: name -> spec and the canonical command path they are the same as. Exactly these
 * ten; `deploy` is the headline publish workflow, the other nine are `abx sandbox ...` actions used constantly.
 */
export const SHORTCUTS: Readonly<Record<string, { spec: string; target: string }>> = {
  create: { spec: "commands/sandbox:create", target: "sandbox create" },
  list: { spec: "commands/sandbox:list_cmd", target: "sandbox list" },
  info: { spec: "commands/sandbox:info", target: "sandbox info" },
  kill: { spec: "commands/sandbox:kill", target: "sandbox kill" },
  exec: { spec: "commands/sandbox:exec_cmd", target: "sandbox exec" },
  connect: { spec: "commands/sandbox:connect", target: "sandbox connect" },
  upload: { spec: "commands/sandbox:upload", target: "sandbox upload" },
  download: { spec: "commands/sandbox:download", target: "sandbox download" },
  run: { spec: "commands/sandbox:run_cmd", target: "sandbox command run" },
  deploy: { spec: "commands/deploy:deploy_shortcut", target: "template deploy" },
};

/** Every top-level command name, groups first. */
export const TOP_LEVEL_COMMANDS: ReadonlyArray<string> = [...Object.keys(GROUP_COMMANDS), ...Object.keys(SHORTCUTS)];

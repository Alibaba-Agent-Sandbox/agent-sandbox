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
  provider: { spec: "commands/provider:createProviderGroup", help: "Install, select, configure and run sandbox provider operations." },
};

/** Groups listed under the "Command groups" heading of `abx --help` (`provider` has its own heading). */
export const HELP_GROUPS: ReadonlyArray<string> = ["sandbox", "template", "config", "mcp"];

/**
 * Top-level shortcuts, in help order: name -> purpose, spec and canonical command path. Exactly these
 * ten; `deploy` is the headline publish workflow, the other nine are `abx sandbox ...` actions used constantly.
 */
export const SHORTCUTS: Readonly<Record<string, { spec: string; target: string; help: string }>> = {
  create: { spec: "commands/sandbox:create", target: "sandbox create", help: "Create a sandbox." },
  list: { spec: "commands/sandbox:list_cmd", target: "sandbox list", help: "List sandboxes." },
  info: { spec: "commands/sandbox:info", target: "sandbox info", help: "Show sandbox details." },
  kill: { spec: "commands/sandbox:kill", target: "sandbox kill", help: "Terminate sandboxes." },
  exec: { spec: "commands/sandbox:exec_cmd", target: "sandbox exec", help: "Run a command in a sandbox." },
  connect: { spec: "commands/sandbox:connect", target: "sandbox connect", help: "Open a terminal in a sandbox." },
  upload: { spec: "commands/sandbox:upload", target: "sandbox upload", help: "Upload files to a sandbox." },
  download: { spec: "commands/sandbox:download", target: "sandbox download", help: "Download a file from a sandbox." },
  run: { spec: "commands/sandbox:run_cmd", target: "sandbox command run", help: "Run a registered sandbox command." },
  deploy: { spec: "commands/deploy:deploy_shortcut", target: "template deploy", help: "Build and publish a template." },
};

/** Every top-level command name, groups first. */
export const TOP_LEVEL_COMMANDS: ReadonlyArray<string> = [...Object.keys(GROUP_COMMANDS), ...Object.keys(SHORTCUTS)];

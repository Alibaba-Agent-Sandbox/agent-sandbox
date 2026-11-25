/** Fixed user command contract; Provider selection never switches parsers. */
export const GROUP_COMMANDS: Readonly<Record<string, {spec: string; help: string}>> = {
  template: {spec: "commands/template:template", help: "Discover, create, build and publish reusable templates."},
  config: {spec: "commands/config_cmd:config", help: "Configure credentials, Providers and defaults."},
  provider: {spec: "commands/provider:createProviderGroup", help: "Install Providers and inspect or run native operations."},
  mcp: {spec: "commands/mcp:mcp", help: "Configure and run the local MCP server."},
};
export const HELP_GROUPS: ReadonlyArray<string> = Object.keys(GROUP_COMMANDS);
export const ROOT_COMMANDS: Readonly<Record<string, {spec: string; help: string}>> = {
  sandbox: {spec: "commands/sandbox_api:sandbox", help: "Inspect and invoke a Sandbox's registered API operations."},
  create: {spec: "commands/sandbox:create", help: "Create an instance from a deployed template or Provider-native template ID."},
  deploy: {spec: "commands/deploy:deploy_shortcut", help: "Deploy a template as a named instance."},
  list: {spec: "commands/deployment_management:list", help: "List deployments and Sandboxes."},
  status: {spec: "commands/deployment_management:status", help: "Inspect a deployment or Sandbox ID."},
  logs: {spec: "commands/deployment_management:logs", help: "Read deployment or Sandbox logs."},
  delete: {spec: "commands/deployment_management:deleteDeployment", help: "Delete a deployment or Sandbox ID."},
  recover: {spec: "commands/deployment_management:recover", help: "Inspect and recover an interrupted deployment."},
  exec: {spec: "commands/sandbox:exec_cmd", help: "Execute a program in a Sandbox."},
  connect: {spec: "commands/sandbox:connect", help: "Connect to a Sandbox terminal."},
  upload: {spec: "commands/sandbox:upload", help: "Upload a local file to a Sandbox."},
  download: {spec: "commands/sandbox:download", help: "Download a file from a Sandbox."},
  capabilities: {spec: "commands/sandbox_system:capabilities", help: "Inspect a Sandbox's available runtime capabilities."},
  files: {spec: "commands/sandbox_files:files", help: "Read and manage Sandbox files."},
  process: {spec: "commands/sandbox_process:process", help: "Inspect and control Sandbox processes."},
  system: {spec: "commands/sandbox_system:system", help: "Inspect the Sandbox runtime environment."},
  pause: {spec: "commands/sandbox_native:pause", help: "Pause a Sandbox while retaining its state."},
  resume: {spec: "commands/sandbox_native:resume", help: "Resume a paused Sandbox."},
  metrics: {spec: "commands/sandbox_native:metrics", help: "Read Sandbox resource metrics."},
  snapshot: {spec: "commands/sandbox_native:snapshot", help: "Create, list and delete Sandbox snapshots."},
  fork: {spec: "commands/sandbox_native:fork", help: "Fork a running Sandbox."},
  network: {spec: "commands/sandbox_native:network", help: "Read or update a Sandbox's network policy."},
};
export const TOP_LEVEL_COMMANDS: ReadonlyArray<string> = [...Object.keys(GROUP_COMMANDS), ...Object.keys(ROOT_COMMANDS)];

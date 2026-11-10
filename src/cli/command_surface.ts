/** Fixed user command contract; Provider selection never switches parsers. */
export const GROUP_COMMANDS: Readonly<Record<string, {spec: string; help: string}>> = {
  template: {spec: "commands/template:template", help: "Discover, create, build and publish reusable templates."},
  sandbox: {spec: "commands/sandbox:sandbox", help: "Run commands and manage Sandbox files, processes and advanced lifecycle."},
  config: {spec: "commands/config_cmd:config", help: "Configure credentials, Providers and defaults."},
  provider: {spec: "commands/provider:createProviderGroup", help: "Install Providers and inspect or run native operations."},
  mcp: {spec: "commands/mcp:mcp", help: "Configure and run the local MCP server."},
};
export const HELP_GROUPS: ReadonlyArray<string> = Object.keys(GROUP_COMMANDS);
export const ROOT_COMMANDS: Readonly<Record<string, {spec: string; help: string}>> = {
  deploy: {spec: "commands/deploy:deploy_shortcut", help: "Deploy a template as a named instance."},
  list: {spec: "commands/deployment_management:list", help: "List deployments and Sandboxes."},
  status: {spec: "commands/deployment_management:status", help: "Inspect a deployment or Sandbox ID."},
  logs: {spec: "commands/deployment_management:logs", help: "Read deployment or Sandbox logs."},
  delete: {spec: "commands/deployment_management:deleteDeployment", help: "Delete a deployment or Sandbox ID."},
  recover: {spec: "commands/deployment_management:recover", help: "Inspect and recover an interrupted deployment."},
};
export const TOP_LEVEL_COMMANDS: ReadonlyArray<string> = [...Object.keys(GROUP_COMMANDS), ...Object.keys(ROOT_COMMANDS)];

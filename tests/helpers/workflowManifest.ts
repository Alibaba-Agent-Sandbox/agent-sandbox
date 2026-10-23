/** Complete current workflow fields for test manifests whose scenario concerns other metadata. */
export const WORKFLOW_YAML = `spec_version: 4
workflow_contract_version: 1
provides:
  app: {protocol: agent-sandbox-server, version: 2, port: 9000, operations: [commands.list, commands.run]}
default_workflow: application
workflows:
  application:
    kind: application
    input: source
    service: app
    startup: none
    binding: {transport: http, endpoint: provider-port, caller: host, authentication: none}
    operation: commands.run
    required_operations: []
`;
export function manifestYaml(metadata: string): string { return WORKFLOW_YAML + metadata; }

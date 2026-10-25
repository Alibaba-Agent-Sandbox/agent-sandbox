/** Current whole-template fields for fixtures focused on unrelated metadata. */
export const TEMPLATE_YAML_FIELDS = `spec_version: 5
provides:
  app: {protocol: agent-sandbox-server, version: 2, port: 9000, operations: [commands.list, commands.run]}
`;
export function manifestYaml(metadata: string): string { return TEMPLATE_YAML_FIELDS + metadata; }

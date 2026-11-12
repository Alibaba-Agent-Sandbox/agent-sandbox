/** Canonical resource fixture factory; descriptions/publication metadata are not runtime fields. */
import { parse, stringify } from "yaml";
export const TEMPLATE_YAML_FIELDS = "specVersion: 1\n";
export function manifestYaml(metadata: string): string {
  const fields = parse(metadata) ?? {};
  const services = fields.provides ?? {app: {protocol: "agent-sandbox-server", version: 2, port: 9000, operations: ["commands.list", "commands.run"]}};
  const ports = (fields.ports ?? []).filter((port: number) => !Object.values(services).some(service => (service as {port: number}).port === port));
  return stringify({specVersion: 1, name: fields.name ?? "example", sandbox: {
    template: {source: {dockerfile: "Dockerfile", context: ".", ...(fields.build_profiles ? {profiles: fields.build_profiles} : {})}, props: fields.resources ?? {cpu: 2, memory: 2048}},
    instance: {envs: fields.env ?? {}}, ...(fields.start_cmd ? {start: fields.start_cmd} : {}), ...(fields.ready_cmd ? {ready: fields.ready_cmd} : {}), services, ...(ports.length ? {ports} : {}),
  }});
}

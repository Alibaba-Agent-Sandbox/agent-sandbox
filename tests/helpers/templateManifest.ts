/** Canonical named-resource fixture factory; metadata and instance controls are separate. */
import { parse, stringify } from "yaml";
export const TEMPLATE_YAML_FIELDS = "specVersion: 1\n";
export function manifestYaml(metadata: string): string {
  const fields = parse(metadata) ?? {}, resources = fields.resources ?? {cpu:2,memory:2048};
  const {memory,...props} = resources;
  return stringify({specVersion:1,name:fields.name ?? "example",sandbox:{agent:{provider:fields.provider ?? "alicloud-express",template:{buildConfig:{dockerfile:"Dockerfile",context:"."},...props,...(fields.generation!==undefined?{generation:fields.generation}:{}),...(memory!==undefined?{memorySize:memory}:{}),...(fields.start_cmd?{startCommand:fields.start_cmd}:{}),...(fields.ready_cmd?{readyCommand:fields.ready_cmd}:{})}}}});
}

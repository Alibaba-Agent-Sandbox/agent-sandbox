/** Pure owner-schema admission, shared by discovery and the launch planner. No reference evaluation. */
import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from './contract-v1/schema.json' with {type: 'json'};
import registrySchema from './contract-v1/registry.schema.json' with {type: 'json'};
import { normalizeTemplateV1, compileTemplateV1, schemaForStage } from './contract-v1/normalize.mjs';

const validators = Object.fromEntries(['intent', 'resolved'].map(stage => [stage,
  new Ajv2020({strict: false, allErrors: true}).compile(schemaForStage(schema, stage)),
]));
const registryValidator = new Ajv2020({strict: false, allErrors: true}).compile(registrySchema);

/** Validate catalog metadata without fetching or evaluating its resource document. */
export function normalizeCatalogMetadata(value) {
  if (!registryValidator(value)) throw new TypeError('Invalid Registry v1 publication metadata.');
  return structuredClone(value);
}

/** Validate and default a public resource document without reading secrets or local files. */
export function normalizeProjectIntent(value, options = {}) {
  return normalizeTemplateV1(value, validators.intent, {...options, stage: 'intent'});
}

/** Compile an explicitly native-parser-resolved document into private execution inputs. */
export function compileResolvedProject(value, options = {}) {
  return compileTemplateV1(value, validators.resolved, {...options, stage: 'resolved'});
}

/** Static SandboxTemplate view used for source discovery; unresolved resource quantities stay unknown. */
export function sandboxModelInput(value, options = {}) {
  const intent = normalizeProjectIntent(value, options), sb = intent.sandbox;
  if (!sb) return {specVersion: 1, name: intent.name, provides: {}, env: {}, ports: []};
  return {specVersion: 1, name: intent.name, provides: structuredClone(sb.services), env: structuredClone(sb.instance.envs),
    cpu_count: typeof sb.template.props?.cpu === 'number' ? sb.template.props.cpu : null,
    memory_mb: typeof sb.template.props?.memory === 'number' ? sb.template.props.memory : null,
    ports: [...new Set([...(sb.ports ?? []), ...Object.values(sb.services).map(service => service.port)])].sort((a,b) => a-b),
    ...(sb.provider ? {provider: sb.provider} : {}),
    ...(sb.template.reference ? {template_id: sb.template.reference} : {}),
    ...(sb.template.image ? {image: sb.template.image} : {}),
    ...(sb.template.source?.profiles ? {build_profiles: structuredClone(sb.template.source.profiles)} : {}),
    ...(sb.start ? {start_cmd: sb.start} : {}), ...(sb.ready ? {ready_cmd: sb.ready} : {}),
  };
}

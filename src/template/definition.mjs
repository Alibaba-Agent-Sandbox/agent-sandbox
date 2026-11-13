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

/** Static catalog view. Multiple named resources never silently select the first Sandbox. */
export function sandboxModelInput(value, options = {}) {
  const intent = normalizeProjectIntent(value, options), resources = Object.values(intent.sandbox ?? {});
  const result = {specVersion: 1, name: intent.name, provides: {}, env: {}, ports: []};
  if (resources.length !== 1) return result;
  const sb = resources[0], template = sb.template;
  return {...result,
    cpu_count: typeof template.cpu === 'number' ? template.cpu : null,
    memory_mb: typeof template.memorySize === 'number' ? template.memorySize : null,
    ...(template.reference ? {provider: sb.provider, template_id: template.reference} : {}),
    ...(!template.buildConfig && template.image ? {image: template.image} : {}),
  };
}

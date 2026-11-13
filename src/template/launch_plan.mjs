/** Pure preparation requirements. Resource deployment never creates a dynamic instance. */
import {normalizeProjectIntent} from './definition.mjs';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`Template preparation: ${message}`); };
export function validateTemplateManifest(manifest) { return normalizeProjectIntent(manifest); }
/** Derive template preparation operations for the selected Provider. */
export function planTemplateLaunch(manifest, provider, consumer, prepared = false) {
  manifest = validateTemplateManifest(manifest);
  if (!['cli', 'python-provider'].includes(consumer)) fail('unsupported consumer');
  if (!object(provider) || typeof provider.id !== 'string' || provider.operation_contract_version !== 1 || !object(provider.operations)) fail('unsupported provider operation contract');
  const operations = provider.operations[consumer === 'cli' ? 'cli' : 'python'];
  if (!Array.isArray(operations) || operations.some(operation => typeof operation !== 'string')) fail('invalid provider operations');
  const resources = Object.entries(manifest.sandbox ?? {});
  const reason = resources.some(([,resource]) => resource.provider !== provider.id) ? 'provider-mismatch' : undefined;
  const required = new Set();
  for (const [, resource] of resources) {
    if (!resource.template.reference && !prepared) required.add('template.prepare');
    if (Object.values(resource.volumes ?? {}).some(volume => volume.props)) required.add('volume.create');
  }
  const required_operations = [...required].sort();
  const missing_operations = required_operations.filter(operation => !operations.includes(operation));
  return {supported: !reason && missing_operations.length === 0, required_operations, missing_operations, resources: resources.map(([name]) => name), ...(reason ? {reason} : {})};
}

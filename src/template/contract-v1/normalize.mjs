/** Pure v1 admission/defaulting. Native Devs expressions are never evaluated here. */
import defaults from './contract.json' with {type: 'json'};
import {parseDocument, visit, isScalar} from 'yaml';

export const MAX_YAML_BYTES = 1024 * 1024;

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = value => structuredClone(value);
const ordered = value => Array.isArray(value) ? value.map(ordered) : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const fail = (path, message) => { throw new TypeError(`Template v1 ${path}: ${message}`); };
const expression = value => typeof value === 'string' && value.startsWith('${') && value.endsWith('}');
const safeName = /^[A-Za-z_][A-Za-z0-9_]*$/;

function finite(value, path = '/') {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value) && !Array.isArray(value) && !record(value)) fail(path, 'expected an interoperable JSON value');
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) fail(path, 'expected a finite interoperable JSON number');
  if (Array.isArray(value)) value.forEach((item, index) => finite(item, `${path}/${index}`));
  else if (record(value)) for (const [key, item] of Object.entries(value)) finite(item, `${path === '/' ? '' : path}/${key}`);
}
/** Bounded JSON-compatible YAML1.2 Core; never evaluates native expressions. */
export function parseYamlV1(source) {
  if (typeof source !== 'string' && !(source instanceof Uint8Array)) throw new TypeError('Template v1 /: expected YAML UTF-8 text or bytes');
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
  let bytes, text;
  try {
    bytes = typeof source === 'string' ? encoder.encode(source) : source;
    text = decoder.decode(bytes);
    if (typeof source === 'string' && text !== source) throw new TypeError('invalid Unicode');
  } catch { fail('/', 'YAML must contain valid UTF-8'); }
  if (bytes.byteLength > MAX_YAML_BYTES) fail('/', 'YAML exceeds 1 MiB');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail('/', 'YAML contains unsupported control characters');
  try {
    const doc = parseDocument(text, {schema: 'core', version: '1.2', resolveKnownTags: false, uniqueKeys: true});
    if (doc.errors.length || doc.warnings.length || doc.directives.yaml.version !== '1.2') throw new TypeError('invalid Core document');
    visit(doc, {
      Alias() { throw new TypeError('aliases are unsupported'); },
      Map(_key, node) {
        for (const pair of node.items) if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new TypeError('expected string keys');
      },
      Scalar(_key, node) {
        if (typeof node.value === 'string' && decoder.decode(encoder.encode(node.value)) !== node.value) throw new TypeError('invalid Unicode');
        if (node.tag && !['tag:yaml.org,2002:str', 'tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq'].includes(node.tag)) {
          const implicit = doc.schema.tags.find(tag => tag.default && tag.test?.test(node.source));
          if (!implicit || implicit.tag !== node.tag) throw new TypeError('explicit scalar tags cannot change the Core kind');
        }
      },
    });
    const value = doc.toJS({maxAliasCount: 0});
    finite(value);
    return value;
  } catch { fail('/', 'invalid JSON-compatible YAML1.2 Core: use one document with string keys; duplicate keys, aliases, unsupported tags and unsafe values are not allowed'); }
}

function checked(value, validate) {
  if (typeof validate !== 'function') throw new TypeError('Pass an actual schema validator for the selected validation stage');
  try {
    const result = validate(value);
    if (result && typeof result.then === 'function') fail('/', 'use a synchronous schema validator');
    if (result === false) {
      const first = validate.errors?.[0];
      fail(first?.instancePath || '/', `schema validation failed (${first?.keyword || 'invalid input'})`);
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('Template v1 ')) throw error;
    const location = Array.isArray(error?.path) ? '/' + error.path.join('/') : '/';
    fail(location, 'schema validation failed');
  }
}
function fill(target, values) {
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(target, key)) target[key] = clone(value);
    else if (record(value) && record(target[key])) fill(target[key], value);
  }
}
/** Clone the shape schema for values after the execution engine resolves expressions. */
export function schemaForStage(schema, stage = 'intent') {
  if (!['intent', 'resolved'].includes(stage)) throw new TypeError('Unknown template validation stage');
  const strip = value => {
    if (Array.isArray(value)) return value.map(strip);
    if (!record(value)) return value;
    if (stage === 'resolved' && Array.isArray(value.oneOf) && value.oneOf.at(-1)?.$ref === '#/$defs/expression') return strip(value.oneOf[0]);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, strip(item)]));
  };
  return strip(clone(schema));
}
function localPath(value, path) {
  if (expression(value)) return;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\') || value.includes('\0') || value.split('/').includes('..')) fail(path, 'expected a relative path contained in the template directory');
}
function references(value, found = new Set()) {
  if (typeof value === 'string') for (const match of value.matchAll(/\$\{resources\.([A-Za-z][A-Za-z0-9_-]*)\.output(?:\.[^}]+)?\}/g)) found.add(match[1]);
  else if (Array.isArray(value)) value.forEach(item => references(item, found));
  else if (record(value)) Object.values(value).forEach(item => references(item, found));
  return found;
}
/** Validate named resources without accessing credentials or evaluating expressions. */
export function normalizeTemplateV1(manifest, validate, {stage = 'intent', provider, validateProvider} = {}) {
  if (!['intent', 'resolved'].includes(stage)) throw new TypeError('Unknown template validation stage');
  finite(manifest);
  const result = clone(manifest);
  checked(result, validate);
  const all = {...result.sandbox, ...result.serving};
  for (const name of Object.keys(result.sandbox ?? {})) if (Object.hasOwn(result.serving ?? {}, name)) fail('/sandbox/' + name, 'resource names must be globally unique');
  for (const [name, resource] of Object.entries(result.sandbox ?? {})) {
    const path = '/sandbox/' + name, template = resource.template;
    if (provider && provider !== resource.provider) fail(path + '/provider', 'conflicts with selected Provider context');
    if (template.reference && Object.keys(template).some(key => !['reference', 'region'].includes(key))) fail(path + '/template', 'a borrowed template accepts only reference and region');
    const build = template.buildConfig;
    if (build?.dockerfile) {
      localPath(build.dockerfile, path + '/template/buildConfig/dockerfile');
      if (build.context === undefined && !expression(build.dockerfile)) {
        const parts = build.dockerfile.split('/'); parts.pop(); build.context = parts.join('/') || '.';
      }
      if (build.context !== undefined) localPath(build.context, path + '/template/buildConfig/context');
    }
    if (build?.steps) {
      if (!template.image) fail(path + '/template/image', 'steps require an input image');
      for (const [index, step] of build.steps.entries()) {
        const count = step.args.length;
        if (step.type === 'ENV' && count % 2 !== 0) fail(path + '/template/buildConfig/steps/' + index, 'ENV requires key/value pairs');
        if (step.type === 'WORKDIR' && count !== 1 || ['USER','RUN'].includes(step.type) && count > 2) fail(path + '/template/buildConfig/steps/' + index, 'invalid step argument count');
        if (step.type === 'USER' && count === 2 && !['true','false'].includes(step.args[1])) fail(path + '/template/buildConfig/steps/' + index, 'USER sudo must be a boolean string');
      }
    }
    for (const [volumeName, volume] of Object.entries(resource.volumes ?? {})) {
      if (resource.provider === 'alicloud-express' && volume.props) {
        const storage = ['agenticBucketVolumeConfig','agenticFSVolumeConfig','juiceFSVolumeConfig','ossVolumeConfig'];
        if (storage.filter(key => Object.hasOwn(volume.props, key)).length !== 1) fail(path + '/volumes/' + volumeName + '/props', 'choose exactly one storage backend');
        if (Object.keys(volume.props).some(key => ![...storage,'mountConfig','volumeName'].includes(key))) fail(path + '/volumes/' + volumeName + '/props', 'unsupported Express volume creation field');
      }
    }
    if (stage === 'resolved' && validateProvider) {
      const invoke = (operation, value, where) => {
        try { const accepted = validateProvider(operation, clone(value), resource.provider); if (accepted === false || accepted && typeof accepted.then === 'function') fail(where, 'selected Provider validation failed'); }
        catch { fail(where, 'selected Provider validation failed'); }
      };
      if (!template.reference) invoke('template.prepare', template, path + '/template');
      for (const [volumeName, volume] of Object.entries(resource.volumes ?? {})) if (volume.props) invoke('volume.create', volume.props, path + '/volumes/' + volumeName + '/props');
    }
  }
  const deps = new Map(Object.entries(all).map(([name, resource]) => {
    const {actions, ...configuration} = resource;
    const required = references([configuration, actions?.['pre-deploy']]);
    const after = references([actions?.['success-deploy'], actions?.['fail-deploy'], actions?.['complete-deploy']]);
    after.delete(name); // Post-deployment hooks may read their own ready output.
    return [name, new Set([...required, ...after])];
  }));
  // A vars reference may itself contain a resource reference; be conservative and reject
  // missing names immediately. Runtime ordering follows the expanded resource values.
  for (const ref of references(result.vars ?? {})) if (!Object.hasOwn(all, ref)) fail('/vars', 'resource output reference was not found');
  for (const [name, names] of deps) for (const dep of names) if (!Object.hasOwn(all, dep)) fail('/resources/' + name, 'resource output reference was not found');
  const visited = new Set(), visiting = new Set();
  const visit = name => { if (visiting.has(name)) fail('/resources/' + name, 'cyclic resource output dependency'); if (visited.has(name)) return; visiting.add(name); for (const dep of deps.get(name)) visit(dep); visiting.delete(name); visited.add(name); };
  for (const name of deps.keys()) visit(name);
  checked(result, validate);
  return result;
}
/** Compile resolved input without reconstructing retired application or instance recipes. */
export function compileTemplateV1(manifest, validate, options = {}) {
  if (options.stage && options.stage !== 'resolved') throw new TypeError('Compile requires parser-resolved input');
  const intent = normalizeTemplateV1(manifest, validate, {...options, stage:'resolved'});
  const {specVersion: _, ...result} = intent;
  return {...result, kind: intent.sandbox && intent.serving ? 'application' : intent.serving ? 'serving' : 'sandbox'};
}

/** Decode a non-root standard JSON Pointer without accepting stale/implicit paths. */
export function pointerValue(document, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/u.test(pointer)) fail('/parameters/target', 'expected a non-root JSON Pointer');
  let value = document;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) fail('/parameters/target', 'target was not found');
      value = value[Number(key)];
    } else {
      if (!record(value) || !Object.hasOwn(value, key)) fail('/parameters/target', 'target was not found');
      value = value[key];
    }
  }
  return clone(value);
}

/** Validate optional publication metadata; runtime normalization never reads it. */
export function normalizeRegistryV1(metadata, template, validateRegistry, validateTemplate, {contract = defaults} = {}) {
  finite(metadata); checked(metadata, validateRegistry);
  const result = clone(metadata), intent = normalizeTemplateV1(template, validateTemplate, {contract});
  fill(result, {entry: 'template.yaml', parameters: []});
  const targets = new Set();
  for (const [index, parameter] of result.parameters.entries()) {
    if (targets.has(parameter.target)) fail('/parameters/' + index + '/target', 'duplicate parameter target');
    targets.add(parameter.target);
    const value = pointerValue(intent, parameter.target);
    if (parameter.sensitive) {
      const env = parameter.environmentVariable;
      // This checks exact metadata linkage only. Actual expression evaluation remains native Devs.
      if (!safeName.test(env) || !["${env('" + env + "')}", '${env("' + env + '")}'].includes(value)) fail('/parameters/' + index + '/target', 'a sensitive parameter must target its declared native env expression');
    }
  }
  return result;
}

/** Pure v1 admission/defaulting. Native Devs expressions are never evaluated here. */
import defaults from './contract.json' with {type: 'json'};

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
function localRecipe(recipe, path) {
  fill(recipe, {dockerfile: 'Dockerfile', context: '.'});
  if (recipe.dockerfile.startsWith('/') || recipe.dockerfile.includes('\\') || recipe.dockerfile.split('/').some(part => !part || part === '.' || part === '..') || recipe.dockerfile.includes('\0')) fail(path + '/dockerfile', 'expected a contained relative file path');
}
function fieldAt(value, path) {
  let current = value;
  for (const key of path.split('.')) {
    if (!record(current) || !Object.hasOwn(current, key)) return {found: false};
    current = current[key];
  }
  return {found: true, value: current};
}
function numericOrder(parent, lower, upper, path) {
  if (typeof parent[lower] === 'number' && typeof parent[upper] === 'number' && parent[lower] > parent[upper]) fail(path + '/' + lower, `must be at most ${upper}`);
}

/** Clone the intent schema for post-native-parser validation; does not resolve expressions. */
export function schemaForStage(schema, stage = 'intent') {
  if (!['intent', 'resolved'].includes(stage)) throw new TypeError('Unknown template validation stage');
  const result = clone(schema);
  if (stage === 'resolved') {
    const strip = value => {
      if (Array.isArray(value)) return value.map(strip);
      if (!record(value)) return value;
      if (Array.isArray(value.oneOf) && value.oneOf.at(-1)?.$ref === '#/$defs/expression') {
        const alternatives = value.oneOf.slice(0, -1).map(strip);
        return alternatives.length === 1 ? alternatives[0] : {...value, oneOf: alternatives};
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, strip(item)]));
    };
    const resolved = strip(result);
    resolved.$defs.secret = {type: 'string', minLength: 1};
    resolved.properties.sandbox.required = ['provider', 'template'];
    return resolved;

  }
  return result;
}

/** Validate a v1 document, fill its sole defaults, and check cross-field invariants. */
export function normalizeTemplateV1(manifest, validate, {stage = 'intent', contract = defaults, provider, validateProvider} = {}) {
  if (!['intent', 'resolved'].includes(stage)) throw new TypeError('Unknown template validation stage');
  finite(manifest);
  const result = clone(manifest);
  if (record(result) && record(result.sandbox)) {
    const declared = result.sandbox.provider;
    if (provider && declared && provider !== declared) fail('/sandbox/provider', 'conflicts with the selected Provider context');
    if (!declared && provider) result.sandbox.provider = provider;
    if (!result.sandbox.provider && result.application?.type === 'agents-api') result.sandbox.provider = 'alicloud-express';
  }
  checked(result, validate);
  const sb = result.sandbox, app = result.application;
  if (sb) {
    if (sb.template.source) {
      localRecipe(sb.template.source, '/sandbox/template/source');
      for (const [name, recipe] of Object.entries(sb.template.source.profiles ?? {})) localRecipe(recipe, '/sandbox/template/source/profiles/' + name);
    }
    if (sb.template.reference && sb.template.props && Object.keys(sb.template.props).length) fail('/sandbox/template/props', 'preparation properties cannot modify an existing template reference');
    if (!sb.template.reference) {
      sb.template.props ??= {};
      if (contract.providerInputs[sb.provider]) fill(sb.template.props, {...contract.templateDefaults, ...(app ? {memory: 4096} : {})});
    }
    sb.instance ??= {};
    fill(sb.instance, app ? contract.managedInstanceDefaults : contract.instanceDefaults);
    sb.services ??= {};
    for (const service of Object.values(sb.services)) service.operations ??= [];
    if (sb.instance.lifecycle?.autoResume === true && sb.instance.lifecycle.onTimeout !== 'pause') fail('/sandbox/instance/lifecycle/autoResume', 'requires onTimeout=pause');
    if (sb.provider === 'opensandbox' && sb.instance.gpu && !/^\d+$/.test(sb.instance.gpu) && !expression(sb.instance.gpu)) fail('/sandbox/instance/gpu', 'this adapter accepts a numeric GPU count string');
    const resources = sb.template.props;
    if (contract.providerInputs[sb.provider] && resources && typeof resources.memory === 'number') {
      if (resources.memory < 128 || resources.memory % 64) fail('/sandbox/template/props/memory', 'preparation memory is at least 128 MB and a multiple of 64');
      if (sb.provider === 'alicloud-express' && typeof resources.cpu === 'number' && (resources.memory < resources.cpu * 1024 || resources.memory > resources.cpu * 4096)) fail('/sandbox/template/props/memory', 'Express preparation uses 1024..4096 MB per vCPU');
    }
    if (typeof sb.instance.timeout === 'number' && sb.instance.timeout > 86400) fail('/sandbox/instance/timeout', 'exceeds the high-level API limit of 86400 seconds');
  }
  if (result.deployment) fill(result.deployment, {name: result.name, access: 'default'});
  if (app) {
    if (sb.provider !== 'alicloud-express') fail('/sandbox/provider', 'the current Managed consumer supports alicloud-express only');
    const appDefaults = clone(contract.managedDefaults);
    for (const auth of ['clientAuth', 'internalAuth']) if (Object.hasOwn(app.bindings, auth)) delete appDefaults.bindings[auth];
    fill(app, appDefaults);
    if (app.server.source) localRecipe(app.server.source, '/application/server/source');
    for (const key of ['start', 'ready']) {
      if (Object.hasOwn(sb, key) && sb[key] !== contract.managedSandbox[key]) fail('/sandbox/' + key, 'conflicts with the Managed bridge runtime');
      sb[key] = contract.managedSandbox[key];
    }
    if (Object.keys(sb.services).length && JSON.stringify(ordered(sb.services)) !== JSON.stringify(ordered(contract.managedSandbox.services))) fail('/sandbox/services', 'the Managed bridge service is fixed by this application type');
    sb.services = clone(contract.managedSandbox.services);
    const selected = Object.values(app.roles);
    if (new Set(selected).size !== 3) fail('/application/roles', 'each Managed role needs a distinct declared resource');
    const resourceNames = new Set(Object.keys(result.deployment.resources));
    for (const [role, id] of Object.entries(app.roles)) {
      if (!resourceNames.has(id)) fail('/application/roles/' + role, 'resource reference was not found');
      const resource = result.deployment.resources[id];
      if (!/^fc3@\d+\.\d+\.\d+$/.test(resource.component)) fail('/deployment/resources/' + id + '/component', 'the current Managed consumer requires a pinned fc3 component');
      if (record(resource.props) && resource.props.runtime !== undefined && resource.props.runtime !== 'custom-container' && !expression(resource.props.runtime)) fail('/deployment/resources/' + id + '/props/runtime', 'the Managed bridge requires custom-container');
      if (record(resource.props)) for (const path of contract.protectedManagedProps) if (fieldAt(resource.props, path).found) fail('/deployment/resources/' + id + '/props/' + path.replaceAll('.', '/'), 'this value is generated by the Managed coordinator');
    }
    const components = selected.map(id => result.deployment.resources[id].component);
    if (new Set(components).size !== 1) fail('/application/roles', 'current Managed roles share one locked fc3 component version');
    if (typeof app.sessions.idleTimeoutSeconds === 'number' && typeof sb.instance.timeout === 'number' && app.sessions.idleTimeoutSeconds > sb.instance.timeout) fail('/application/sessions/idleTimeoutSeconds', 'must be at most sandbox.instance.timeout');
    numericOrder(app.limits, 'maxToolSeconds', 'maxRunSeconds', '/application/limits');
    if (typeof app.limits.maxRunSeconds === 'number' && typeof sb.instance.timeout === 'number' && app.limits.maxRunSeconds >= sb.instance.timeout) fail('/application/limits/maxRunSeconds', 'must be less than sandbox.instance.timeout');
    numericOrder(app.storage, 'maxArtifactBytes', 'maxTurnArtifactBytes', '/application/storage');
    numericOrder(app.storage, 'maxFileBytes', 'maxRetainedBytesPerOwner', '/application/storage');
    numericOrder(app.storage, 'maxTurnArtifactBytes', 'maxRetainedBytesPerOwner', '/application/storage');
    if (stage === 'resolved') {
      const regions = selected.map(id => result.deployment.resources[id].props.region);
      if (regions.some(region => typeof region !== 'string' || !/^cn-[a-z0-9-]+$/.test(region)) || new Set(regions).size !== 1) fail('/application/roles', 'resolved Managed roles need the same supported literal region');
      const roleArns = selected.map(id => result.deployment.resources[id].props.role).filter(value => value !== undefined);
      if (roleArns.length && (roleArns.some(value => typeof value !== 'string' || !value) || new Set(roleArns).size !== 1)) fail('/application/roles', 'the current Managed consumer uses one function RAM role');
      if (roleArns.length && app.bindings.internalAuth.roleArn && roleArns[0] !== app.bindings.internalAuth.roleArn) fail('/application/bindings/internalAuth/roleArn', 'conflicts with the declared native function role');
      if (app.bindings.sandboxAccess.region !== regions[0]) fail('/application/bindings/sandboxAccess/region', 'must match the resolved Managed FC region');
    }
  }
  checked(result, validate);
  if (sb) {
    if (stage === 'resolved' && !contract.providerInputs[sb.provider] && typeof validateProvider !== 'function') fail('/sandbox/provider', 'the selected plugin must supply real preparation/create validators');
    if (stage === 'resolved' && validateProvider && sb.provider) {
      const invoke = (stage, value, path) => {
        try {
          const accepted = validateProvider(stage, clone(value), sb.provider);
          if (accepted === false || accepted && typeof accepted.then === 'function') fail(path, 'selected Provider validation failed');
        } catch { fail(path, 'selected Provider validation failed'); }
      };
      if (!sb.template.reference) invoke('template.prepare', sb.template, '/sandbox/template');
      invoke('sandbox.create', sb.instance, '/sandbox/instance');
    }
  }
  return result;
}

/** Compile only resolved v1 input to private execution fields; never emit old spec versions. */
export function compileTemplateV1(manifest, validate, {stage = 'resolved', contract = defaults, provider, validateProvider} = {}) {
  if (stage !== 'resolved') throw new TypeError('Compile requires native-parser-resolved input');
  const intent = normalizeTemplateV1(manifest, validate, {stage, contract, provider, validateProvider});
  const result = {name: intent.name, kind: intent.application ? 'application' : intent.deployment ? 'serving' : 'sandbox'};
  if (intent.deployment) result.deployment = clone(intent.deployment);
  if (intent.sandbox) {
    const sb = intent.sandbox;
    Object.assign(result, {sandbox: clone(sb), provider: sb.provider, provides: clone(sb.services), env: clone(sb.instance.envs), ports: [...new Set([...(sb.ports ?? []), ...Object.values(sb.services).map(service => service.port)])].sort((a, b) => a - b), resources: clone(sb.template.props ?? {}), start_cmd: sb.start ?? null, ready_cmd: sb.ready ?? null});
    if (sb.template.aliases) result.aliases = clone(sb.template.aliases);
    if (sb.template.source?.profiles) result.build_profiles = clone(sb.template.source.profiles);
    if (sb.template.image) result.image = sb.template.image;
    if (sb.template.reference) result.template_id = sb.template.reference;
  }
  if (intent.application) {
    const app = intent.application, dep = intent.deployment, profile = clone(contract.managedProfile);
    const gateway = dep.resources[app.roles.gateway];
    const bindingValues = {state: clone(app.state), ...clone(app.bindings)};
    bindingValues.sandboxAccess.provider = intent.sandbox.provider;
    const nativeRole = Object.values(app.roles).map(id => dep.resources[id].props.role).find(value => value !== undefined);
    if (nativeRole !== undefined) bindingValues.internalAuth.roleArn = nativeRole;
    const compiled = clone(profile.defaults);
    fill(compiled, {sessions: app.sessions, limits: app.limits, storage: app.storage});
    compiled.sessions = {...compiled.sessions, ...clone(app.sessions), maxLifetimeSeconds: intent.sandbox.instance.timeout};
    compiled.limits = clone(app.limits);
    compiled.storage = {...compiled.storage, ...clone(app.storage)};
    compiled.sandbox.provider = intent.sandbox.provider;
    compiled.state = {...compiled.state, bindingRef: 'state'};
    compiled.bindings = Object.fromEntries(Object.entries(profile.bindings).map(([name, options]) => [name, {reference: name, ...clone(options)}]));
    compiled.deployment = {...compiled.deployment, profile: 'fc-managed-agents', accessRef: dep.access, region: gateway.props.region, component: gateway.component, ingressBindingRef: 'ingress', ...(app.server.source ? {serverBuildRecipe: clone(app.server.source)} : {serverImage: app.server.image})};
    if (app.hooks) compiled.hooks = clone(app.hooks);
    result.application = compiled;
    result.bindingValues = bindingValues;
    result.roleResources = clone(app.roles);
    result.roleProps = Object.fromEntries(Object.entries(app.roles).map(([role, id]) => [role, clone(dep.resources[id].props)]));
  }
  return result;
}

/** Decode a non-root standard JSON Pointer without accepting stale/implicit paths. */
export function pointerValue(document, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/u.test(pointer)) fail('/questions/target', 'expected a non-root JSON Pointer');
  let value = document;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) fail('/questions/target', 'target was not found');
      value = value[Number(key)];
    } else {
      if (!record(value) || !Object.hasOwn(value, key)) fail('/questions/target', 'target was not found');
      value = value[key];
    }
  }
  return clone(value);
}

/** Validate optional publication metadata; runtime normalization never reads it. */
export function normalizeRegistryV1(metadata, template, validateRegistry, validateTemplate, {contract = defaults} = {}) {
  finite(metadata); checked(metadata, validateRegistry);
  const result = clone(metadata), intent = normalizeTemplateV1(template, validateTemplate, {contract});
  fill(result, {entry: 'template.yaml', questions: []});
  const targets = new Set();
  for (const [index, question] of result.questions.entries()) {
    if (targets.has(question.target)) fail('/questions/' + index + '/target', 'duplicate question target');
    targets.add(question.target);
    const value = pointerValue(intent, question.target);
    if (question.sensitive) {
      const env = question.environmentVariable;
      // This checks exact metadata linkage only. Actual expression evaluation remains native Devs.
      if (!safeName.test(env) || !["${env('" + env + "')}", '${env("' + env + '")}'].includes(value)) fail('/questions/' + index + '/target', 'a sensitive question must target its declared native env expression');
    }
  }
  return result;
}

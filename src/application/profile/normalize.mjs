/** Pure profile expansion. Validation remains the consumer's next required step. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function applicationProfile(manifest) {
  const deployment = manifest?.application?.deployment;
  if (!object(deployment) || !Object.hasOwn(deployment, 'profile')) return null;
  return deployment.profile;
}

function fill(target, defaults) {
  if (!object(target)) return;
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(target, key)) target[key] = structuredClone(value);
    else if (object(value)) fill(target[key], value);
  }
}

export function normalizeApplicationProfile(manifest, catalog) {
  const result = structuredClone(manifest);
  const profile = applicationProfile(manifest);
  if (profile === null && !Object.hasOwn(manifest?.application?.deployment ?? {}, 'profile')) return result;
  if (typeof profile !== 'string' || !Object.hasOwn(catalog.profiles, profile)) {
    throw new Error(`Unsupported application deployment profile: ${String(profile)}`);
  }
  const contract = catalog.profiles[profile];
  const app = result.application;
  fill(app, contract.defaults);
  if (object(app.bindings)) {
    for (const [role, defaults] of Object.entries(contract.bindings)) {
      const name = role === 'state' ? app.state?.bindingRef
        : role === 'ingress' ? app.deployment?.ingressBindingRef : role;
      if (typeof name === 'string' && Object.hasOwn(app.bindings, name)) fill(app.bindings[name], defaults);
    }
  }
  return result;
}

/** Pure validation and preparation requirements for launching a whole template. */
import contract from "./launch-v1.json" with {type: "json"};
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new TypeError(`Template launch: ${message}`); };
const strings = value => Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0) && new Set(value).size === value.length;
/** Validate application declarations without inferring platform capabilities from installed software. */
export function validateTemplateManifest(manifest) {
  if (!object(manifest)) fail("manifest must be an object");
  if (manifest.specVersion !== contract.template_spec_version || Object.hasOwn(manifest, "spec_version")) fail("use the specVersion: 1 resource structure");
  if (Object.keys(manifest).some(key => !contract.template_keys.includes(key))) fail("launch requires a standalone v1 Sandbox resource; unknown or retired root field");
  if (typeof manifest.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(manifest.name)) fail("invalid resource name");
  const sandbox = manifest.sandbox;
  if (!object(sandbox) || !object(sandbox.template)) fail("sandbox.template is required");
  if (Object.keys(sandbox).some(key => !["provider", "template", "instance", "start", "ready", "services", "ports"].includes(key))) fail("unknown Sandbox field");
  const template = sandbox.template;
  if (["source", "image", "reference"].filter(key => Object.hasOwn(template, key)).length !== 1) fail("select exactly one template source, image or reference");
  if (Object.keys(template).some(key => !["source", "image", "reference", "aliases", "props"].includes(key))) fail("unknown template field");
  if (template.source !== undefined && (!object(template.source) || (template.source.dockerfile !== undefined && (typeof template.source.dockerfile !== "string" || !template.source.dockerfile)))) fail("invalid source recipe");
  for (const key of ["image", "reference"]) if (Object.hasOwn(template, key) && (typeof template[key] !== "string" || !template[key].trim())) fail(`invalid template ${key}`);
  for (const key of ["start", "ready", "provider"]) if (Object.hasOwn(sandbox, key) && (typeof sandbox[key] !== "string" || !sandbox[key].trim())) fail(`invalid sandbox ${key}`);
  if (template.reference && !sandbox.provider) fail("a native template reference requires its owning provider");
  const services = sandbox.services ?? {};
  if (sandbox.ports !== undefined && (!Array.isArray(sandbox.ports) || sandbox.ports.some(port => !Number.isSafeInteger(port) || port < 1 || port > 65535) || new Set(sandbox.ports).size !== sandbox.ports.length)) fail("invalid additional Sandbox ports");
  if (!object(services)) fail("sandbox.services must be an object");
  for (const [id, service] of Object.entries(services)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || !object(service)) fail("invalid service declaration");
    if (Object.keys(service).some(key => !contract.service_keys.includes(key))) fail("unknown service field");
    if (typeof service.protocol !== "string" || !service.protocol || !Number.isSafeInteger(service.version) || service.version < 1 ||
      !Number.isSafeInteger(service.port) || service.port < 1 || service.port > 65535 || !strings(service.operations ?? [])) fail("invalid service protocol/version/port/operations");
  }
  return structuredClone(manifest);
}
/** Derive platform requirements from the template; there is no selectable execution flow. */
export function planTemplateLaunch(manifest, provider, consumer, prepared = false) {
  manifest = validateTemplateManifest(manifest);
  const sandbox = manifest.sandbox, template = sandbox.template, services = sandbox.services ?? {};
  if (!["cli", "python-provider"].includes(consumer)) fail("unsupported launch consumer");
  if (!object(provider) || typeof provider.id !== "string" || !provider.id || provider.operation_contract_version !== 1 || !object(provider.operations)) fail("unsupported provider operation contract");
  const operations = provider.operations[consumer === "cli" ? "cli" : "python"];
  if (!Array.isArray(operations) || operations.some(operation => typeof operation !== "string")) fail("invalid provider operations");
  const input = template.reference ? "managed" : template.image ? "image" : "source";
  const startup = sandbox.start ? "exec" : input === "managed" ? "none" : "entrypoint";
  const reason = sandbox.provider && sandbox.provider !== provider.id ? "provider-mismatch"
    : !(prepared && input === "source") && !provider.workflow_inputs?.includes(input) ? "input-unimplemented"
    : !provider.startup_modes?.includes(startup) ? "startup-unimplemented" : undefined;
  const required = new Set(["sandbox.create", "sandbox.delete"]);
  if (input === "source" && !prepared) required.add("template.prepare");
  if (sandbox.start || sandbox.ready) required.add("exec.run");
  if (Object.keys(services).length || sandbox.ports?.length) required.add("ports.resolve");
  const required_operations = [...required].sort();
  const missing_operations = required_operations.filter(operation => !operations.includes(operation));
  return {supported: !reason && missing_operations.length === 0, required_operations, missing_operations, services: structuredClone(services), ...(reason ? {reason} : {})};
}

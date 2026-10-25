/** Pure validation and preparation requirements for launching a whole template. */
import contract from "./launch-v1.json" with {type: "json"};
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new TypeError(`Template launch: ${message}`); };
const strings = value => Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0) && new Set(value).size === value.length;
/** Validate application declarations without inferring platform capabilities from installed software. */
export function validateTemplateManifest(manifest) {
  if (!object(manifest)) fail("manifest must be an object");
  if (manifest.spec_version !== 5 || ["workflow_contract_version", "default_workflow", "workflows"].some(key => Object.hasOwn(manifest, key)))
    fail("use spec_version: 5 and remove workflow_contract_version, default_workflow and workflows; keep start_cmd, ready_cmd and all provides services");
  for (const key of contract.retired_keys) if (Object.hasOwn(manifest, key)) fail(`retired field ${key}`);
  if (!object(manifest.provides)) fail("provides must be an object");
  for (const [id, service] of Object.entries(manifest.provides)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || !object(service)) fail("invalid service declaration");
    if (Object.keys(service).some(key => !["protocol", "version", "port", "operations"].includes(key))) fail("unknown service field");
    if (typeof service.protocol !== "string" || !service.protocol || !Number.isSafeInteger(service.version) || service.version < 1 ||
      !Number.isSafeInteger(service.port) || service.port < 1 || service.port > 65535 || !strings(service.operations)) fail("invalid service protocol/version/port/operations");
  }
  for (const key of ["start_cmd", "ready_cmd", "image", "template_id", "provider"]) {
    if (Object.hasOwn(manifest, key) && (typeof manifest[key] !== "string" || !manifest[key].trim())) fail(`invalid ${key}`);
  }
  if (manifest.image && manifest.template_id) fail("image and template_id cannot both be set");
  if (Object.hasOwn(manifest, "template_id") !== Object.hasOwn(manifest, "provider")) fail("template_id requires its owning provider");
  return structuredClone(manifest);
}
/** Derive platform requirements from the template; there is no selectable execution flow. */
export function planTemplateLaunch(manifest, provider, consumer, prepared = false) {
  validateTemplateManifest(manifest);
  if (!["cli", "python-provider"].includes(consumer)) fail("unsupported launch consumer");
  if (!object(provider) || typeof provider.id !== "string" || !provider.id || provider.operation_contract_version !== 1 || !object(provider.operations)) fail("unsupported provider operation contract");
  const operations = provider.operations[consumer === "cli" ? "cli" : "python"];
  if (!Array.isArray(operations) || operations.some(operation => typeof operation !== "string")) fail("invalid provider operations");
  const input = manifest.template_id ? "managed" : manifest.image ? "image" : "source";
  const startup = manifest.start_cmd ? "exec" : input === "managed" ? "none" : "entrypoint";
  const reason = manifest.template_id && manifest.provider !== provider.id ? "provider-mismatch"
    : !(prepared && input === "source") && !provider.workflow_inputs?.includes(input) ? "input-unimplemented"
    : !provider.startup_modes?.includes(startup) ? "startup-unimplemented" : undefined;
  const required = new Set(["sandbox.create", "sandbox.delete"]);
  if (input === "source" && !prepared) required.add("template.prepare");
  if (manifest.start_cmd || manifest.ready_cmd) required.add("exec.run");
  if (Object.keys(manifest.provides).length) required.add("ports.resolve");
  const required_operations = [...required].sort();
  const missing_operations = required_operations.filter(operation => !operations.includes(operation));
  return {supported: !reason && missing_operations.length === 0, required_operations, missing_operations, services: structuredClone(manifest.provides), ...(reason ? {reason} : {})};
}

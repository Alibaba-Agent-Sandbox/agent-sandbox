/** Shared workflow planner. Pure data evaluation: no CLI, plugin, filesystem or network access. */
import contract from "./workflow-v1.json" with { type: "json" };
import profiles from "./verification-profiles.json" with { type: "json" };
export const workflowContract = contract;
export const verificationProfiles = profiles;
const error = message => { throw new TypeError(`Workflow input: ${message}`); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const keys = (value, allowed, required = allowed) => {
  if (!object(value)) error("expected object");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) error(`unknown field ${key}`);
  for (const key of required) if (!own(value, key)) error(`missing field ${key}`);
};
function domain(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) error("numbers must be safe integers");
  if (Array.isArray(value)) value.forEach(domain);
  else if (object(value)) Object.values(value).forEach(domain);
}
function strings(value) {
  if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !v) || new Set(value).size !== value.length) error("expected unique nonempty strings");
}
/** Strict new workflow contract. General descriptive metadata belongs to the template schema owner. */
export function validateWorkflowManifest(manifest) {
  if (!object(manifest)) error("manifest must be an object");
  for (const key of contract.template_keys) domain(manifest[key]);
  for (const key of contract.retired_keys) if (own(manifest, key)) error(`retired field ${key}`);
  for (const key of contract.template_keys) if (!own(manifest, key)) error(`missing field ${key}`);
  if (manifest.spec_version !== contract.template_spec_version || manifest.workflow_contract_version !== contract.version) error("unsupported contract version");
  if (!object(manifest.provides) || !object(manifest.workflows) || !Object.keys(manifest.workflows).length) error("provides/workflows must be objects");
  if (typeof manifest.default_workflow !== "string" || !own(manifest.workflows, manifest.default_workflow)) error("default workflow must exist");
  for (const [id, service] of Object.entries(manifest.provides)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) error("invalid service id");
    keys(service, contract.service_keys);
    if (typeof service.protocol !== "string" || !service.protocol || !Number.isSafeInteger(service.version) || service.version <= 0 ||
      !Number.isSafeInteger(service.port) || service.port < 1 || service.port > 65535) error("invalid service protocol/version/port");
    strings(service.operations);
  }
  for (const [id, workflow] of Object.entries(manifest.workflows)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) error("invalid workflow id");
    keys(workflow, contract.workflow_keys, contract.workflow_required);
    for (const [key, values] of [["kind", contract.kinds], ["input", contract.inputs], ["startup", contract.startups]])
      if (!values.includes(workflow[key])) error(`invalid ${key}`);
    keys(workflow.binding, contract.binding_keys);
    for (const key of contract.binding_keys) if (!contract.binding_values[key].includes(workflow.binding[key])) error(`invalid binding.${key}`);
    strings(workflow.required_operations);
    for (const operation of workflow.required_operations) if (!own(contract.operations, operation)) error(`unknown required operation ${operation}`);
    if (workflow.kind === "application") {
      if (typeof workflow.service !== "string" || !own(manifest.provides, workflow.service)) error("application service must exist");
      if (!manifest.provides[workflow.service].operations.includes(workflow.operation)) error("application operation not provided");
    } else {
      if (own(workflow, "service")) error("service only belongs to an application workflow");
      if (!own(contract.operations, workflow.operation)) error("unknown workflow operation");
      if (workflow.kind === "exec" && !["exec.run", "exec.stream"].includes(workflow.operation)) error("exec workflow requires exec operation");
      if (workflow.kind === "interpreter" && !workflow.operation.startsWith("code.")) error("interpreter workflow requires code operation");
    }
    if (workflow.input === "service" && workflow.startup !== "none") error("service input cannot start a sandbox");
    if (workflow.startup === "exec" && (typeof manifest.start_cmd !== "string" || !manifest.start_cmd.trim())) error("exec startup requires start_cmd");
    if (manifest.ready_cmd !== undefined && (typeof manifest.ready_cmd !== "string" || !manifest.ready_cmd.trim())) error("invalid ready_cmd");
  }
  return Object.fromEntries(contract.template_keys.map(key => [key, manifest[key]]));
}
const lookup = (value, field) => field.split(".").reduce((v, key) => v?.[key], value);
/** Produce the same normalized static requirements for every consumer. Environment checks remain separate. */
export function planWorkflow(manifest, provider, workflowId, consumer) {
  validateWorkflowManifest(manifest);
  if (!contract.consumers.includes(consumer)) error("unknown consumer");
  if (!object(provider) || typeof provider.id !== "string" || !provider.id || provider.operation_contract_version !== contract.version) error("unsupported provider contract");
  keys(provider.operations, ["cli", "python"]);
  for (const operations of Object.values(provider.operations)) {
    strings(operations);
    for (const operation of operations) if (!own(contract.operations, operation)) error(`unknown provider operation ${operation}`);
  }
  for (const [field, allowed] of Object.entries(contract.provider_fields)) {
    strings(provider[field]);
    if (provider[field].some(value => !allowed.includes(value))) error(`invalid provider ${field}`);
  }
  const id = workflowId ?? manifest.default_workflow;
  if (typeof id !== "string" || !own(manifest.workflows, id)) error("unknown selected workflow");
  const workflow = manifest.workflows[id];
  const service = workflow.kind === "application" ? manifest.provides[workflow.service] : null;
  const requirements = [];
  const add = (operation, phase, owner) => {
    let state = "T", reason = "implemented";
    if (consumer === "native-sdk") { state = "U"; reason = "consumer-unverified"; }
    else if (owner === "consumer") {
      const client = contract.clients[consumer]?.[service?.protocol];
      if (!client?.versions.includes(service.version) || !client.operations.includes(operation) || workflow.binding.transport !== "http" ||
          (consumer !== "native-sdk" && (workflow.binding.caller !== "host" || !["provider-port", "explicit-url"].includes(workflow.binding.endpoint)))) {
        state = "F"; reason = "client-unimplemented";
      }
    } else if (consumer === "server-client") { state = "F"; reason = "client-unimplemented"; }
    else if (!provider.operations[consumer === "cli" ? "cli" : "python"].includes(operation)) { state = "F"; reason = "adapter-unimplemented"; }
    const requirement = { operation, phase, owner, state, reason };
    if (!requirements.some(r => r.operation === operation && r.phase === phase && r.owner === owner)) requirements.push(requirement);
  };
  for (const rule of contract.rules) if (Object.entries(rule.when).every(([field, values]) => values.includes(lookup(workflow, field))))
    for (const operation of rule.operations) add(operation, rule.phase, rule.owner);
  add(workflow.operation, "before-invoke", workflow.kind === "application" ? "consumer" : "provider");
  for (const operation of workflow.required_operations) add(operation, "before-invoke", "provider");
  for (const constraint of contract.constraints) {
    if (!Object.entries(constraint.when).every(([field, values]) => values.includes(lookup(workflow, field)))) continue;
    const roots = { workflow, provider, manifest };
    const left = lookup(roots, constraint.left), right = lookup(roots, constraint.right);
    const satisfied = left == null || right == null ? null : constraint.test === "equal" ? left === right : Array.isArray(right) && right.includes(left);
    requirements.push({ operation: constraint.operation, phase: constraint.phase, owner: constraint.owner,
      state: satisfied === null ? "U" : satisfied ? "T" : "F", reason: satisfied === null ? "configuration-missing" : satisfied ? "implemented" : constraint.reason });
  }
  requirements.sort((a, b) => contract.phases.indexOf(a.phase) - contract.phases.indexOf(b.phase) || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0) || (a.operation < b.operation ? -1 : a.operation > b.operation ? 1 : 0));
  const state = requirements.some(r => r.state === "F") ? "F" : requirements.some(r => r.state === "U") ? "U" : "T";
  return { contract_version: contract.version, workflow_id: id, consumer, state, requirements, binding: workflow.binding,
    kind: workflow.kind, input: workflow.input, service };
}

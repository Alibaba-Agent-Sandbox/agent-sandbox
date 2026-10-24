import { withGuidedConfiguration, canGuideConfiguration } from "./config_guidance.js";
import { confirm } from "./prompts.js";
/** Download, ask the selected adapter to prepare, then create using its returned reference. */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { planWorkflow, validateWorkflowManifest } from "../template/workflow_plan.mjs";
import { providerContentDigest } from "../providers/content_identity.js";
import { digestDir } from "../providers/store.js";
import { requestApplication, requireApplicationOperation, checkApplicationHealth, validateApplicationEndpoint } from "../transport/application_http.js";
import { ProjectToolError, stageProject } from "../providers/shared/project.js";
import { ResourceJournal } from "../template/resource_journal.js";
import { pyExpandUser } from "../utils/_pyos.js";
import type { Provider } from "../providers/base.js";
import { loadYaml, isMapping } from "../utils/yaml_io.js";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "./kit.js";
import { getFormatter } from "./formatters.js";
import { getOutput } from "./output.js";
import { UsageError } from "./errors.js";
import { providerCliExtension } from "./provider_extensions.js";
import { getProvider, resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError } from "../models/provider_errors.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { parseTemplateData } from "../api/capability.js";
import { RegistryClient } from "../utils/registry.js";
import { _findTemplateYaml, _resolveIndexName, _withGithubRateLimitRetry } from "./template_catalog.js";
import { resolveGithubToken } from "./commands/config_cmd.js";
import { Sandbox, _effectiveOptions } from "../api/sandbox.js";
import type { PreparedTemplate, ProjectTemplateOptions, ProviderTemplateManager } from "../providers/template_contract.js";

export const launchSeams = { create: (options: Parameters<typeof Sandbox.create>[0]) => Sandbox.create(options) };

/** Validate a known local source before any credential prompt; remote sources are validated once after acquisition. */
function readLaunchProject(provider: Provider, directory: string, params: Record<string, unknown>) {
  const yaml = _findTemplateYaml(directory);
  if (!yaml) throw new ProviderConfigError("Template source has no template.yaml.");
  // The YAML's parent is the build context even when a repository contains several projects.
  directory = path.dirname(yaml);
  const manifestBytes = fs.readFileSync(yaml);
  const manifestDigest = createHash("sha256").update(manifestBytes).digest("hex");
  const raw = loadYaml(manifestBytes.toString("utf8"));
  if (!isMapping(raw)) throw new ProviderConfigError("Template must contain a workflow manifest.");
  const sourceMetadata = raw as Record<string, unknown>;
  validateWorkflowManifest(sourceMetadata);
  const template = parseTemplateData(structuredClone(sourceMetadata));
  const workflowId = params["workflow"] === undefined || params["workflow"] === null ? undefined : String(params["workflow"]);
  const plan = planWorkflow(sourceMetadata, provider, workflowId, "cli");
  if (plan.state !== "T") throw new ProviderConfigError(`Selected workflow is unavailable: ${plan.requirements.filter(r => r.state !== "T").map(r => `${r.operation} (${r.reason})`).join(", ")}.`);
  if (plan.binding.authentication === "service-token" && (!process.env["ABX_SERVER_TOKEN"] || /[\r\n]/.test(process.env["ABX_SERVER_TOKEN"]!)))
    throw new ProviderConfigError("Selected application identity requires ABX_SERVER_TOKEN before preparing or creating resources.");
  const workflow = (sourceMetadata["workflows"] as Record<string, { startup: string; input: string }>)[plan.workflow_id];
  const aliasBase = String(params["alias"] ?? template.name);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(aliasBase)) throw new ProviderConfigError("Template alias must be a lowercase name of at most 63 characters.");
  // Each build request uses a fresh correlation name; an uncertain prior request is never retried under the same name.
  const alias = `${aliasBase.slice(0, 42)}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const timeout = Number(params["timeout"] ?? 600);
  const selectedProfile = params["build_profile"];
  let buildProfile: ProjectTemplateOptions["build_profile"];
  if (selectedProfile !== undefined && selectedProfile !== null) {
    const profiles = sourceMetadata["build_profiles"];
    const profile = isMapping(profiles) ? profiles[String(selectedProfile)] : undefined;
    if (!isMapping(profile) || Object.keys(profile).some(key => !["dockerfile", "context"].includes(key)) || profile["context"] !== "." || typeof profile["dockerfile"] !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(profile["dockerfile"])) throw new ProviderConfigError("Select a declared root build profile with dockerfile and context: .");
    buildProfile = { id: String(selectedProfile), dockerfile: profile["dockerfile"], context: "." };
  }
  const options: ProjectTemplateOptions = { build_profile: buildProfile, alias, timeout, workflow, template: { name: template.name,
    cpu: template.cpu_count ?? 2, memory: template.memory_mb ?? 2048,
    start_cmd: workflow.startup === "exec" ? String(sourceMetadata["start_cmd"]) : null,
    ready_cmd: sourceMetadata["ready_cmd"] === undefined ? null : String(sourceMetadata["ready_cmd"]) } };
  return { directory, template, options, plan, sourceMetadata, manifestDigest };
}

/** One explicit operation; never guesses an ID or falls back to another backend. */
export async function launchTemplate(ctx: Context, params: Record<string, unknown>): Promise<void> {
  const provider = getProvider(resolveProviderId(cliProvider()));
  const applicationToken = process.env["ABX_SERVER_TOKEN"];
  const timeoutInput = Number(params["timeout"] ?? 600), sandboxTimeoutInput = Number(params["sandbox_timeout"] ?? 300);
  if (!Number.isFinite(timeoutInput) || timeoutInput <= 0 || timeoutInput > 3600 || !Number.isFinite(sandboxTimeoutInput) || sandboxTimeoutInput <= 0) throw new ProviderConfigError("Build timeout must be in (0, 3600] and sandbox timeout must be positive.");
  const source = String(params["template_ref"]);
  const initialDirectory = path.resolve(pyExpandUser(source));
  const exists = fs.existsSync(initialDirectory);
  const isLocal = exists && fs.statSync(initialDirectory).isDirectory();
  if (exists && !isLocal) throw new UsageError("Template project source is not a directory.");
  if (!exists && (path.isAbsolute(source) || source.startsWith("./") || source.startsWith("../") || source.startsWith("~/"))) throw new UsageError("Template project directory does not exist. Create it with 'abx template scaffold DIRECTORY' or choose an existing template source.");
  const localProject = isLocal ? readLaunchProject(provider, initialDirectory, params) : null;
  const externalService = localProject?.plan.input === "service";
  if (!externalService && !params["yes"] && !canGuideConfiguration(ctx, false)) throw new UsageError("Pass --yes to build/register the template and create a billable sandbox.");
  return withGuidedConfiguration(ctx, { operation: "Prepare template and create sandbox", provider: provider.id, yes: Boolean(params["yes"]),
    validateProvider: !externalService, requirements: externalService ? [] : provider.id === "alicloud-express" ? ["sandbox_api_key"] : undefined }, async () => {
  const fmt = getFormatter(ctx), out = getOutput(ctx);
  let directory = initialDirectory;
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    const token = await resolveGithubToken(null);
    directory = await _withGithubRateLimitRetry(async (active) => {
      const registry = new RegistryClient("https://github.com", active);
      let ref = await registry.resolve(source);
      if (ref.is_builtin) ref = await registry.resolve(await _resolveIndexName(source, { token: active, fmt, out }));
      return registry.fetch(ref);
    }, { token, fmt, out });
  }
  const project = localProject ?? readLaunchProject(provider, directory, params);
  directory = project.directory;
  const { template, options, plan, sourceMetadata, manifestDigest } = project;
  const environment = Object.freeze(Object.fromEntries(Object.entries(template.env).map(([key,value])=>[key,value||process.env[key]||""])));
  if (plan.input === "service") {
    if (plan.kind !== "application" || !plan.service || plan.binding.endpoint !== "explicit-url" || typeof params["service_url"] !== "string") throw new ProviderConfigError("Service workflow requires --service-url and an application explicit-url binding.");
    const endpoint = validateApplicationEndpoint({ provider_id: provider.id, sandbox_id: "external-service", port: plan.service.port,
      url: params["service_url"], headers: {}, authentication_audience: "gateway", path_mode: "prefix" }, "external-service", plan.service.port);
    const operation = (sourceMetadata["workflows"] as Record<string, {operation: "commands.run" | "commands.list" | "health"}>)[plan.workflow_id].operation;
    const endpointName = {"commands.run": "run_command", "commands.list": "list_commands", health: "health"} as const;
    await requireApplicationOperation(endpoint, endpointName[operation], applicationToken);
    if (operation === "health") await checkApplicationHealth(endpoint, applicationToken);
    if (operation === "commands.list") {
      const response = await requestApplication(endpoint, "/commands", { method: "GET", application_token: applicationToken });
      let body: unknown;
      try { body = response.json(); } catch { throw new ProviderConfigError("External application catalog is not valid JSON."); }
      if (!response.is_success || !body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>)["commands"])) throw new ProviderConfigError("External application catalog has an invalid schema.");
    }
    fmt.printData({provider: provider.id, workflow_id: plan.workflow_id, input: "service", protocol_verified: true});
    return;
  }
  const providerOptions = _effectiveOptions(provider, null) ?? {};
  const config = loadLayeredConfig({ provider: provider.id, provider_options: providerOptions });
  provider.validateConfig(config);
  const pluginRoot = (provider as Provider & {pluginRoot?: string}).pluginRoot ??
    (provider.id === "alicloud-express" ? fileURLToPath(new URL("../providers/", import.meta.url)) : undefined);
  const providerContentIdentity = pluginRoot ? providerContentDigest(pluginRoot) : null;
  const providerSnapshotDigest = pluginRoot ? digestDir(pluginRoot) : null;
  const verifyProviderSnapshot = (): void => {
    if (pluginRoot && digestDir(pluginRoot) !== providerSnapshotDigest) throw new ProviderConfigError("Provider code changed after planning; compute a new execution snapshot.");
  };
  const extension = providerCliExtension(provider.id);
  const snapshot = plan.input === "source" ? await (extension?.stageProject
    ? extension.stageProject(directory, options)
    : stageProject(directory, { dockerfile: options.build_profile?.dockerfile })) : null;
  if (snapshot) {
    directory = snapshot.directory;
    if (createHash("sha256").update(fs.readFileSync(path.join(directory, "template.yaml"))).digest("hex") !== manifestDigest) {
      await snapshot.close(); throw new ProviderConfigError("Template manifest changed after planning; compute a new execution snapshot.");
    }
  }
  const planDigest = createHash("sha256").update(JSON.stringify({ provider_snapshot_digest: providerSnapshotDigest, provider_digest: providerContentIdentity, manifest_digest: `sha256:${manifestDigest}`, plan, source_digest: snapshot?.digest ?? null, manifest: sourceMetadata, build_profile: options.build_profile ?? null })).digest("hex");
  const journal = new ResourceJournal(provider.id, planDigest);
  options.journal = journal;
  const sandboxTimeout = sandboxTimeoutInput;
  let manager: ProviderTemplateManager | undefined;
  let prepared: PreparedTemplate;
  try {
    await snapshot?.verify();
    verifyProviderSnapshot();
    if (plan.input === "service") throw new ProviderConfigError("External service workflows require an explicit endpoint binding; use the server client for that URL.");
    if (plan.input === "image" || plan.input === "managed") {
      const reference = sourceMetadata[plan.input === "image" ? "image" : "template_id"];
      if (typeof reference !== "string" || !reference) throw new ProviderConfigError("Selected workflow needs its explicit image or template_id reference.");
      if (plan.input === "image" && !/@sha256:[a-f0-9]{64}$/.test(reference)) throw new ProviderConfigError("Image workflow requires an immutable image digest.");
      prepared = { reference, status: "ready" };
    } else {
    const extension = providerCliExtension(provider.id);
    if (extension?.prepareProject) prepared = await extension.prepareProject(directory, options, ctx);
    else {
      if (!params["yes"]) await confirm("Build/register this template and create a billable sandbox?", { abort: true, err: true });
      manager = await provider.buildTemplateManager(config);
      if (!manager.prepareProject) throw new ProviderFeatureNotSupportedError(provider.id, "templates.build");
      prepared = await manager.prepareProject(directory, options);
    }
    }
  } catch (error) {
    const reason = error instanceof ProjectToolError ? error.message : "Template preparation failed.";
    throw new ProviderConfigError(`${reason} Inspect recovery journal ${journal.id} before retrying any submitted operation.`);
  }
  finally { await manager?.close?.(); await snapshot?.close(); }
  const reference = prepared?.reference;
  for (const command of [prepared?.startup_command, prepared?.ready_command]) if (command !== undefined && (typeof command !== "string" || !command.trim())) throw new ProviderConfigError("Provider preparation returned an invalid service command.");
  if (prepared?.metadata !== undefined && (typeof prepared.metadata !== "object" || prepared.metadata === null || Array.isArray(prepared.metadata) || Object.values(prepared.metadata).some(v => typeof v !== "string"))) throw new ProviderConfigError("Provider preparation returned invalid creation metadata.");
  if (prepared?.provider_options !== undefined) {
    const fields = new Map(provider.configFields.map(f => [f.key, f]));
    if (typeof prepared.provider_options !== "object" || prepared.provider_options === null || Array.isArray(prepared.provider_options) || Object.keys(prepared.provider_options).some(k => !fields.has(k) || fields.get(k)!.secret)) throw new ProviderConfigError("Provider preparation cannot override credentials or undeclared provider options.");
  }
  const secrets = [...provider.configFields.filter(field => field.secret).map(field => config.provider_options[field.key]), config.sandbox_api_key].filter((value): value is string => typeof value === "string" && Boolean(value));
  if (prepared?.status !== "ready" || typeof reference !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,1023}$/.test(reference) || reference.includes("://") ||
    secrets.some(secret => reference.includes(secret))) throw new ProviderConfigError("Provider preparation returned an invalid ready reference.");
  verifyProviderSnapshot();
  const createIntent = await journal.intent({ kind: "sandbox", correlation_key: options.alias, cleanup: "sandbox.delete" });
  let sandbox: Sandbox | undefined;
  let knownSandboxId: string | undefined;
  const recordCreated = async (id: string): Promise<void> => {
    knownSandboxId = id;
    await journal.created(createIntent, id);
  };
  try {
  sandbox = await launchSeams.create({
    on_created: recordCreated, provider: provider.id, template: reference,
    api_key: provider.inherit.has("sandbox_api_key") ? config.sandbox_api_key : undefined,
    api_url: provider.inherit.has("sandbox_base_url") ? config.sandbox_base_url : undefined,
    provider_options: { ...structuredClone(config.provider_options), ...prepared.provider_options }, metadata: {...prepared.metadata, "abx.launch": journal.id, "abx.intent": createIntent},
    envs: {...environment},
    timeout: sandboxTimeout, cpu: template.cpu_count, memory: template.memory_mb });
  // Third-party create seams must also retain the known ID before journal I/O.
  if (knownSandboxId === undefined) await recordCreated(sandbox.id);
  } catch (error) {
    const recovery = error as {owned_sandbox_id?: string; cleanup_complete?: boolean};
    if (knownSandboxId === undefined && typeof recovery?.owned_sandbox_id === "string") knownSandboxId = recovery.owned_sandbox_id;
    let cleaned = recovery?.cleanup_complete === true;
    if (sandbox && !cleaned) {
      try { await sandbox.kill(); cleaned = !(await sandbox.isRunning()); } catch { /* Keep known identity in the recovery error. */ }
      finally { try { await sandbox.close(); } catch { /* Cleanup must survive client close failures. */ } }
    }
    try { await journal.mark(createIntent, cleaned ? "deleted" : "uncertain"); } catch { /* Journal failure must not prevent owned cleanup. */ }
    if (knownSandboxId !== undefined) throw new ProviderConfigError(`Sandbox creation/session binding failed for owned sandbox ${knownSandboxId}; cleanup ${cleaned ? "completed" : "must be reconciled"}; recovery journal ${journal.id}.`);
    throw new ProviderConfigError(`Sandbox creation has an uncertain outcome. Do not retry blindly; inspect resource journal ${journal.id} and reconcile by its correlation key.`);
  }
  try {
    const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";
    const startCommand = prepared.startup_command ?? options.template.start_cmd;
    const readyCommand = prepared.ready_command ?? options.template.ready_cmd;
    if (options.workflow?.startup === "exec" && startCommand) {
      const result = await sandbox.commands.run(`nohup /bin/sh -c ${quote(startCommand)} >/tmp/abx-template-server.log 2>&1 </dev/null &`, { timeout: 10 });
      if (!("exit_code" in result) || result.exit_code !== 0) throw new Error("Startup failed");
    }
    if (readyCommand) {
      const deadline = Date.now() + Math.min(options.timeout, 60) * 1000;
      for (;;) {
        const remaining = Math.max(0.01, Math.min(5, (deadline - Date.now()) / 1000));
        const result = await sandbox.commands.run(readyCommand, { timeout: remaining });
        if ("exit_code" in result && result.exit_code === 0) break;
        if (Date.now() >= deadline) throw new Error("Readiness timed out");
        await delay(250);
      }
    }
    if (plan.kind === "application" && plan.service) {
      const operation = (sourceMetadata["workflows"] as Record<string, {operation: "commands.list" | "commands.run" | "health"}>)[plan.workflow_id].operation;
      if (operation === "commands.list") await sandbox.listCommands({server_port: plan.service.port, application_token: applicationToken});
      else await sandbox.verifyApplicationOperation(operation, {server_port: plan.service.port, application_token: applicationToken});
    }
    await journal.mark(createIntent, "retained");
    for (const resource of prepared.owned_resources ?? []) await journal.mark(resource.intent_id, "retained");
    fmt.printData({ sandbox_id: sandbox.id, provider: provider.id, template_reference: reference,
      workflow_id: plan.workflow_id, plan_digest: planDigest, manifest_digest: `sha256:${manifestDigest}`, provider_snapshot_digest: providerSnapshotDigest, provider_digest: providerContentIdentity, source_digest: snapshot?.digest ?? null, journal_id: journal.id, build_profile: options.build_profile?.id ?? null });
  } catch {
    let cleaned = false;
    try { await sandbox.kill(); if (await sandbox.isRunning()) throw new Error("Still running"); await journal.mark(createIntent, "deleted"); cleaned = true; } catch { /* Report the owned ID if cleanup could not be confirmed. */ }
    throw new ProviderConfigError(`Template startup failed; owned sandbox ${sandbox.id} cleanup ${cleaned ? "completed" : "could not be confirmed"}; recovery journal ${journal.id}.`);
  } finally { await sandbox.close(); }
  });
}

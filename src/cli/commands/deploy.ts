/** Deploy supported templates through their existing lifecycle implementations. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { argument, command, option, type Context, type Params } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { getFormatter } from "../formatters.js";
import { canGuideConfiguration } from "../config_guidance.js";
import { confirm } from "../prompts.js";
import { UsageError } from "../errors.js";
import { INT, FLOAT, Choice } from "../types.js";
import { acquireTemplateSource, _findTemplateYaml } from "../template_catalog.js";
import { snapshotTemplateSource } from "../template_build.js";
import { checkTemplatePrerequisites, executeTemplateLaunch } from "../template_launch.js";
import { readTemplate, readYaml, record, writeJson } from "../../application/config.js";
import { applicationProfile } from "../../application/profile/normalize.mjs";
import { buildApplication } from "../../application/tools.js";
import { applicationId, applyPlan, createPlan, defaultReceiptFile, readReceipt, withApplicationLock } from "../../application/service.js";
import { defaultServices } from "../../application/default_services.js";
import { resolveDeployCredentials } from "../../application/fc.js";
import { resolveBindings } from "../../application/bindings.js";
import { paths } from "../../transport/config_layers.js";
import { getProvider, resolveProviderId } from "../../providers/registry.js";
import { cliProvider } from "../../providers/selection.js";
import type { ApplicationPlan } from "../../application/types.js";
import { ResourceJournal } from "../../template/resource_journal.js";
import { validateTemplateManifest, planTemplateLaunch } from "../../template/launch_plan.mjs";
import { validateVolumeMounts } from "../../models/sandbox.js";
import { deploymentDirectory, readDeployment, saveDeployment, validateDeploymentName, checkDeploymentSelection, type Deployment } from "../deployment_store.js";
import { loadRegistryApis, type ApiContract } from "../api_contract.js";
import { applicationToken } from "../template_environment.js";
import { saveApiBinding, selectResource, verifiedApplicationCredentials } from "../api_binding.js";
import { deployResources, resourceDeploymentSummary } from "../resource_deployment.js";
import { assertManagedApplicationHost } from "../../application/host.js";

export const deploymentSeams = { launch: executeTemplateLaunch, checkPrerequisites: checkTemplatePrerequisites, build: buildApplication, apply: applyPlan, services: defaultServices, bindings: resolveBindings, credentials: resolveDeployCredentials };
export async function approve(ctx: Context, params: Params, message: string): Promise<void> {
  if (params.yes) return;
  if (!canGuideConfiguration(ctx, false)) throw new UsageError("Review the operation and pass --yes to authorize it.");
  await confirm(message, { default: false, abort: true, err: true });
}
export async function applicationServices(plan: ApplicationPlan, bindings?: string, initial = false) {
  const credential = await deploymentSeams.credentials(plan.template.application.deployment.accessRef);
  const resolved = deploymentSeams.bindings(plan.template.application, bindings, { scope: { applicationId: applicationId(plan), accountId: credential.AccountID, region: plan.template.application.deployment.region }, mode: initial && !plan.previousReceipt ? "initial-apply" : "existing" });
  return deploymentSeams.services(plan, credential, resolved);
}
export function applicationLock<T>(plan: ApplicationPlan, account: string, work: () => Promise<T>): Promise<T> {
  return withApplicationLock(path.join(paths.abxDir, "app-locks"), `${account}/${plan.template.application.deployment.region}/${applicationId(plan)}`, work);
}
export function deploymentSummary(value: Deployment): Record<string, unknown> {
  if (value.kind === "resources") return resourceDeploymentSummary(value);
  const receipt = value.receipt && fs.existsSync(value.receipt) ? readReceipt(value.receipt) : undefined;
  const services = record(value.launch?.services) ? Object.fromEntries(Object.entries(value.launch.services).filter(([, service]) => record(service)).map(([name, service]) => [name, { port: (service as Record<string, unknown>).port, url: (service as Record<string, unknown>).url }])) : undefined;
  return { name: value.name, kind: value.kind, provider: value.provider, status: value.status,
    ...(value.sandboxId ? { sandbox_id: value.sandboxId } : {}),
    ...(typeof value.launch?.template_reference === "string" ? { template: value.launch.template_reference } : {}),
    ...(services ? { services } : {}),
    ...(receipt ? { endpoint: receipt.endpoint, revision: receipt.plan.revision, ...(receipt.credentialsFile ? { credentials_file: receipt.credentialsFile } : {}) } : {}) };
}
function pairs(values: string[] = [], unique = false): Record<string, string> {
  const entries = values.map(value => { const index = value.indexOf("="); if (index < 1) throw new UsageError("Expected KEY=VALUE."); return [value.slice(0, index), value.slice(index + 1)] as const; });
  if (unique && new Set(entries.map(([key]) => key)).size !== entries.length) throw new UsageError("--volume-mount requires a unique mount path.");
  return Object.fromEntries(entries);
}
/** Persist source needed by receipts after Registry caches or the original checkout change. */
export const snapshotDeploymentSource = snapshotTemplateSource;
export const deploy_shortcut = command("deploy", {
  help: "Deploy a catalog template or local project. --name identifies this deployment. Resource specVersion: 1 prepares templates and Serving; use create --template for an instance. Source spec_version: 5 also starts its declared instance. --plan previews without building or deploying.",
  params: [argument(["source"], { required: false }), option(["--name"]),
    option(["--plan"], { is_flag: true }), option(["--bindings"], { help: "Private application binding references JSON file." }), option(["--build-profile"]),
    option(["--build-timeout"], { type: FLOAT, default: 600 }), option(["--sandbox-timeout"], { type: INT, help: "Source spec_version: 5 instance lifetime in seconds (default: 300)." }), option(["--request-timeout"], { type: FLOAT }), option(["--upload"]),
    option(["--on-timeout"], { type: new Choice(["pause", "kill"]) }), option(["--auto-resume"], { is_flag: true }),
    option(["--env", "-e"], { multiple: true }), option(["--metadata", "-m"], { multiple: true }), option(["--volume-mount"], { multiple: true }), option(["--yes", "-y"], { is_flag: true })],
  callback: handleErrors(async (ctx, params) => {
    const envs = pairs(params.env), metadata = pairs(params.metadata);
    const volumeMounts = validateVolumeMounts(pairs(params.volume_mount, true));
    if (params.upload) {
      const upload = path.resolve(String(params.upload));
      if (!fs.existsSync(upload) || (!fs.statSync(upload).isFile() && !fs.statSync(upload).isDirectory())) throw new UsageError("--upload requires an existing file or directory.");
    }
    if (params.auto_resume && params.on_timeout !== "pause") throw new UsageError("--auto-resume requires --on-timeout pause.");
    const lifecycle = params.on_timeout ? { onTimeout: params.on_timeout as "pause" | "kill", autoResume: Boolean(params.auto_resume) } : undefined;
    let source: string | undefined, manifest: Record<string, unknown> = {};
    {
      const input = String(params.source ?? ".");
      if (fs.existsSync(input)) source = fs.statSync(input).isDirectory() ? fs.realpathSync(input) : path.dirname(fs.realpathSync(input));
      else { const acquired = await acquireTemplateSource(ctx, input, { allowManaged: true }); source = acquired.directory; if (acquired.manifest) manifest = acquired.manifest; }
      if (source) { const yaml = _findTemplateYaml(source); if (!yaml) throw new UsageError("Template source has no template.yaml. Use template init to create one."); manifest = readYaml(yaml) as Record<string, unknown>; }
      if (!Object.keys(manifest).length) throw new UsageError("Template source could not be resolved.");
    }
    if (!record(manifest)) throw new UsageError("Template manifest must be an object.");
    if (manifest.specVersion === 1) {
      if (!source) throw new UsageError("Resource deployment requires template source.");
      await deployResources(ctx, params, path.join(source, "template.yaml")); return;
    }
    const profile = applicationProfile(manifest);
    if (profile && profile !== "fc-managed-agents") throw new UsageError(`Unsupported application profile: ${profile}.`);
    if (manifest.application && !profile) throw new UsageError("This application has no supported deployment profile.");
    const kind = profile ? "application" : "sandbox";
    let apis: ApiContract[] = [];
    if (kind === "sandbox" && source && fs.existsSync(path.join(source, "registry.yaml"))) {
      const registry = readYaml(path.join(source, "registry.yaml"));
      if (record(registry) && registry.apis !== undefined) apis = selectResource(loadRegistryApis(path.join(source, "registry.yaml")));
    }
    const name = validateDeploymentName(String(params.name ?? manifest.name));
    const provider = profile ? "alicloud-express" : resolveProviderId(cliProvider());
    if (profile && cliProvider() && resolveProviderId(cliProvider()) !== provider) throw new UsageError("This application profile requires alicloud-express.");
    if (profile && (params.env.length || params.metadata.length || params.volume_mount.length || params.upload || lifecycle)) throw new UsageError("Application runtime configuration belongs in the template and its bindings.");
    if (!profile) { validateTemplateManifest(manifest); const planned = planTemplateLaunch(manifest, getProvider(provider), "cli"); if (!planned.supported) throw new UsageError(`Template is unsupported: ${planned.reason ?? planned.missing_operations.join(", ")}`); }
    if (profile && source) readTemplate(path.join(source, "template.yaml"));
    const summary = { name, kind, provider, profile, source: params.source ?? ".", resources: profile ? ["server image", "sandbox template", "worker", "dispatcher", "gateway"] : ["sandbox", ...(source ? ["template build when required"] : [])] };
    if (params.plan) { getFormatter(ctx).printData({ ...summary, status: "preview", builds_or_cloud_changes: false }); return; }
    if (profile) assertManagedApplicationHost();
    if (!profile && source) {
      const yaml = _findTemplateYaml(source);
      await deploymentSeams.checkPrerequisites(ctx, provider, yaml ? path.dirname(yaml) : source, manifest, params.build_profile);
    }
    const buildsTemplate = !profile && source && !manifest["template_id"] && !manifest["image"];
    const consent = profile ? "This may create billable cloud resources." : buildsTemplate
      ? "Build or register the template and create a billable Sandbox." : "Create a billable Sandbox.";
    await approve(ctx, params, `Deploy ${name}? ${consent}`);
    await withApplicationLock(path.join(paths.abxDir, "deployment-locks"), name, async () => {
      const recorded = readDeployment(name);
      const previous = recorded?.status === "deleted" ? undefined : recorded;
      if (previous) {
        checkDeploymentSelection(previous);
        if (previous.status !== "ready" || previous.kind !== "application" || kind !== "application" || !previous.receipt) throw new UsageError("This name already has a deployment. Inspect or recover it; delete a Sandbox deployment before recreating it.");
      }
      const folder = path.join(deploymentDirectory(name), randomUUID()); fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      const value: Deployment = { version: 1, name, kind, provider,  status: "preparing", createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), ...(params.bindings ? { bindings: fs.realpathSync(String(params.bindings)) } : previous?.bindings ? { bindings: previous.bindings } : {}) };
      if (kind === "sandbox") value.effectsStarted = false;
      if (source) { value.source = path.join(folder, "source"); snapshotDeploymentSource(source, value.source); }
      else if (!params.template_id) { value.source = path.join(folder, "source"); fs.mkdirSync(value.source); fs.writeFileSync(path.join(value.source, "template.yaml"), JSON.stringify(manifest)); }
      // The contract must describe the same immutable source snapshot as the deployment.
      if (kind === "sandbox" && value.source) {
        apis = [];
        const registryFile = path.join(value.source, "registry.yaml");
        if (fs.existsSync(registryFile)) {
          const registry = readYaml(registryFile);
          if (record(registry) && registry.apis !== undefined) apis = selectResource(loadRegistryApis(registryFile));
        }
      }
      if (previous) { value.previous = path.join(folder, "previous.json"); writeJson(value.previous, previous); }
      saveDeployment(value);
      let preparationJournal: ResourceJournal | undefined;
      const apiCredentials: Record<string, string> = {}, credentialFingerprints: Record<string, string> = {};
      try {
        if (kind === "application") {
          const file = path.join(value.source!, "template.yaml"), template = readTemplate(file);
          const credential = await deploymentSeams.credentials(template.application.deployment.accessRef);
          deploymentSeams.bindings(template.application, value.bindings, { scope: { applicationId: name, accountId: credential.AccountID, region: template.application.deployment.region }, mode: previous ? "existing" : "initial-apply" });
          value.ownsBuild = true;
          value.build = path.join(folder, "build.json"); saveDeployment(value);
          await deploymentSeams.build(template, value.source!, credential, value.build);
          const plan = createPlan(file, value.build, previous?.receipt, name, false);
          value.receipt = defaultReceiptFile(plan); saveDeployment(value);
          const services = await applicationServices(plan, value.bindings, true);
          await applicationLock(plan, services.fc.accountId, () => deploymentSeams.apply(plan, services, value.receipt));
        } else {
          const launched = await deploymentSeams.launch(ctx, { template_ref: value.source, alias: name, timeout: params.build_timeout, sandbox_timeout: params.sandbox_timeout ?? 300, build_profile: params.build_profile, yes: Boolean(params.yes) }, {
            approved: true, recoveryTarget: value.name, lifecycle, envs, metadata, volume_mounts: volumeMounts, request_timeout: params.request_timeout ?? undefined,
            onTarget: target => { Object.assign(value, target); saveDeployment(value); },
            onVerifiedApplication: service => {
              const verified = verifiedApplicationCredentials(apis, service, applicationToken());
              Object.assign(apiCredentials, verified.credentials); Object.assign(credentialFingerprints, verified.credentialFingerprints);
            },
            afterCreate: params.upload ? async sandbox => { const local = fs.realpathSync(String(params.upload)); if (fs.statSync(local).isDirectory()) { const files = fs.readdirSync(local, { recursive: true, withFileTypes: true }); for (const file of files) if (file.isFile()) { const absolute = path.join(file.parentPath, file.name); await sandbox.files.write(`/home/user/${path.relative(local, absolute).split(path.sep).join("/")}`, fs.readFileSync(absolute)); } } else await sandbox.files.write(`/home/user/${path.basename(local)}`, fs.readFileSync(local)); } : undefined,
            onJournal: journal => { preparationJournal = journal; value.journal = journal.file; value.effectsStarted = true; saveDeployment(value); }, onCreated: async id => { value.sandboxId = id; saveDeployment(value); },
          }); value.launch = launched.receipt;
        }
        if (apis.length && value.sandboxId) saveApiBinding({ version: 1,
          target: { id: value.sandboxId, provider: value.provider, providerOptions: value.providerOptions, connection: value.connection },
          deployment: { name: value.name, createdAt: value.createdAt }, apis, credentials: apiCredentials, credentialFingerprints, aliases: {} });
        value.status = "ready"; saveDeployment(value); getFormatter(ctx).printData(deploymentSummary(value));
      } catch (error) {
        // The callback runs before requests so a crash stays conservative. A returned error
        // with an acknowledged empty journal proves that this deployment started no requests.
        if (kind === "sandbox" && source && !value.sandboxId &&
            (value.effectsStarted === false || preparationJournal?.hasRecordedIntent === false)) {
          value.effectsStarted = false;
          value.status = "deleted";
        } else value.status = "requires_recovery";
        saveDeployment(value);
        throw error;
      }
    });
  }),
});

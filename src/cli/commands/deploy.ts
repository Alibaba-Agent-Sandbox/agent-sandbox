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
import { executeTemplateLaunch } from "../template_launch.js";
import { ApplicationError, readTemplate, readYaml, record, sourceDigest, writeJson } from "../../application/config.js";
import { applicationProfile } from "../../application/profile/normalize.mjs";
import { buildApplication } from "../../application/tools.js";
import { applicationId, applyPlan, createPlan, defaultReceiptFile, readReceipt, withApplicationLock } from "../../application/service.js";
import { defaultServices } from "../../application/default_services.js";
import { resolveDeployCredentials } from "../../application/fc.js";
import { resolveBindings } from "../../application/bindings.js";
import { paths, loadLayeredConfig } from "../../transport/config_layers.js";
import { getProvider, resolveProviderId } from "../../providers/registry.js";
import { cliProvider, cliOptions } from "../../providers/selection.js";
import type { ApplicationPlan } from "../../application/types.js";
import type { PreparedTemplate } from "../../providers/template_contract.js";
import { ResourceJournal } from "../../template/resource_journal.js";
import { digest } from "../../application/config.js";
import { validateTemplateManifest, planTemplateLaunch } from "../../template/launch_plan.mjs";
import { validateVolumeMounts } from "../../models/sandbox.js";
import { deploymentDirectory, readDeployment, saveDeployment, validateDeploymentName, checkDeploymentSelection, captureDeploymentTarget, type Deployment } from "../deployment_store.js";

export const deploymentSeams = { launch: executeTemplateLaunch, build: buildApplication, apply: applyPlan, services: defaultServices, bindings: resolveBindings, credentials: resolveDeployCredentials };
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
  const receipt = value.receipt && fs.existsSync(value.receipt) ? readReceipt(value.receipt) : undefined;
  return { ...value.launch, name: value.name, kind: value.kind, provider: value.provider, status: value.status, ...(value.sandboxId ? { sandbox_id: value.sandboxId } : {}), ...(value.launch?.services ? { services: value.launch.services } : {}), ...(receipt ? { endpoint: receipt.endpoint, revision: receipt.plan.revision, receipt_file: value.receipt, ...(receipt.credentialsFile ? { credentials_file: receipt.credentialsFile } : {}) } : {}) };
}
function pairs(values: string[] = [], unique = false): Record<string, string> {
  const entries = values.map(value => { const index = value.indexOf("="); if (index < 1) throw new UsageError("Expected KEY=VALUE."); return [value.slice(0, index), value.slice(index + 1)] as const; });
  if (unique && new Set(entries.map(([key]) => key)).size !== entries.length) throw new UsageError("--volume-mount requires a unique mount path.");
  return Object.fromEntries(entries);
}
/** Persist source needed by receipts after Registry caches or the original checkout change. */
export const snapshotDeploymentSource = snapshotTemplateSource;
/** Deploy the managed application described by a local or Registry template. */
export const deploy_shortcut = command("deploy", {
  help: "Deploy a managed application from a catalog template, local project or build. Use --plan to preview its resources.",
  params: [argument(["source"], { required: false }), option(["--name"]),
    option(["--build"], { help: "Reuse a managed application build artifact." }),
    option(["--plan"], { is_flag: true }), option(["--bindings"], { help: "Private application binding references JSON file." }),
    option(["--yes", "-y"], { is_flag: true })],
  callback: handleErrors((ctx, params) => runDeployment(ctx, params, "application")),
});

/** Create a Sandbox from a ready build or a Provider-native template reference. */
export const create_sandbox = command("create", {
  help: "Create a Sandbox from a ready template build or a Provider-native template ID.",
  params: [option(["--name"]), option(["--template-id"]), option(["--build"], { help: "Ready Sandbox artifact from abx template build." }),
    option(["--sandbox-timeout"], { type: INT, default: 300 }), option(["--request-timeout"], { type: FLOAT }), option(["--upload"]),
    option(["--on-timeout"], { type: new Choice(["pause", "kill"]) }), option(["--auto-resume"], { is_flag: true }),
    option(["--env", "-e"], { multiple: true }), option(["--metadata", "-m"], { multiple: true }), option(["--volume-mount"], { multiple: true }),
    option(["--yes", "-y"], { is_flag: true })],
  callback: handleErrors((ctx, params) => runDeployment(ctx, params, "sandbox")),
});

async function runDeployment(ctx: Context, params: Params, kind: Deployment["kind"]): Promise<void> {
  const sandbox = kind === "sandbox";
  if (sandbox && Boolean(params.template_id) === Boolean(params.build)) {
    throw new UsageError("Supply exactly one of --template-id ID or --build FILE. Prepare source templates with 'abx template build'.");
  }
  const envs = pairs(params.env), metadata = pairs(params.metadata);
  const volumeMounts = validateVolumeMounts(pairs(params.volume_mount, true));
  if (params.upload) {
    const upload = path.resolve(String(params.upload));
    if (!fs.existsSync(upload) || (!fs.statSync(upload).isFile() && !fs.statSync(upload).isDirectory())) throw new UsageError("--upload requires an existing file or directory.");
  }
  if (params.auto_resume && params.on_timeout !== "pause") throw new UsageError("--auto-resume requires --on-timeout pause.");
  const timeouts = [params.sandbox_timeout, params.request_timeout].filter(value => value != null).map(Number);
  if (timeouts.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new UsageError("Sandbox and request timeouts must be positive.");
  }
  const lifecycle = params.on_timeout ? { onTimeout: params.on_timeout as "pause" | "kill", autoResume: Boolean(params.auto_resume) } : undefined;
  const build: unknown = params.build ? JSON.parse(fs.readFileSync(path.resolve(String(params.build)), "utf8")) : undefined;
  const artifact = record(build) ? build : undefined;
  if (params.build && !artifact) throw new UsageError("Expected a template build artifact object.");
  if (artifact && artifact.kind !== (sandbox ? "SandboxTemplateBuild" : "ManagedApplicationBuild")) {
    throw new UsageError(sandbox ? "Expected a Sandbox build from 'abx template build'." : "Use 'abx create --build FILE' for Sandbox builds. Deploy expects a managed application build.");
  }
  if (artifact?.kind === "SandboxTemplateBuild" && (artifact.version !== 1 || artifact.status !== "ready" || !record(artifact.prepared))) throw new UsageError("Build is not ready. Recover or clean its owned resources before rebuilding.");
  let source: string | undefined, manifest: Record<string, unknown> = {};
  if (params.template_id) {
    manifest = { name: "sandbox" };
  } else if (artifact?.kind === "SandboxTemplateBuild") {
    source = String(artifact.projectRoot);
    if (artifact.sourceDigest !== sourceDigest(source)) throw new ApplicationError("Built template source changed; build it again.");
    const yaml = _findTemplateYaml(source); if (!yaml) throw new ApplicationError("Built template manifest is missing.");
    manifest = readYaml(yaml) as Record<string, unknown>;
  } else {
    const input = String(params.source ?? artifact?.projectRoot ?? ".");
    if (fs.existsSync(input)) source = fs.statSync(input).isDirectory() ? fs.realpathSync(input) : path.dirname(fs.realpathSync(input));
    else { const acquired = await acquireTemplateSource(ctx, input, { allowManaged: true }); source = acquired.directory; if (acquired.manifest) manifest = acquired.manifest; }
    if (source) { const yaml = _findTemplateYaml(source); if (!yaml) throw new UsageError("Template source has no template.yaml. Use template init to create one."); manifest = readYaml(yaml) as Record<string, unknown>; }
    if (!Object.keys(manifest).length) throw new UsageError("Template source could not be resolved.");
  }
  if (!record(manifest)) throw new UsageError("Template manifest must be an object.");
  const profile = applicationProfile(manifest);
  if (profile && profile !== "fc-managed-agents") throw new UsageError(`Unsupported application profile: ${profile}.`);
  if (manifest.application && !profile) throw new UsageError("This application has no supported deployment profile.");
  if (!sandbox && !profile) throw new UsageError("Deploy expects a managed application. For Sandbox source, run 'abx template build SOURCE --out build.json --yes', then 'abx create --build build.json --yes'. Existing templates use 'abx create --template-id ID --yes'.");
  if (sandbox && profile) throw new UsageError("Deploy managed application templates with 'abx deploy'.");
  const name = validateDeploymentName(String(params.name ?? (params.template_id ? `sandbox-${randomUUID().slice(0, 8)}` : manifest.name)));
  const provider = profile ? "alicloud-express" : resolveProviderId(cliProvider());
  if (profile && cliProvider() && resolveProviderId(cliProvider()) !== provider) throw new UsageError("This application profile requires alicloud-express.");
  if (artifact?.provider && artifact.provider !== provider) throw new UsageError("Build Provider differs from selected Provider.");
  if (sandbox && !params.template_id) { validateTemplateManifest(manifest); const planned = planTemplateLaunch(manifest, getProvider(provider), "cli", true); if (!planned.supported) throw new UsageError(`Template is unsupported: ${planned.reason ?? planned.missing_operations.join(", ")}`); }
  if (profile && source) readTemplate(path.join(source, "template.yaml"));
  const summary = { name, kind, provider, profile, source: params.source ?? artifact?.projectRoot ?? ".", resources: ["server image", "sandbox template", "worker", "dispatcher", "gateway"] };
  if (params.plan) { getFormatter(ctx).printData({ ...summary, status: "preview", builds_or_cloud_changes: false }); return; }
  await approve(ctx, params, sandbox
    ? `Create Sandbox ${name}? This creates a billable instance.`
    : `Deploy ${name}? This may build images and create billable cloud resources.`);
  await withApplicationLock(path.join(paths.abxDir, "deployment-locks"), name, async () => {
    const recorded = readDeployment(name);
    const previous = recorded?.status === "deleted" ? undefined : recorded;
    if (previous) {
      checkDeploymentSelection(previous);
      if (previous.status !== "ready" || previous.kind !== "application" || kind !== "application" || !previous.receipt) throw new UsageError("This name already has a deployment. Use status, recover or delete before reusing it.");
    }
    const folder = path.join(deploymentDirectory(name), randomUUID()); fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const value: Deployment = { version: 1, name, kind, provider, status: "preparing", createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), ...(params.bindings ? { bindings: fs.realpathSync(String(params.bindings)) } : previous?.bindings ? { bindings: previous.bindings } : {}) };
    if (kind === "sandbox") value.effectsStarted = false;
    if (source) {
      value.source = path.join(folder, "source");
      const snapshot = snapshotDeploymentSource(source, value.source);
      if (sandbox && artifact?.sourceDigest !== snapshot) throw new ApplicationError("Built template source changed before creation.");
    }
    if (previous) { value.previous = path.join(folder, "previous.json"); writeJson(value.previous, previous); }
    saveDeployment(value);
    try {
      if (kind === "application") {
        const file = path.join(value.source!, "template.yaml"), template = readTemplate(file);
        const credential = await deploymentSeams.credentials(template.application.deployment.accessRef);
        deploymentSeams.bindings(template.application, value.bindings, { scope: { applicationId: name, accountId: credential.AccountID, region: template.application.deployment.region }, mode: previous ? "existing" : "initial-apply" });
        value.ownsBuild = !artifact;
        value.build = artifact ? fs.realpathSync(String(params.build)) : path.join(folder, "build.json"); saveDeployment(value);
        if (!artifact) { await deploymentSeams.build(template, value.source!, credential, value.build); }
        const plan = createPlan(file, value.build, previous?.receipt, name, Boolean(artifact));
        value.receipt = defaultReceiptFile(plan); saveDeployment(value);
        const services = await applicationServices(plan, value.bindings, true);
        await applicationLock(plan, services.fc.accountId, () => deploymentSeams.apply(plan, services, value.receipt));
      } else if (params.template_id) {
        const { create } = await import("./sandbox.js");
        const journal = new ResourceJournal(provider, digest({ name, template: params.template_id })); value.journal = journal.file; saveDeployment(value);
        let intent: string | undefined;
        await ctx.invoke(create, { template: String(params.template_id), template_name: null, prompt: null, upload: params.upload ?? null, lifecycle, cmd_timeout: params.sandbox_timeout, request_timeout: params.request_timeout ?? null, env: params.env, metadata: [...params.metadata, `abx.deployment=${name}`], volume_mount: params.volume_mount, yes: Boolean(params.yes), model: null, output_dir: null, _quietResult: true,
          _beforeCreate: async () => { Object.assign(value, captureDeploymentTarget(provider, loadLayeredConfig({ provider, provider_options: cliOptions() }))); value.effectsStarted = true; saveDeployment(value); intent = await journal.intent({ kind: "sandbox", correlation_key: `${name}-${randomUUID()}`, cleanup: "sandbox.delete" }); return { "abx.launch": journal.id, "abx.intent": intent }; },
          _onCreated: async (id: string) => { value.sandboxId = id; saveDeployment(value); if (intent && journal.entries.find(entry => entry.intent_id === intent)?.state === "intent") await journal.created(intent, id); } });
      } else {
        if (!artifact) throw new ApplicationError("Sandbox creation requires a prepared build.");
        value.borrowedBuild = fs.realpathSync(String(params.build)); saveDeployment(value);
        await withApplicationLock(path.join(paths.abxDir, "template-build-locks"), value.borrowedBuild, async () => {
          const current = JSON.parse(fs.readFileSync(value.borrowedBuild!, "utf8"));
          if (current.status !== "ready" || digest(current.prepared) !== digest(artifact.prepared) || digest(current.target) !== digest(artifact.target)) throw new ApplicationError("Build changed before deployment admission.");
          const consumer = path.join(deploymentDirectory(name), "deployment.json");
          current.consumers = [...new Set([...(current.consumers ?? []), consumer])]; writeJson(value.borrowedBuild!, current);
        });
        const launched = await deploymentSeams.launch(ctx, { template_ref: value.source, alias: name, sandbox_timeout: params.sandbox_timeout, build_profile: artifact.build_profile, yes: Boolean(params.yes) }, {
          approved: true, lifecycle, envs, metadata, volume_mounts: volumeMounts, request_timeout: params.request_timeout ?? undefined,
          prepared: artifact.prepared as PreparedTemplate, builtTarget: artifact.target as Record<string, unknown>,
          onTarget: target => { Object.assign(value, target); saveDeployment(value); },
          afterCreate: params.upload ? async sandbox => { const local = fs.realpathSync(String(params.upload)); if (fs.statSync(local).isDirectory()) { const files = fs.readdirSync(local, { recursive: true, withFileTypes: true }); for (const file of files) if (file.isFile()) { const absolute = path.join(file.parentPath, file.name); await sandbox.files.write(`/home/user/${path.relative(local, absolute).split(path.sep).join("/")}`, fs.readFileSync(absolute)); } } else await sandbox.files.write(`/home/user/${path.basename(local)}`, fs.readFileSync(local)); } : undefined,
          onJournal: journal => { value.journal = journal.file; value.effectsStarted = true; saveDeployment(value); }, onCreated: async id => { value.sandboxId = id; saveDeployment(value); },
        }); value.launch = launched.receipt;
      }
      value.status = "ready"; saveDeployment(value); getFormatter(ctx).printData(deploymentSummary(value));
    } catch (error) { value.status = "requires_recovery"; saveDeployment(value); throw error; }
  });
}

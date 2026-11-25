/** Public named-resource operations; private ownership/cache files never become user inputs. */
import fs from "node:fs";
import path from "node:path";
import type {Context, Params} from "./kit.js";
import {UsageError} from "./errors.js";
import {getFormatter} from "./formatters.js";
import {getOutput} from "./output.js";
import {acquireTemplateSource, _findTemplateYaml} from "./template_catalog.js";
import {buildLocalProject} from "../template/local_build.js";
import {ApplicationError} from "../application/config.js";
import {withApplicationLock} from "../application/lock.js";
import {paths, loadLayeredConfig} from "../transport/config_layers.js";
import {cliProvider, cliOptions} from "../providers/selection.js";
import {resolveProviderId} from "../providers/registry.js";
import {deployResourceProject, deleteResourceProject, previewResourceProject, readResourceReceipt, resourceServices, type ResourceReceipt} from "../template/resource_executor.js";
import {captureDeploymentTarget, checkDeploymentSelection, deploymentDirectory, readDeployment, saveDeployment, validateDeploymentName, type Deployment} from "./deployment_store.js";
import {approve} from "./commands/deploy.js";

export const resourceDeploymentSeams = {deploy: deployResourceProject, remove: deleteResourceProject, build: buildLocalProject};
export function resourceDeploymentSummary(value: Deployment, receipt?: ResourceReceipt): Record<string, unknown> {
  const saved = receipt ?? (value.receipt && fs.existsSync(value.receipt) ? readResourceReceipt(value.receipt) : undefined);
  return {name: value.name, kind: "resources", provider: value.provider, status: saved?.status ?? value.status,
    resources: (saved?.resources ?? []).map(entry => ({name: entry.name, kind: entry.kind, id: entry.id, region: entry.region, status: entry.status, owned: entry.owned,
      ...(entry.retain ? {retained: true} : {})})), creates_instances: false,
    ...(saved?.retainedComponentResources?.length ? {retained_resources: saved.retainedComponentResources.map(entry => ({name: entry.resource, kind: entry.field, references: entry.references}))} : {})};
}
export async function buildLocalTemplate(ctx: Context, params: Params): Promise<void> {
  const input = String(params.source ?? ".");
  const local = fs.existsSync(input) ? (fs.statSync(input).isDirectory() ? input : path.dirname(input)) : undefined;
  const source = local ?? (await acquireTemplateSource(ctx, input)).directory;
  if (!source) throw new UsageError("This template has no local source to build.");
  const file = _findTemplateYaml(source);
  if (!file) throw new UsageError("Template source has no template.yaml.");
  const out = getOutput(ctx), message = "Building Docker image locally";
  if (!out.useLiveStatus && !out.quiet) out.progress(message);
  const result = await out.activity(message, update => resourceDeploymentSeams.build(file, {timeoutSeconds: params.timeout, buildProfile: params.build_profile,
    ...(update ? {onOutput: (resource: string, line: string) => {if (line.trim()) update(`${resource}: ${line}`);}} : {})}), {tick: true});
  getFormatter(ctx).printData(result);
}
export async function deployResources(ctx: Context, params: Params, file: string): Promise<void> {
  const preview = previewResourceProject(file), name = validateDeploymentName(String(params.name ?? preview.name));
  if (cliProvider() && resolveProviderId(cliProvider()) !== "alicloud-express") throw new UsageError("This resource project requires the alicloud-express Provider.");
  if (params.env?.length || params.metadata?.length || params.volume_mount?.length || params.upload || params.on_timeout || params.auto_resume || params.sandbox_timeout != null || params.request_timeout != null) throw new UsageError("Resource deployment prepares templates, volumes and Serving. Pass instance environment, mounts and lifetime to abx create.");
  if (params.bindings || params.build_profile) throw new UsageError("Resource specVersion: 1 uses values in template.yaml; --bindings and --build-profile belong to other template formats.");
  if (params.plan) {getFormatter(ctx).printData({...preview, name, builds_or_cloud_changes: false}); return;}
  await approve(ctx, params, `Deploy resources for ${name}? This may create billable cloud resources.`);
  await withApplicationLock(path.join(paths.abxDir, "deployment-locks"), name, async () => {
    const previous = readDeployment(name);
    if (previous) {checkDeploymentSelection(previous); if (previous.kind !== "resources") throw new UsageError("This deployment name belongs to another workload. Choose a new name.");}
    const value: Deployment = previous ?? {version: 1, name, kind: "resources", provider: "alicloud-express", status: "preparing", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
    value.source = fs.realpathSync(path.dirname(file)); value.receipt ??= path.join(deploymentDirectory(name), "resources.json");
    value.status = "preparing"; saveDeployment(value);
    try {
      const receipt = await resourceDeploymentSeams.deploy(file, value.receipt, {name, timeoutSeconds: params.build_timeout});
      value.resourceTargets ??= {};
      for (const entry of receipt.resources.filter(entry => entry.kind === "template" && entry.status === "ready")) {
        value.resourceTargets[entry.name] ??= {...captureDeploymentTarget(entry.provider, loadLayeredConfig({provider: entry.provider, provider_options: {...cliOptions(), region: entry.region}})), region: entry.region, team: entry.team};
      }
      value.status = "ready"; saveDeployment(value); getFormatter(ctx).printData(resourceDeploymentSummary(value, receipt));
    } catch (error) {value.status = "requires_recovery"; saveDeployment(value); throw error;}
  });
}
/** Select only a recorded native template; creating an instance never boots or binds an API implicitly. */
export async function deployedTemplateSelection(reference: string, selected?: string): Promise<{template: string; provider: string; provider_options?: Record<string, unknown>; api_url?: string; domain?: string} | undefined> {
  const value = readDeployment(reference);
  if (!value) {if (selected) throw new UsageError("--resource requires a deployed resource project name."); return undefined;}
  if (value.kind !== "resources" || !value.receipt) throw new UsageError("--template requires a resource deployment name or Provider-native template ID, not a running instance.");
  const receipt = readResourceReceipt(value.receipt);
  const templates = receipt.resources.filter(entry => entry.kind === "template" && entry.status === "ready" && !entry.name.includes(".previous."));
  const choices = templates.map(entry => entry.name);
  const matches = templates.filter(entry => !selected || entry.name === selected);
  if (matches.length !== 1) throw new UsageError(`Select a template with --resource. Available resources: ${choices.join(", ") || "none"}.`);
  const entry = matches[0], target = value.resourceTargets?.[entry.name];
  if (!entry.id || !target || value.status === "deleted") throw new ApplicationError("This template has no saved creation target. Redeploy or recover the resource project before creating an instance.");
  if (target.provider !== entry.provider || target.region !== entry.region || target.team !== entry.team) throw new ApplicationError("The saved template target differs from its resource identity.");
  checkDeploymentSelection({...value, ...target});
  const credential = await resourceServices.credentials();
  if (credential.AccountID !== receipt.accountId) throw new ApplicationError("Current account differs from the deployed template owner.");
  const actual = await resourceServices.express(credential, entry.region).ready("template", entry.id, entry.team!, 30);
  if (actual.templateID !== entry.id || actual.teamID !== entry.team) throw new ApplicationError("The observed template differs from the saved creation target.");
  return {template: entry.id, provider: target.provider, provider_options: {...target.providerOptions, region: entry.region, team_id: entry.team}, ...target.connection};
}

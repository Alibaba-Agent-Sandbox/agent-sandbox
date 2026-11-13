import { deployResources, resourceDeploymentSummary } from "../resource_deployment.js";
/** Deploy supported templates through their existing lifecycle implementations. */
import fs from "node:fs";
import path from "node:path";
import { argument, command, option, type Context, type Params } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { canGuideConfiguration } from "../config_guidance.js";
import { confirm } from "../prompts.js";
import { UsageError } from "../errors.js";
import { FLOAT } from "../types.js";
import { acquireTemplateSource, _findTemplateYaml } from "../template_catalog.js";
import { snapshotTemplateSource } from "../template_build.js";
import { executeTemplateLaunch } from "../template_launch.js";
import { ApplicationError, readManagedProject, record, sourceDigest } from "../../application/config.js";
import { readProjectIntent } from "../../template/project.js";
import { buildApplication } from "../../application/tools.js";
import { applicationId, applyPlan, readReceipt, withApplicationLock } from "../../application/service.js";
import { defaultServices, controlServices } from "../../application/default_services.js";
import { resolveDeployCredentials } from "../../application/fc.js";
import { resolveBindings, resolveControlBinding } from "../../application/bindings.js";
import { paths } from "../../transport/config_layers.js";
import type { ApplicationPlan, ApplicationReceipt } from "../../application/types.js";
import { digest } from "../../application/config.js";
import { type Deployment } from "../deployment_store.js";

export const deploymentSeams = { launch: executeTemplateLaunch, build: buildApplication, apply: applyPlan, services: defaultServices, controlServices, bindings: resolveBindings, credentials: resolveDeployCredentials };
export async function applicationControlServices(receipt: ApplicationReceipt, bindings?: string) {
  const plan = receipt.plan, credential = await deploymentSeams.credentials(plan.template.application.deployment.accessRef);
  const control = resolveControlBinding(plan.template.application, bindings, {generated: Boolean(receipt.credentialsFile), scope: {applicationId: applicationId(plan), accountId: credential.AccountID, region: plan.template.application.deployment.region}});
  return deploymentSeams.controlServices(plan, credential, control.internal);
}
export async function approve(ctx: Context, params: Params, message: string): Promise<void> {
  if (params.yes) return;
  if (!canGuideConfiguration(ctx, false)) throw new UsageError("Review the operation and pass --yes to authorize it.");
  await confirm(message, { default: false, abort: true, err: true });
}
export async function applicationServices(plan: ApplicationPlan, bindings?: string, initial = false) {
  if (sourceDigest(plan.projectRoot) !== plan.sourceDigest) throw new ApplicationError("Frozen application source changed; no component operation was started.");
  const configurationSource = plan.configurationSource && fs.existsSync(plan.configurationSource) ? plan.configurationSource : undefined;
  const current = readManagedProject(plan.templateFile, { configurationSource });
  if (digest(current.template) !== digest(plan.template)) throw new ApplicationError("Application identity, resource budget or referenced intent changed after planning; create a new plan.");
  const credential = await deploymentSeams.credentials(plan.template.application.deployment.accessRef);
  const resolved = deploymentSeams.bindings(plan.template.application, bindings, { values: current.bindingValues, scope: { applicationId: applicationId(plan), accountId: credential.AccountID, region: plan.template.application.deployment.region }, mode: initial && !plan.previousReceipt ? "initial-apply" : "existing" });
  const services = deploymentSeams.services(plan, credential, resolved);
  services.nativeRoleProps = current.roleProps;
  return services;
}
export function applicationLock<T>(plan: ApplicationPlan, account: string, work: () => Promise<T>): Promise<T> {
  return withApplicationLock(path.join(paths.abxDir, "app-locks"), `${account}/${plan.template.application.deployment.region}/${applicationId(plan)}`, work);
}
export function deploymentSummary(value: Deployment): Record<string, unknown> {
  if (value.kind === "resources") return resourceDeploymentSummary(value);
  const receipt = value.receipt && fs.existsSync(value.receipt) ? readReceipt(value.receipt) : undefined;
  return { ...value.launch, name: value.name, kind: value.kind, provider: value.provider, status: value.status, ...(value.sandboxId ? { sandbox_id: value.sandboxId } : {}), ...(value.launch?.services ? { services: value.launch.services } : {}), ...(receipt ? { endpoint: receipt.endpoint, revision: receipt.plan.revision, receipt_file: value.receipt, ...(receipt.credentialsFile ? { credentials_file: receipt.credentialsFile } : {}) } : {}) };
}
/** Persist source needed by historical receipt cleanup. New resources retain their project path. */
export const snapshotDeploymentSource = snapshotTemplateSource;
export const deploy_shortcut = command("deploy", {
  help: "Prepare named Sandbox templates and volumes, and deploy Serving. --name identifies the application. --plan previews resources without building or deploying.",
  params: [argument(["source"], {required: false}), option(["--name"]), option(["--build"], {help: "Reuse a ready resource build artifact."}),
    option(["--plan"], {is_flag: true}), option(["--build-timeout"], {type: FLOAT, default: 600}), option(["--yes", "-y"], {is_flag: true})],
  callback: handleErrors(async (ctx, params) => {
    let source: string;
    if (params.build) {
      if (params.source) throw new UsageError("A resource build already identifies its source; omit SOURCE.");
      const artifact: unknown = JSON.parse(fs.readFileSync(path.resolve(String(params.build)), "utf8"));
      if (!record(artifact) || artifact.kind !== "ResourceDeployment" || artifact.status !== "ready" || artifact.buildOnly !== true || typeof artifact.source !== "string") throw new UsageError("Resource build is not ready for deployment.");
      source = fs.realpathSync(artifact.source);
      if (artifact.sourceDigest !== sourceDigest(source)) throw new ApplicationError("Built template source changed; build it again.");
    } else {
      const input = String(params.source ?? ".");
      if (fs.existsSync(input)) source = fs.statSync(input).isDirectory() ? fs.realpathSync(input) : path.dirname(fs.realpathSync(input));
      else {
        const acquired = await acquireTemplateSource(ctx, input, {allowManaged: true});
        if (!acquired.directory) {
          const entries = Object.values(acquired.manifest?.sandbox ?? {}) as Array<{provider?:string;template?:{reference?:string}}>;
          const reference = entries.length === 1 ? entries[0].template?.reference : undefined;
          throw new UsageError(reference
            ? `This catalog entry references an existing template. Use abx --provider ${entries[0].provider} sandbox create --template ${reference} --yes.`
            : "This catalog entry has no resource source to deploy.");
        }
        source = acquired.directory;
      }
    }
    const file = _findTemplateYaml(source);
    if (!file) throw new UsageError("Template source has no template.yaml. Use template init to create one.");
    readProjectIntent(file);
    await deployResources(ctx, params, source);
  }),
});

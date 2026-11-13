import { getOutput } from "./output.js";
/** CLI resource lifecycle adapters. The engine owns preparation; this layer owns presentation. */
import fs from "node:fs";
import path from "node:path";
import type { Context, Params } from "./kit.js";
import { getFormatter } from "./formatters.js";
import { UsageError } from "./errors.js";
import { deploymentDirectory, readDeployment, saveDeployment, validateDeploymentName, type Deployment } from "./deployment_store.js";
import { withApplicationLock } from "../application/lock.js";
import { withTemplateEnvironment } from "./template_environment.js";
import { readProjectIntent } from "../template/project.js";
import { writeJson, sourceDigest } from "../application/config.js";
import { paths } from "../transport/config_layers.js";
import { deployResourceProject, previewResourceProject, readResourceReceipt, deleteResourceProject } from "../template/resource_executor.js";

/** Deploy a local named-resource document; dynamic-instance flags belong to native instance creation. */
export async function deployResources(ctx: Context, params: Params, source: string): Promise<void> {
  const file = path.join(source, "template.yaml"), preview = previewResourceProject(file);
  const name = validateDeploymentName(String(params.name ?? preview.name));
  if (params.env?.length || params.metadata?.length || params.volume_mount?.length || params.upload || params.on_timeout || params.sandbox_timeout || params.bindings || params.build_profile) throw new UsageError("Resource deployment prepares templates and Serving. Pass dynamic-instance settings to the Sandbox SDK or instance command instead.");
  if (params.plan) {getFormatter(ctx).printData({...preview, name}); return;}
  if (!params.yes) throw new UsageError("Review 'abx deploy --plan', then pass --yes to apply the declared resources.");
  await withApplicationLock(path.join(paths.abxDir, "deployment-locks"), name, async () => {
    const existing = readDeployment(name);
    if (existing && existing.kind !== "resources" && existing.status !== "deleted") throw new UsageError("This name belongs to another deployment type.");
    const requestedBuild = params.build ? fs.realpathSync(String(params.build)) : undefined;
    if (existing && existing.status !== "deleted" && existing.borrowedBuild !== requestedBuild) throw new UsageError("This deployment uses a different build. Use a new deployment name, or delete the existing deployment before switching its build source.");
    const folder = deploymentDirectory(name), receipt = path.join(folder, "resources.json");
    if (existing?.status === "deleted" && fs.existsSync(receipt)) {
      const archived = readResourceReceipt(receipt);
      // Keep retained-resource history while allowing a fresh declaration to obtain new identities.
      archived.resources.forEach(entry => {entry.name = `previous.${Date.now()}.${entry.name}`;});
      writeJson(receipt, archived);
    }
    const value: Deployment = {version: 1, name, kind: "resources", provider: "alicloud-express", status: "preparing", source,
      receipt, createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString()};
    if (params.build) {
      value.borrowedBuild = fs.realpathSync(String(params.build));
      await withApplicationLock(path.join(paths.abxDir, "template-build-locks"), value.borrowedBuild, async () => {
        const artifact = readResourceReceipt(value.borrowedBuild!);
        if (!artifact.buildOnly || artifact.status !== "ready" || artifact.source !== fs.realpathSync(source) || artifact.sourceDigest !== sourceDigest(source)) throw new UsageError("Build source changed or the artifact is not ready.");
        artifact.consumers = [...new Set([...(artifact.consumers ?? []), name])];
        writeJson(value.borrowedBuild!, artifact);
      });
    }
    saveDeployment(value);
    try {
      const declaredToken = JSON.stringify(readProjectIntent(file)).includes("ABX_SERVER_TOKEN");
      const out = getOutput(ctx);
      if (!out.useActivityLine) out.progress(`Preparing resources for ${name}`);
      const result = await out.activity(`Preparing resources for ${name}`, update =>
        withTemplateEnvironment(ctx, declaredToken ? {ABX_SERVER_TOKEN: ""} : {}, {}, true,
          environment => deployResourceProject(file, receipt, {name, buildReceipt: value.borrowedBuild, timeoutSeconds: params.build_timeout ?? 600,
            onProgress: message => { if (update) update(message); else out.debug(message); }, environment: {...process.env, ...environment}})), {tick: true});
      value.status = "ready"; saveDeployment(value);
      getFormatter(ctx).printData({name, status: result.status, resources: result.resources.map(entry => ({name: entry.name, kind: entry.kind, id: entry.id, status: entry.status, owned: entry.owned}))});
    } catch (error) {
      if (value.borrowedBuild && !fs.existsSync(receipt)) await withApplicationLock(path.join(paths.abxDir, "template-build-locks"), value.borrowedBuild, async () => {
        const artifact = readResourceReceipt(value.borrowedBuild!);
        artifact.consumers = (artifact.consumers ?? []).filter(item => item !== name); writeJson(value.borrowedBuild!, artifact);
      });
      value.status = "requires_recovery"; saveDeployment(value); throw error;
    }
  });
}
/** Local recorded status is labeled as such; this does not claim a cloud health check. */
export function resourceDeploymentSummary(value: Deployment): Record<string, unknown> {
  const receipt = value.receipt && fs.existsSync(value.receipt) ? readResourceReceipt(value.receipt) : undefined;
  return {name: value.name, kind: value.kind, status: receipt?.status ?? value.status, observation: "recorded", retainedComponentResources: receipt?.retainedComponentResources ?? [], resources: receipt?.resources.map(entry => ({name: entry.name, kind: entry.kind, region: entry.region, id: entry.id, status: entry.status, owned: entry.owned, retain: entry.retain})) ?? []};
}
export async function removeResourceDeployment(value: Deployment): Promise<void> {
  if (!value.receipt) throw new UsageError("Resource ownership record is missing.");
  try {
    await deleteResourceProject(value.receipt); value.status = "deleted";
    if (value.borrowedBuild) await withApplicationLock(path.join(paths.abxDir, "template-build-locks"), value.borrowedBuild, async () => {
      const artifact = readResourceReceipt(value.borrowedBuild!);
      artifact.consumers = (artifact.consumers ?? []).filter(name => name !== value.name);
      writeJson(value.borrowedBuild!, artifact);
    });
  }
  catch (error) {value.status = "requires_recovery"; throw error;}
  finally {saveDeployment(value);}
}

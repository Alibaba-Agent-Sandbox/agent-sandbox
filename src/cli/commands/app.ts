/** Explicit deployment operations for application-enabled templates. */
import fs from "node:fs";
import path from "node:path";
import { argument, group, option, getCurrentContext } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { UsageError } from "../errors.js";
import { getOutput } from "../output.js";
import { getProvider } from "../../providers/registry.js";
import { loadLayeredConfig } from "../../transport/config_layers.js";
import { providerCliExtension } from "../provider_extensions.js";
import { ProviderFeatureNotSupportedError, ProviderResourceNotFoundError } from "../../providers/errors.js";
import { TemplateNotFoundError } from "../../models/errors.js";
import { createFcInspector, type FcInspector } from "../../application/adapters/serverless_fc3.js";
import type { ApplicationPlan } from "../../application/types.js";
import { applyApplication, destroyApplication, invokeServerless, planApplication, planDestroy, probe, readReceipt, receiptSummary, reconcileApplication, writeJson, type ApplicationServices } from "../../application/service.js";

const inspectors = new Map<string, Promise<FcInspector>>();
function inspector(plan: ApplicationPlan): Promise<FcInspector> {
  let current = inspectors.get(plan.id);
  if (!current) { current = createFcInspector(plan.template.application.deployment.accessRef!); inspectors.set(plan.id, current); }
  return current;
}

/** Host adapters use the same provider preparation path as template launch. */
export const appServices: ApplicationServices = {
  async prepare(plan) {
    const input = plan.template, provider = getProvider(input.application.sandbox.provider);
    for (const feature of ["templates.build", "templates.read", ...input.application.sandbox.requiredFeatures]) provider.require(feature);
    const config = loadLayeredConfig({ provider: provider.id }); provider.validateConfig(config);
    const alias = `${input.name.slice(0, 40)}-${plan.id.slice(-12)}`;
    const options = { alias, timeout: 600, createOnly: true, template: { name: input.name, capabilities: input.capabilities,
      cpu: input.resources.cpu, memory: input.resources.memory, start_cmd: input.start_cmd, ready_cmd: input.ready_cmd } };
    const extension = providerCliExtension(provider.id);
    let prepared;
    if (extension?.prepareProject) prepared = await extension.prepareProject(plan.projectRoot, options, getCurrentContext());
    else {
      const manager = await provider.buildTemplateManager(config, "templates.build");
      try {
        if (!manager.prepareProject) throw new ProviderFeatureNotSupportedError(provider.id, "templates.build");
        prepared = await manager.prepareProject(plan.projectRoot, options);
      } finally { await manager.close?.(); }
    }
    if (prepared.status !== "ready" || typeof prepared.reference !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,1023}$/.test(prepared.reference) || prepared.reference.includes("://")) throw new UsageError("Provider returned an invalid ready template reference.");
    if (prepared.ownership !== "created") throw new UsageError("Provider did not attest create-only preparation; its reference cannot authorize application cleanup.");
    return { provider: provider.id, reference: prepared.reference, ownership: "created" };
  },
  async deleteTemplate(providerId, reference) {
    const provider = getProvider(providerId), config = loadLayeredConfig({ provider: providerId });
    provider.require("templates.build"); provider.validateConfig(config);
    const manager = await provider.buildTemplateManager(config, "templates.build");
    try {
      if (!manager.delete) throw new ProviderFeatureNotSupportedError(providerId, "templates.build");
      await manager.delete(reference);
    } finally { await manager.close?.(); }
  },
  async invoke(plan, project, operation) { return await invokeServerless(plan, project, operation, (await inspector(plan)).serverlessEnvironment()); },
  smoke: probe,
  async describe(plan, project) {
    const client = await inspector(plan), functions: Record<string, Record<string, unknown> | null> = {};
    for (const [name, resource] of Object.entries(project.resources)) functions[name] = await client.describeFunction(String(resource.props.region), String(resource.props.functionName));
    return { accountId: client.accountId, functions };
  },
  async reserve(plan, project, onCreated) {
    const client = await inspector(plan);
    for (const [name, resource] of Object.entries(project.resources)) {
      const body = await client.createFunction(String(resource.props.region), resource.props);
      onCreated(name, body);
    }
  },
  async templateExists(providerId, reference) {
    const provider = getProvider(providerId), config = loadLayeredConfig({ provider: providerId });
    provider.require("templates.read"); provider.validateConfig(config);
    const manager = await provider.buildTemplateManager(config, "templates.read");
    try {
      if (!manager.get) throw new ProviderFeatureNotSupportedError(providerId, "templates.read");
      await manager.get(reference); return true;
    } catch (error) { if (error instanceof TemplateNotFoundError || error instanceof ProviderResourceNotFoundError) return false; throw error; }
    finally { await manager.close?.(); }
  },
};

/** Application commands never alter sandbox creation or ordinary template deployment. */
export const app = group("app", { help: "Plan and explicitly deploy an Agent application from template.yaml. Cloud operations require --yes; status reads the local receipt." });
app.command("plan", {
  help: "Validate and freeze local inputs without executing hooks or cloud commands. Use --destroy RECEIPT to plan removal separately.",
  params: [argument(["template_file"], { default: "template.yaml", required: false }), option(["--destroy", "destroy_receipt"], { default: null }), option(["--out"], { default: null })],
  callback: handleErrors(async (ctx, params) => {
    let file = path.resolve(String(params.template_file));
    if (!params.destroy_receipt && fs.statSync(file).isDirectory()) file = path.join(file, "template.yaml");
    const plan = params.destroy_receipt ? planDestroy(String(params.destroy_receipt)) : planApplication(file);
    const output = params.out ? path.resolve(String(params.out)) : path.join(plan.projectRoot, ".abx", "app", plan.id, "plan.json");
    const relative = path.relative(plan.projectRoot, output);
    if (!relative.startsWith("..") && !relative.startsWith(`.abx${path.sep}`)) throw new UsageError("Write generated plans under .abx/ or outside the source project.");
    writeJson(output, plan);
    getOutput(ctx).data({ plan_id: plan.id, operation: plan.operation, plan_file: output, expires_at: plan.expiresAt,
      runtime: plan.template.application.runtime.placement, adapter: plan.template.application.deployment.adapter,
      remote_state: "not_observed", hooks: Object.keys(plan.template.application.hooks ?? {}) });
  }),
});
for (const operation of ["apply", "destroy"] as const) app.command(operation, {
  help: `${operation === "apply" ? "Apply" : "Remove using"} an accepted immutable plan. Review the complete plan and pass --yes.`,
  params: [argument(["plan_file"]), option(["--yes", "-y"], { is_flag: true })],
  callback: handleErrors(async (ctx, params) => {
    if (!params.yes) throw new UsageError("Review the accepted plan and pass --yes to permit its billable changes.");
    const plan = JSON.parse(fs.readFileSync(String(params.plan_file), "utf8")) as ApplicationPlan;
    const receipt = operation === "apply" ? await applyApplication(plan, appServices) : await destroyApplication(plan, appServices);
    getOutput(ctx).data(receiptSummary(receipt));
  }),
});
app.command("status", {
  help: "Read a local deployment receipt; use reconcile to verify current remote state.",
  params: [argument(["receipt_file"])],
  callback: handleErrors((ctx, params) => { getOutput(ctx).data(receiptSummary(readReceipt(String(params.receipt_file)))); }),
});
app.command("reconcile", {
  help: "Observe an uncertain deployment and rerun candidate probes/hooks. Does not replay deploy; hooks require --yes.",
  params: [argument(["receipt_file"]), option(["--yes", "-y"], { is_flag: true })],
  callback: handleErrors(async (ctx, params) => {
    if (!params.yes) throw new UsageError("Pass --yes to permit the planned afterReady probes/hooks during reconciliation.");
    getOutput(ctx).data(receiptSummary(await reconcileApplication(String(params.receipt_file), appServices)));
  }),
});

/** Explicit application deployment commands; sandbox launch keeps its separate lifecycle. */
import fs from "node:fs";
import path from "node:path";
import { argument, command, group, option, type Context, type Params } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { getFormatter } from "../formatters.js";
import { ApplicationError, readTemplate, writeJson } from "../../application/config.js";
import { buildApplication, cleanBuild } from "../../application/tools.js";
import { resolveDeployCredentials, createFcTransport, verifyFunction } from "../../application/fc.js";
import { resolveBindings } from "../../application/bindings.js";
import { defaultServices } from "../../application/default_services.js";
import { applyPlan, createDestroyPlan, createPlan, defaultReceiptFile, destroyPlan, observeReceipt, publicSummary, readPlan, readReceipt, retireRevision, withApplicationLock } from "../../application/service.js";
import { paths } from "../../transport/config_layers.js";
import type { ApplicationPlan } from "../../application/types.js";

const yes = option(["--yes", "-y"], { is_flag: true, help: "Approve the displayed application operation and its billable resources." });
const bindings = option(["--bindings"], { help: "Private JSON binding references; otherwise use ABX_APP_BINDING_<REFERENCE>." });
function action(callback: (ctx: Context, params: Params) => Promise<void>) {
  return handleErrors(async (ctx: Context, params: Params) => {
    try { await callback(ctx, params); }
    catch (error) { if (error instanceof ApplicationError) throw error; throw new ApplicationError("Application operation failed; inspect the private receipt and prerequisites. Raw tool, binding and cloud output was withheld."); }
  });
}
function requireYes(params: Params): void { if (!params.yes) throw new ApplicationError("Review the frozen plan and pass --yes to execute this application operation."); }
async function dependencies(plan: ApplicationPlan, params: Params, initial = false) {
  const credential = await resolveDeployCredentials(plan.template.application.deployment.accessRef);
  const binding = resolveBindings(plan.template.application, params.bindings ? path.resolve(String(params.bindings)) : undefined,
    { scope: { applicationId: plan.template.name, accountId: credential.AccountID, region: plan.template.application.deployment.region }, mode: initial && !plan.previousReceipt ? "initial-apply" : "existing" });
  return defaultServices(plan, credential, binding);
}
function lock<T>(plan: ApplicationPlan, account: string, work: () => Promise<T>): Promise<T> {
  return withApplicationLock(path.join(paths.abxDir, "app-locks"), `${account}/${plan.template.application.deployment.region}/${plan.template.name}`, work);
}
export const app = group("app", { help: "Build, review, deploy and clean up managed applications with one Gateway endpoint." });
app.addCommand(command("clean-build", { help: "Remove an isolated owned Server build that never entered an application lifecycle.", params: [argument(["build_receipt"]), yes], callback: action(async (ctx, params) => {
  requireYes(params); const file = path.resolve(String(params.build_receipt)), input = JSON.parse(fs.readFileSync(file, "utf8"));
  if (input.kind !== "ManagedApplicationBuild") throw new ApplicationError("Expected an application build receipt.");
  const credential = await resolveDeployCredentials(String(input.accessRef ?? "abx")); const result = await cleanBuild(file, credential);
  getFormatter(ctx).printDict({ status: result.status ?? "borrowed", build_receipt: file, owned_image: Boolean(result.ownedServerImage) });
}) }));
app.addCommand(command("build", { help: "Build/push the application Server image and freeze the exact component toolchain.", params: [argument(["template_file"], { default: "template.yaml", required: false }), option(["--out"], { required: true, help: "Private build receipt path (put generated files under .abx/)." }), yes],
  callback: action(async (ctx, params) => {
    requireYes(params); const file = fs.realpathSync(String(params.template_file)), template = readTemplate(file), credential = await resolveDeployCredentials(template.application.deployment.accessRef);
    const receipt = await buildApplication(template, path.dirname(file), credential, path.resolve(String(params.out)));
    getFormatter(ctx).printDict({ status: "built", build_receipt: path.resolve(String(params.out)), image: receipt.image, component: receipt.toolchain.component.reference });
  }) }));
app.addCommand(command("plan", { help: "Create a read-only frozen deployment or destruction plan.", params: [argument(["template_file"], { default: "template.yaml", required: false }), option(["--build-receipt"]), option(["--previous-receipt"]), option(["--destroy"], { help: "Receipt to drain and destroy; no cloud changes are made by plan." }), option(["--out"], { required: true })],
  callback: action(async (ctx, params) => {
    if (!params.destroy && !params.build_receipt) throw new ApplicationError("Application planning requires --build-receipt, or --destroy RECEIPT.");
    const plan = params.destroy ? createDestroyPlan(path.resolve(String(params.destroy))) : createPlan(path.resolve(String(params.template_file)), path.resolve(String(params.build_receipt)), params.previous_receipt ? path.resolve(String(params.previous_receipt)) : undefined);
    writeJson(path.resolve(String(params.out)), plan);
    getFormatter(ctx).printDict({ status: "planned", operation: plan.operation, plan_id: plan.id, revision: plan.revision, plan_file: path.resolve(String(params.out)), resources: plan.identities, steps: plan.steps.map(step => step.id), expires_at: plan.expiresAt });
  }) }));
app.addCommand(command("apply", { help: "Prepare Sandbox Template, verify the candidate and publish the stable Gateway alias.", params: [argument(["plan_file"]), bindings, yes],
  callback: action(async (ctx, params) => {
    requireYes(params); const plan = readPlan(path.resolve(String(params.plan_file)));
    if (plan.operation !== "apply") throw new ApplicationError("Use app destroy for a destruction plan.");
    const services = await dependencies(plan, params, true), file = defaultReceiptFile(plan);
    const receipt = await lock(plan, services.fc.accountId, () => applyPlan(plan, services, file));
    getFormatter(ctx).printDict(publicSummary(receipt, file));
  }) }));
app.addCommand(command("status", { help: "Inspect the recorded application and its native resource identities.", params: [argument(["receipt_file"]), bindings],
  callback: action(async (ctx, params) => {
    const file = path.resolve(String(params.receipt_file)), receipt = readReceipt(file);
    if (params.bindings) { const services = await dependencies(receipt.plan, params); getFormatter(ctx).printDict(await observeReceipt(receipt, services)); return; }
    const credential = await resolveDeployCredentials(receipt.plan.template.application.deployment.accessRef);
    if (credential.AccountID !== receipt.accountId) throw new ApplicationError("Current deployment account differs from the receipt owner.");
    const fc = createFcTransport(credential, receipt.plan.template.application.deployment.region), resources: Record<string, unknown>[] = [];
    for (const item of receipt.functions) { const actual = await fc.describeFunction(item.functionName); if (actual) verifyFunction(actual, receipt.accountId, receipt.plan.template.application.deployment.region, item.functionName, item); resources.push({ role: item.role, functionName: item.functionName, present: Boolean(actual) }); }
    getFormatter(ctx).printDict({ ...publicSummary(receipt, file), resources });
  }) }));
app.addCommand(command("reconcile", { help: "Observe uncertain resources and durable activity without replaying deployment effects.", params: [argument(["receipt_file"]), bindings, yes],
  callback: action(async (ctx, params) => {
    requireYes(params); const file = path.resolve(String(params.receipt_file)), receipt = readReceipt(file), services = await dependencies(receipt.plan, params);
    const result = await lock(receipt.plan, services.fc.accountId, () => observeReceipt(receipt, services, file)); getFormatter(ctx).printDict(result);
  }) }));
app.addCommand(command("retire", { help: "Delete a retained revision after all reusable sessions and cleanup are gone.", params: [argument(["receipt_file"]), option(["--revision"], { required: true }), bindings, yes],
  callback: action(async (ctx, params) => {
    requireYes(params); const file = path.resolve(String(params.receipt_file)), receipt = readReceipt(file), services = await dependencies(receipt.plan, params);
    const result = await lock(receipt.plan, services.fc.accountId, () => retireRevision(receipt, String(params.revision), services, file)); getFormatter(ctx).printDict(publicSummary(result, file));
  }) }));
app.addCommand(command("destroy", { help: "Drain the application and delete only its recorded owned resources.", params: [argument(["plan_file"]), bindings, yes],
  callback: action(async (ctx, params) => {
    requireYes(params); const plan = readPlan(path.resolve(String(params.plan_file))), services = await dependencies(plan, params);
    const result = await lock(plan, services.fc.accountId, () => destroyPlan(plan, services)); getFormatter(ctx).printDict(publicSummary(result, plan.previousReceipt));
  }) }));

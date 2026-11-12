/** Common names and raw Sandbox IDs resolve to the existing lifecycle operations. */
import fs from "node:fs";
import path from "node:path";
import { argument, command, option, type Params } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { getFormatter } from "../formatters.js";
import { UsageError, KeyboardInterrupt, SystemExit } from "../errors.js";
import { echo } from "../io.js";
import { INT, Choice } from "../types.js";
import { Sandbox } from "../../api/sandbox.js";
import { cleanupResourceJournal } from "../../template/cleanup.js";
import { SandboxNotFoundError } from "../../models/errors.js";
import type { SandboxInfo } from "../../models/sandbox.js";
import { listProviders, resolveProviderId } from "../../providers/registry.js";
import { cliProvider } from "../../providers/selection.js";
import { paths } from "../../transport/config_layers.js";
import { ApplicationError, writeJson } from "../../application/config.js";
import { releaseStoppedApplicationLock } from "../../application/lock.js";
import { createDestroyPlan, destroyPlan, observeReceipt, publicSummary, readReceipt, retireRevision, withApplicationLock } from "../../application/service.js";
import { createFcTransport, resolveDeployCredentials, verifyFunction } from "../../application/fc.js";
import { cleanBuild } from "../../application/tools.js";
import { checkDeploymentSelection, listDeployments, readDeployment, saveDeployment, type Deployment } from "../deployment_store.js";
import { applicationLock, applicationControlServices, approve, deploymentSummary } from "./deploy.js";

export const managementSeams = { info: Sandbox.getInfoById.bind(Sandbox), list: Sandbox.list.bind(Sandbox), kill: Sandbox.killById.bind(Sandbox), destroy: destroyPlan, observe: observeReceipt };
const target = argument(["target"]);
const yes = option(["--yes", "-y"], { is_flag: true });
const bindings = option(["--bindings"], { help: "Override the private application bindings file for this operation." });
const bindingFile = (value: Deployment, params: Params): string | undefined => params.bindings ? path.resolve(String(params.bindings)) : value.bindings;
const connection = (value: Deployment) => ({ provider: value.provider, provider_options: value.providerOptions, ...value.connection });
function sandboxInfo(info: SandboxInfo): Record<string, unknown> {
  const { envd_access_token: _authorization, ...publicInfo } = info.modelDump({mode:"json"});
  return publicInfo;
}
function savedTarget(name: string): Deployment | undefined { const value = readDeployment(name); if (value) checkDeploymentSelection(value); return value; }
async function absentSandbox(id: string, options: Parameters<typeof Sandbox.getInfoById>[1]): Promise<boolean> {
  try { await managementSeams.info(id, options); return false; } catch (error) { if (error instanceof SandboxNotFoundError) return true; throw error; }
}
export const list = command("list", {
  help: "List local deployments and remote sandboxes. Local names take precedence over raw Sandbox IDs. --local avoids cloud queries.",
  params: [option(["--local"], { is_flag: true }), option(["--all-providers"], { is_flag: true }), option(["--limit"], { type: INT, default: 100 }), option(["--offset"], { type: INT, default: 0 }), option(["--status"], { type: new Choice(["running", "stopped", "creating", "paused", "error"]) })],
  callback: handleErrors(async (ctx, params) => {
    if (params.limit < 1 || params.offset < 0) throw new UsageError("--limit must be positive and --offset nonnegative.");
    const local = listDeployments().filter(value => value.status !== "deleted");
    const rows: Record<string, unknown>[] = local.map(value => ({ ...deploymentSummary(value), observation: "recorded" }));
    const errors: Array<{ provider: string; code: string }> = [];
    if (!params.local) {
      const providers = params.all_providers ? listProviders().map(item => item.id) : [resolveProviderId(cliProvider())];
      const failures: unknown[] = [];
      let succeeded = 0;
      for (const provider of providers) {
        try {
          const found = await managementSeams.list({ provider, limit: params.limit, offset: params.offset, status: params.status ?? null });
          succeeded++;
          for (const info of found) {
            const existing = rows.find(value => value.provider === provider && value.sandbox_id === info.sandbox_id);
            if (existing) Object.assign(existing, { template: info.template, status: info.status, observation: "remote" });
            else rows.push({ name: null, kind: "sandbox", provider, sandbox_id: info.sandbox_id, template: info.template, status: info.status, observation: "remote" });
          }
        } catch (error) {
          if (error instanceof KeyboardInterrupt || error instanceof SystemExit || !params.all_providers) throw error;
          const reported = error && typeof error === "object" && "code" in error ? String(error.code) : "";
          const code = /^E[0-9]{4}$/.test(reported) ? reported : "E0000";
          failures.push(error); errors.push({ provider, code });
          echo(`Warning: Provider '${provider}' could not be queried (${code}); results are incomplete.`, { err: true });
        }
      }
      if (!succeeded && failures.length) throw failures[0];
    }
    const formatter = getFormatter(ctx);
    if (formatter.use_json) formatter.printData({ items: rows, partial: errors.length > 0, errors });
    else formatter.printTable(["Name", "Kind", "Provider", "Sandbox ID", "Status", "Observation"], rows.map(row => [row.name, row.kind, row.provider, row.sandbox_id, row.status, row.observation].map(value => value == null ? "-" : String(value))));
  }),
});
export const status = command("status", {
  help: "Inspect a named deployment or raw Sandbox ID without resuming it. --revisions includes retained application versions.",
  params: [target, option(["--revisions"], { is_flag: true })],
  callback: handleErrors(async (ctx, params) => {
    const value = savedTarget(String(params.target));
    if (!value) { getFormatter(ctx).printDict(sandboxInfo(await managementSeams.info(String(params.target)))); return; }
    if (value.kind === "sandbox") {
      let remote: Record<string, unknown> | null = null;
      if (value.sandboxId) try { remote = sandboxInfo(await managementSeams.info(value.sandboxId, connection(value))); } catch (error) { if (!(error instanceof SandboxNotFoundError)) throw error; }
      getFormatter(ctx).printDict({ ...deploymentSummary(value), remote, recovery_required: value.status === "requires_recovery" }); return;
    }
    if (!value.receipt || !fs.existsSync(value.receipt)) { getFormatter(ctx).printData({ ...deploymentSummary(value), recovery_required: value.status !== "deleted", previous_deployment_retained: Boolean(value.previous) }); return; }
    const receipt = readReceipt(value.receipt), credential = await resolveDeployCredentials(receipt.plan.template.application.deployment.accessRef);
    if (credential.AccountID !== receipt.accountId) throw new ApplicationError("Current account differs from the saved deployment owner.");
    const fc = createFcTransport(credential, receipt.plan.template.application.deployment.region), resources = [];
    for (const item of receipt.functions) {
      const actual = await fc.describeFunction(item.functionName);
      if (actual) verifyFunction(actual, receipt.accountId, receipt.plan.template.application.deployment.region, item.functionName, item);
      resources.push({ role: item.role, function: item.functionName, present: Boolean(actual) });
    }
    getFormatter(ctx).printData({ ...deploymentSummary(value), ...publicSummary(receipt), resources, ...(params.revisions ? { revisions: receipt.retained } : {}) });
  }),
});
interface JournalEntry { kind: "sandbox" | "template" | "image"; id?: string; state: string; cleanup: string; intent_id: string }
function journal(value: Deployment): { file: string; entries: JournalEntry[]; [key: string]: unknown } | undefined {
  if (!value.journal || !fs.existsSync(value.journal)) return undefined;
  const data = JSON.parse(fs.readFileSync(value.journal, "utf8"));
  if (data.version !== 1 || data.provider !== value.provider || !Array.isArray(data.entries)) throw new ApplicationError("Invalid resource journal; preserve it for recovery.");
  return { ...data, file: value.journal };
}
async function deleteSandboxDeployment(value: Deployment): Promise<Record<string, unknown>> {
  let retained: unknown[] = [];
  if (value.effectsStarted === false && !value.sandboxId) {
    // Admission failed before the launcher entered any resource operation.
  } else if (value.journal && fs.existsSync(value.journal)) {
    const result = await cleanupResourceJournal(value.journal, value); retained = result.retained;
    if (!result.complete) { value.status = "requires_recovery"; saveDeployment(value); throw new ApplicationError(`Cleanup remains incomplete (${result.failures.join(", ")}). Run recover ${value.name}.`); }
  } else if (value.sandboxId) {
    if (!await absentSandbox(value.sandboxId, connection(value))) await managementSeams.kill(value.sandboxId, connection(value));
    if (!await absentSandbox(value.sandboxId, connection(value))) throw new ApplicationError("Sandbox deletion is not confirmed.");
  } else if (value.status !== "deleted") throw new ApplicationError("Creation outcome is unknown; preserve the record for recovery.");
  if (value.borrowedBuild) await withApplicationLock(path.join(paths.abxDir, "template-build-locks"), value.borrowedBuild, async () => {
    const artifact = JSON.parse(fs.readFileSync(value.borrowedBuild!, "utf8"));
    artifact.consumers = (artifact.consumers ?? []).filter((item: string) => item !== path.join(paths.abxDir, "deployments", value.name, "deployment.json")); writeJson(value.borrowedBuild!, artifact);
  });
  value.status = "deleted"; saveDeployment(value);
  return { ...deploymentSummary(value), retained_build_artifacts: retained };
}
export const deleteDeployment = command("delete", {
  help: "Delete a named deployment's owned resources, or a raw Sandbox ID. Borrowed builds and external services are retained. --revision retires an unused retained application version.",
  params: [target, yes, bindings, option(["--revision"])],
  callback: handleErrors(async (ctx, params) => {
    const name = String(params.target), initial = savedTarget(name);
    await approve(ctx, params, `Delete ${name}${params.revision ? ` revision ${params.revision}` : " and its owned resources"}?`);
    if (!initial) { if (params.revision) throw new UsageError("--revision requires a named application."); await managementSeams.kill(name); if (!await absentSandbox(name, {})) throw new ApplicationError("Sandbox deletion is not yet confirmed."); getFormatter(ctx).printData({ sandbox_id: name, status: "deleted" }); return; }
    await withApplicationLock(path.join(paths.abxDir, "deployment-locks"), name, async () => {
      const value = savedTarget(name); if (!value) throw new ApplicationError("Deployment record changed before deletion.");
      if (value.kind === "sandbox") { if (params.revision) throw new UsageError("Sandbox deployments have no retained application revisions."); getFormatter(ctx).printData(await deleteSandboxDeployment(value)); return; }
      if (!value.receipt || !fs.existsSync(value.receipt)) {
        if (value.ownsBuild && value.build && fs.existsSync(value.build)) { const build = JSON.parse(fs.readFileSync(value.build, "utf8")); const credential = await resolveDeployCredentials(build.accessRef ?? "abx"); await cleanBuild(value.build, credential); }
        if (value.previous) throw new ApplicationError("The failed preparation was cleaned. A previous application is retained; recover this deployment before deleting its active resources.");
        value.status = "deleted"; saveDeployment(value); getFormatter(ctx).printData(deploymentSummary(value)); return;
      }
      const receipt = readReceipt(value.receipt), services = await applicationControlServices(receipt, bindingFile(value, params));
      const result = await applicationLock(receipt.plan, services.fc.accountId, async () => params.revision ? retireRevision(receipt, String(params.revision), services, value.receipt!) : managementSeams.destroy(createDestroyPlan(value.receipt!), services));
      if (!params.revision) value.status = "deleted";
      saveDeployment(value); getFormatter(ctx).printData({ ...deploymentSummary(value), ...publicSummary(result) });
    });
  }),
});
export const recover = command("recover", {
  help: "Inspect interrupted deployment effects using saved ownership records. Never repeats a create or publication request. Use delete after resolving any uncertain ownership.",
  params: [target, bindings, option(["--receipt"], { help: "Import an existing application receipt under this local name for inspection and cleanup." })],
  callback: handleErrors(async (ctx, params) => {
    const name = String(params.target);
    if (params.receipt) {
      if (readDeployment(name)) throw new UsageError("This deployment name already exists; omit --receipt to recover its saved operation.");
      const file = fs.realpathSync(String(params.receipt)), receipt = readReceipt(file);
      saveDeployment({ version: 1, name, kind: "application", provider: "alicloud-express", status: receipt.status === "ready" ? "ready" : receipt.status === "destroyed" ? "deleted" : "requires_recovery", receipt: file, createdAt: receipt.updatedAt, updatedAt: receipt.updatedAt, ...(params.bindings ? { bindings: fs.realpathSync(String(params.bindings)) } : {}) });
    }
    const initial = savedTarget(name); if (!initial) throw new UsageError("Recovery requires a local deployment name.");
    releaseStoppedApplicationLock(path.join(paths.abxDir, "deployment-locks"), name);
    await withApplicationLock(path.join(paths.abxDir, "deployment-locks"), name, async () => {
      const value = savedTarget(name); if (!value) throw new ApplicationError("Deployment record changed before recovery.");
      if (value.kind === "application" && value.receipt && fs.existsSync(value.receipt)) {
        const receipt = readReceipt(value.receipt), services = await applicationControlServices(receipt, bindingFile(value, params));
        releaseStoppedApplicationLock(path.join(paths.abxDir, "app-locks"), `${services.fc.accountId}/${receipt.plan.template.application.deployment.region}/${receipt.plan.applicationId ?? receipt.plan.template.name}`);
        getFormatter(ctx).printData(await applicationLock(receipt.plan, services.fc.accountId, () => managementSeams.observe(receipt, services, value.receipt))); return;
      }
      if (value.kind === "application" && value.previous) {
        const build = value.build && fs.existsSync(value.build) ? JSON.parse(fs.readFileSync(value.build, "utf8")) : undefined;
        if (!value.ownsBuild || !build || build.status === "cleaned") { const previous: Deployment = JSON.parse(fs.readFileSync(value.previous, "utf8")); saveDeployment(previous); getFormatter(ctx).printData({ ...deploymentSummary(previous), recovery: "previous deployment restored; no cloud operation replayed" }); return; }
      }
      const saved = journal(value);
      getFormatter(ctx).printData({ ...deploymentSummary(value), resources: saved?.entries ?? [], sandbox_absent: value.sandboxId ? await absentSandbox(value.sandboxId, connection(value)) : null, next: "Delete known owned resources; resolve unknown creation outcomes using their recorded correlation keys before retrying." });
    });
  }),
});
export const logs = command("logs", {
  help: "Read deployment logs. Sandbox service logs use the template startup log; --source platform selects native sandbox logs.",
  params: [target, option(["--source"], { type: new Choice(["service", "platform"]), default: "service" }), option(["--role"], { type: new Choice(["gateway", "worker", "dispatcher"]), default: "gateway" }), option(["--follow", "-f"], { is_flag: true }), option(["--lines"], { type: INT, default: 100 })],
  callback: handleErrors(async (ctx, params) => {
    const value = savedTarget(String(params.target));
    if (value?.kind === "application") {
      const { applicationLogs } = await import("../../application/logs.js");
      if (!value.receipt) throw new ApplicationError("Deployment has no running application receipt.");
      getFormatter(ctx).printData(await applicationLogs(readReceipt(value.receipt), String(params.role), Number(params.lines), Boolean(params.follow))); return;
    }
    if (params.source === "platform" || !value) { const { logs } = await import("./sandbox_native.js"); await ctx.invoke(logs, { sandbox_id: params.target, follow: params.follow }); return; }
    if (params.lines < 1 || params.lines > 10000) throw new UsageError("--lines must be between 1 and 10000.");
    const { exec_cmd } = await import("./sandbox.js");
    await ctx.invoke(exec_cmd, { sandbox_id: params.target, command: ["tail", "-n", String(params.lines), ...(params.follow ? ["-f"] : []), "/tmp/abx-template-server.log"], cwd: "", env: [], cmd_timeout: params.follow ? 3600 : 30, stream: true, background: false });
  }),
});

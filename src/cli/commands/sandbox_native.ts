import { sandboxTarget, connectSandboxTarget } from "../deployment_store.js";
/** Sandbox protocol operations exposed through the single abx parser and output formatter. */
import { _selectProvider } from "../../api/sandbox.js";
import { ProviderFeatureNotSupportedError } from "../../models/provider_errors.js";
import { loadLayeredConfig, explainConfig } from "../../transport/config_layers.js";
import { withGuidedConfiguration } from "../config_guidance.js";
import { argument, command, group, option, type Command, type Context } from "../kit.js";
import { getFormatter } from "../formatters.js";
import { handleErrors } from "../error_handler.js";
import { UsageError, sysExit } from "../errors.js";
import { INT, Choice } from "../types.js";
import { echo } from "../io.js";
import { cliOptions } from "../../providers/selection.js";
import { confirm } from "../prompts.js";
import type { Sandbox, SandboxApiOpts } from "e2b";

type Params = Record<string, unknown>;

export function isExpressReference(reference: string): boolean { const target = sandboxTarget(reference); return _selectProvider(target.provider, target.id)[0].id === "alicloud-express"; }

/** Resolve explicit provider and reference together; never send another provider's ID/key to Express. */
export async function withNativeSandbox<T>(ctx: Context, reference: string | undefined,
  action: (runtime: typeof import("../../standard_cli/runtime.mjs"), id: string | undefined, options: SandboxApiOpts & { apiUrl: string }) => Promise<T>): Promise<T> {
  const target = reference ? sandboxTarget(reference) : undefined;
  const [provider, id] = _selectProvider(target?.provider, target?.id);
  const providerOptions = { ...target?.provider_options, ...cliOptions() };
  const routing = { ...(target?.api_url ? { sandbox_base_url: target.api_url } : {}), ...(target?.domain ? { sandbox_domain: target.domain } : {}) };
  if (provider.id !== "alicloud-express") throw new ProviderFeatureNotSupportedError(provider.id, "Sandbox protocol operation");
  return withGuidedConfiguration(ctx, { operation: "Sandbox operation", provider: provider.id, requirements: ["sandbox_api_key"], validateProvider: false, overrides: { provider_options: providerOptions, ...routing } }, async () => {
    const overrides = { provider: provider.id, provider_options: providerOptions, ...routing };
    const config = loadLayeredConfig(overrides);
    const source = explainConfig(overrides)["sandbox_base_url"]?.source;
    const apiUrl = source && ["override", "environ", "dotenv", "toml"].includes(source) ? config.sandbox_base_url : `https://api.${config.sandbox_domain}`;
    return action(await import("../../standard_cli/runtime.mjs"), id ?? undefined, { apiKey: config.sandbox_api_key ?? undefined, apiUrl, domain: config.sandbox_domain, requestTimeoutMs: config.http_timeout * 1000 });
  });
}

export async function connectNative(ctx: Context, reference: string): Promise<Sandbox> {
  return withNativeSandbox(ctx, reference, (runtime, id, options) => runtime.Sandbox.connect(id!, options));
}

function byId(name: string, help: string, action: (ctx: Context, id: string, params: Params) => Promise<void>, params: ReturnType<typeof option>[] = []): Command {
  return command(name, { help, params: [argument("sandbox_id"), ...params], callback: handleErrors(async (ctx, values) => action(ctx, String(values["sandbox_id"]), values)) });
}

export const pause = byId("pause", "Pause a sandbox while retaining its state.", async (ctx, id) => {
  if (isExpressReference(id)) await withNativeSandbox(ctx, id, async (runtime, bare, options) => { await runtime.Sandbox.pause(bare!, options); });
  else { const sandbox = await connectSandboxTarget(id); try { await sandbox.pause(); } finally { await sandbox.close(); } }
  getFormatter(ctx).printData({ sandbox_id: id, status: "paused" });
});
export const resume = byId("resume", "Resume a paused sandbox.", async (ctx, id) => {
  if (isExpressReference(id)) await connectNative(ctx, id);
  else { const sandbox = await connectSandboxTarget(id); try { await sandbox.resume(); } finally { await sandbox.close(); } }
  getFormatter(ctx).printData({ sandbox_id: id, status: "running" });
});

const follow = option(["--follow", "-f"], { is_flag: true, help: "Continue until the sandbox stops" });

export const logs = byId("logs", "Read sandbox platform logs.", async (ctx, id, params) => {
  await withNativeSandbox(ctx, id, async (runtime, bare, options) => {
    const connection = new runtime.ConnectionConfig(options);
    const client = new runtime.ApiClient(connection);
    let start: number | undefined;
    const level = String(params["level"]).toUpperCase();
    const threshold = ["DEBUG", "INFO", "WARN", "ERROR"].indexOf(level);
    const loggers = String(params["loggers"] ?? "").split(",").filter(Boolean);
    do {
      const response = await client.api.GET("/sandboxes/{sandboxID}/logs", { params: { path: { sandboxID: bare! }, query: { start } }, signal: connection.getSignal() });
      if (response.error) throw new Error(`Cannot read sandbox logs (HTTP ${response.response.status}).`);
      const records = response.data?.logs ?? [];
      const selected = records.filter(record => {
        let data: Record<string, unknown>;
        try { data = JSON.parse(record.line) as Record<string, unknown>; } catch { return true; }
        const rank = ["DEBUG", "INFO", "WARN", "ERROR"].indexOf(String(data["level"] ?? "INFO").toUpperCase());
        return (rank < 0 || rank >= threshold) && (!loggers.length || loggers.some(logger => String(data["logger"] ?? "").startsWith(logger)));
      });
      if (!params["follow"] || selected.length) getFormatter(ctx).printData(selected);
      for (const record of records) start = Math.max(start ?? 0, new Date(record.timestamp).getTime() + 1);
      if (!params["follow"]) break;
      try { if ((await runtime.Sandbox.getInfo(bare!, options)).state !== "running") break; }
      catch (error) { if (error instanceof runtime.NotFoundError) break; throw error; }
      await new Promise(resolve => setTimeout(resolve, 400));
    } while (params["follow"]);
  });
}, [follow, option("--level", { default: "INFO", type: new Choice(["DEBUG", "INFO", "WARN", "ERROR"]), help: "Minimum log level" }), option("--loggers", { help: "Comma-separated logger prefixes" })]);

export const metrics = byId("metrics", "Read sandbox CPU, memory and disk metrics.", async (ctx, id, params) => {
  await withNativeSandbox(ctx, id, async (runtime, bare, options) => {
    let start: Date | undefined;
    do {
      const values = await runtime.Sandbox.getMetrics(bare!, { ...options, start });
      const selected = values.filter(value => !start || value.timestamp > start);
      if (!params["follow"] || selected.length) getFormatter(ctx).printData(selected);
      for (const value of values) if (!start || value.timestamp > start) start = value.timestamp;
      if (!params["follow"]) break;
      try { if ((await runtime.Sandbox.getInfo(bare!, options)).state !== "running") break; }
      catch (error) { if (error instanceof runtime.NotFoundError) break; throw error; }
      await new Promise(resolve => setTimeout(resolve, 400));
    } while (params["follow"]);
  });
}, [follow]);

export const snapshot = group("snapshot", { help: "Create, list and delete native sandbox snapshots." });
snapshot.addCommand(byId("create", "Create a snapshot from a sandbox.", async (ctx, id, params) => {
  await withNativeSandbox(ctx, id, async (runtime, bare, options) => { getFormatter(ctx).printData(await runtime.Sandbox.createSnapshot(bare!, { ...options, ...(params["name"] ? { name: String(params["name"]) } : {}) })); });
}, [option(["--name", "-n"], { help: "Snapshot template name" })]));
snapshot.addCommand(command("list", {
  help: "List snapshots; optionally filter by sandbox or snapshot name.",
  params: [argument("sandbox_id", { required: false }), option("--name"), option("--limit", { type: INT, default: 1000, help: "Maximum snapshots (0 for unlimited)" })],
  callback: handleErrors(async (ctx, params) => {
    const limit = Number(params["limit"]); if (limit < 0) throw new UsageError("--limit must be nonnegative.");
    await withNativeSandbox(ctx, params["sandbox_id"] ?? undefined, async (runtime, id, options) => {
      const paginator = runtime.Sandbox.listSnapshots({ ...options, sandboxId: id, name: params["name"] ?? undefined, limit: Math.min(limit || 100, 100) });
      const snapshots = [];
      while (paginator.hasNext && (!limit || snapshots.length < limit)) snapshots.push(...await paginator.nextItems());
      getFormatter(ctx).printData(limit ? snapshots.slice(0, limit) : snapshots);
    });
  }),
}));
snapshot.addCommand(command("delete", {
  help: "Delete snapshots. This does not delete sandboxes created from them.", params: [argument("snapshot_ids", { nargs: -1, required: true }), option("--yes", { is_flag: true, help: "Confirm deletion" })],
  callback: handleErrors(async (ctx, params) => {
    if (!params["yes"]) await confirm("Delete these snapshots?", { default: false, abort: true, err: true });
    await withNativeSandbox(ctx, undefined, async (runtime, _id, options) => {
      const results = await Promise.all((params["snapshot_ids"] as string[]).map(async id => { try { return { snapshot_id: id, deleted: await runtime.Sandbox.deleteSnapshot(id, options) }; } catch { return { snapshot_id: id, deleted: false, error: "Deletion failed" }; } }));
      getFormatter(ctx).printData(results); if (results.some(result => result.error)) sysExit(1);
    });
  }),
}));

export const fork = byId("fork", "Fork a running sandbox and return the new sandbox IDs.", async (ctx, id, params) => {
  const count = Number(params["count"]); if (count < 1 || count > 100) throw new UsageError("--count must be between 1 and 100.");
  const timeout = params["timeout"] === null ? undefined : Number(params["timeout"]); if (timeout !== undefined && timeout < 30) throw new UsageError("--timeout must be at least 30 seconds.");
  await withNativeSandbox(ctx, id, async (runtime, bare, options) => {
    const results = await runtime.Sandbox.fork(bare!, { ...options, count, ...(timeout === undefined ? {} : { timeoutMs: timeout * 1000 }) });
    const fmt = getFormatter(ctx);
    const data = results.map(result => result instanceof Error ? { error: "Fork failed" } : { sandbox_id: result.sandboxId });
    if (fmt.use_json) fmt.printData(data); else for (const result of data) if (result.sandbox_id) echo(result.sandbox_id); else fmt.printError(result.error!);
    if (data.some(result => result.error)) sysExit(1);
  });
}, [option(["--count", "-n"], { type: INT, default: 1 }), option("--timeout", { type: INT, help: "Lifetime in seconds (minimum 30)" })]);

export const network = group("network", { help: "Read or update a sandbox's network policy." });
network.addCommand(byId("get", "Read the current sandbox network policy.", async (ctx, id) => {
  await withNativeSandbox(ctx, id, async (runtime, bare, options) => { getFormatter(ctx).printData((await runtime.Sandbox.getInfo(bare!, options)).network ?? {}); });
}));
network.addCommand(byId("update", "Replace all egress rules from JSON (allowOut, denyOut, rules, egressProxy, allowInternetAccess). Omitted rules and proxy settings are cleared.", async (ctx, id, params) => {
  let policy: unknown; try { policy = JSON.parse(String(params["input"])); } catch { throw new UsageError("--input must be a JSON object."); }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new UsageError("--input must be a JSON object.");
  const supported = new Set(["allowOut", "denyOut", "rules", "egressProxy", "allowInternetAccess"]);
  if (Object.keys(policy).some(key => !supported.has(key))) throw new UsageError("Unknown network field. Use network update --help for supported fields.");
  if (!params["yes"]) await confirm("Replace this sandbox's egress policy (omitted rules are cleared)?", { default: false, abort: true, err: true });
  await withNativeSandbox(ctx, id, async (runtime, bare, options) => { await runtime.Sandbox.updateNetwork(bare!, policy, options); getFormatter(ctx).printData({ sandbox_id: id, updated: true }); });
}, [option("--input", { required: true, help: "Network update JSON" }), option("--yes", { is_flag: true })]));

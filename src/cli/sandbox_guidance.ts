/** Native sandbox preflight, after parser validation and before any SDK request. */
import type { Context } from "./kit.js";
import { withGuidedConfiguration } from "./config_guidance.js";
import { sandboxTarget } from "./deployment_store.js";
import { cliProvider } from "../providers/selection.js";
import { getProvider, parseSandboxRef, resolveProviderId } from "../providers/registry.js";
import { ProviderMismatchError } from "../models/provider_errors.js";
import { UsageError } from "./errors.js";

/** Provider-backed platform operations participate; API contract help and binding remain local. */
export async function withSandboxConfiguration<T>(ctx: Context, params: Record<string, unknown>, action: () => Promise<T>): Promise<T> {
  const path: string[] = [];
  for (let current: Context | null = ctx; current; current = current.parent) path.unshift(current.command.name);
  const verb = path.length >= 2 && path[0] === "abx" ? path[1] : undefined;
  const roots = new Set(["list", "info", "kill", "exec", "connect", "pause", "resume", "upload", "download", "files", "process", "system", "capabilities", "metrics", "snapshot", "fork", "network"]);
  if (!verb || !roots.has(verb) || params["all_providers"] || verb === "list" && params["local"]) return action();
  if (params["background"] && params["stream"]) throw new UsageError("--background and --stream cannot be combined.");
  for (const [key, label] of [["env", "environment variable"], ["metadata", "metadata"]]) {
    const pairs = params[key!] as unknown;
    if (Array.isArray(pairs) && pairs.some((pair) => typeof pair === "string" && !pair.includes("="))) {
      throw new UsageError(`Invalid ${label} format (expected KEY=VALUE).`);
    }
  }
  if (verb === "kill" && !params["all"] && !params["sandbox_id"] && !(params["sandbox_ids"] as unknown[] | undefined)?.length) return action();
  const raw = params["sandbox_id"] ?? params["sandbox_ids"];
  const refs = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === "string");
  const targets = refs.map(ref => sandboxTarget(ref));
  const explicit = cliProvider();
  const qualified = new Set<string>();
  for (const target of targets) {
    const id = target.provider ?? parseSandboxRef(target.id)[0];
    if (id) {
      if (explicit && explicit !== id) throw new ProviderMismatchError(`Sandbox belongs to '${id}', which conflicts with --provider ${explicit}.`);
      qualified.add(id);
    }
  }
  // Mixed-provider operations keep their existing per-provider result/error semantics, rather than prompting a login loop.
  if (qualified.size > 1) return action();
  const provider = getProvider([...qualified][0] ?? resolveProviderId(explicit));
  provider.require("sandbox.lifecycle");
  const feature = ({ files: "files.rw", upload: "files.rw", download: "files.rw", exec: "exec.run", process: "exec.run", connect: "pty" } as Record<string, string>)[verb];
  if (feature) provider.require(feature);
  const target = targets.length === 1 ? targets[0] : undefined;
  return withGuidedConfiguration(ctx, { operation: ctx.commandPath, provider: provider.id, yes: Boolean(params["yes"]),
    requirements: provider.id === "alicloud-express" ? ["sandbox_api_key"] : undefined,
    validateProvider: provider.id !== "alicloud-express", overrides: { region: params["region"], ...(target?.provider_options ? { provider_options: target.provider_options } : {}), ...(target?.api_url ? { sandbox_base_url: target.api_url } : {}), ...(target?.domain ? { sandbox_domain: target.domain } : {}) },
  }, action);
}

/** Native sandbox preflight, after parser validation and before any SDK request. */
import type { Context } from "./kit.js";
import { withGuidedConfiguration } from "./config_guidance.js";
import { cliProvider } from "../providers/selection.js";
import { getProvider, parseSandboxRef, resolveProviderId } from "../providers/registry.js";
import { ProviderMismatchError } from "../models/provider_errors.js";
import { UsageError } from "./errors.js";
import { getFormatter } from "./formatters.js";

/** Only sandbox business commands participate; diagnostic, config and aggregate commands remain noninteractive. */
export async function withSandboxConfiguration<T>(ctx: Context, params: Record<string, unknown>, action: () => Promise<T>): Promise<T> {
  const path: string[] = [];
  for (let current: Context | null = ctx; current; current = current.parent) path.unshift(current.command.name);
  const sandbox = path.findIndex((name) => name === "sandbox" || name === "sbx");
  const verb = sandbox >= 0 ? path[sandbox + 1] : path.length === 2 && path[0] === "abx" ? path[1] : undefined;
  const roots = new Set(["list", "info", "kill", "exec", "connect", "pause", "resume", "upload", "download", "run"]);
  if (!verb || verb === "create" || sandbox < 0 && !roots.has(verb) || params["all_providers"]) return action();
  if (params["background"] && params["stream"]) throw new UsageError("--background and --stream cannot be combined.");
  if (verb === "run" || verb === "command" && path.at(-1) === "run") {
    const { _commandArguments } = await import("./commands/sandbox.js");
    _commandArguments((params["args"] as string[] | undefined) ?? [], (params["json_args"] as string | null | undefined) ?? null, getFormatter(ctx));
  }
  for (const [key, label] of [["env", "environment variable"], ["metadata", "metadata"]]) {
    const pairs = params[key!] as unknown;
    if (Array.isArray(pairs) && pairs.some((pair) => typeof pair === "string" && !pair.includes("="))) {
      throw new UsageError(`Invalid ${label} format (expected KEY=VALUE).`);
    }
  }
  if (verb === "kill" && !params["all"] && !params["sandbox_id"] && !(params["sandbox_ids"] as unknown[] | undefined)?.length) return action();
  const raw = params["sandbox_id"] ?? params["sandbox_ids"];
  const refs = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === "string");
  const explicit = cliProvider();
  const qualified = new Set<string>();
  for (const ref of refs) {
    const [id] = parseSandboxRef(ref);
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
  return withGuidedConfiguration(ctx, { operation: ctx.commandPath, provider: provider.id, yes: Boolean(params["yes"]),
    requirements: provider.id === "alicloud-express" ? ["sandbox_api_key"] : undefined,
    validateProvider: provider.id !== "alicloud-express", overrides: { region: params["region"] },
  }, action);
}

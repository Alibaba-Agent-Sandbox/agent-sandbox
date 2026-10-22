/** Project-owned, operation-aware configuration setup. Never retries an executed cloud mutation. */
import type { Context } from "./kit.js";
import { Abort, CliError } from "./errors.js";
import { canPrompt } from "./interaction.js";
import { prompt } from "./prompts.js";
import { getOutput } from "./output.js";
import { cliProvider, cliOptions } from "../providers/selection.js";
import { getProvider, resolveProviderId } from "../providers/registry.js";
import { collectSources, explainConfig, loadLayeredConfig, paths, resetLayeredConfig, type LayeredConfig } from "../transport/config_layers.js";
import { resetConfig } from "../transport/config.js";
import { getOperationConfig, withOperationConfig } from "../utils/operation_config.js";
import { assertConfigFilesReadable, assertConfigValuesValid } from "../utils/config_diagnostics.js";
import { CORE_KEYS, GENERIC_ENDPOINT_KEYS, getKey, type ConfigKey } from "../utils/config_keys.js";
import { coerce } from "../utils/config_resolver.js";
import { bundledConfig } from "../utils/bundled_config.js";

export interface GuidanceField {
  key: string;
  label?: string;
  secret?: boolean;
  env?: string;
  /** Custom operation inputs without a config key may only be used for this operation. */
  persist?: boolean;
  flag?: string;
}

export interface ConfigurationRequest {
  operation: string;
  requirements?: readonly (string | GuidanceField)[];
  provider?: string;
  yes?: boolean;
  overrides?: Record<string, unknown>;
  /** Nonempty values already resolved by an owning adapter, including its test seams. */
  values?: Record<string, unknown>;
  validateProvider?: boolean;
}

export const canGuideConfiguration = canPrompt;

/** Test seams keep terminal simulation separate from production's strict terminal policy. */
export const guidanceSeams = {
  interactive: canPrompt,
  ask: (label: string, secret: boolean): Promise<string> => prompt(label, {
    default: "", show_default: false, hide_input: secret, err: true,
  }) as Promise<string>,
};

const aliases: Record<string, string> = { api_key: "sandbox_api_key", api_url: "sandbox_base_url", domain: "sandbox_domain" };
const has = (v: unknown): boolean => v !== null && v !== undefined && (typeof v !== "string" || Boolean(v.trim()));
const canonical = (name: string): string => aliases[name] ?? name;
const safeHost = (value: string): string => {
  try { return new URL(value).host; } catch { return "(not configured)"; }
};

function configValue(config: LayeredConfig, key: string): unknown {
  if (getProvider(config.provider).configFields.some((field) => field.key === key) && !bundledConfig(config.provider)?.transportFields.has(key)) {
    return config.provider_options[key];
  }
  return (config as unknown as Record<string, unknown>)[key] ?? config.provider_options[key];
}

/** Fill exactly the missing values of an execution plan and run using that same isolated snapshot. */
export async function withGuidedConfiguration<T>(
  ctx: Context | undefined,
  request: ConfigurationRequest,
  action: () => Promise<T>,
): Promise<T> {
  const provider = getProvider(request.provider ?? resolveProviderId(cliProvider()));
  const overrides: Record<string, unknown> = { provider: provider.id, provider_options: cliOptions() };
  for (const [name, value] of Object.entries(request.overrides ?? {})) if (has(value)) overrides[canonical(name)] = value;
  assertConfigFilesReadable(paths.configFile, paths.envFiles);
  assertConfigValuesValid([...CORE_KEYS.filter((key) => !GENERIC_ENDPOINT_KEYS.includes(key.key) || provider.inherit.has(key.key)), ...provider.configKeys()],
    collectSources({ ...((overrides["provider_options"] as Record<string, unknown> | undefined) ?? {}), ...overrides }), provider.id);
  const config = loadLayeredConfig(overrides);
  const cfg = await import("./commands/config_cmd.js");
  const fields = new Map<string, GuidanceField>();
  const keys = new Map<string, ConfigKey>(provider.configKeys().map((key) => [key.key, key]));
  for (const requirement of request.requirements ?? []) {
    const field = typeof requirement === "string" ? { key: canonical(requirement) } : { ...requirement, key: canonical(requirement.key) };
    fields.set(field.key, field);
  }
  const values: Record<string, unknown> = {};
  const effective = (key: string): unknown => {
    if (has(overrides[key])) return overrides[key];
    const fromConfig = configValue(config, key);
    if (has(fromConfig)) return fromConfig;
    if (has(values[key])) return values[key];
    // A plugin field must never inherit an unrelated global field with the same name.
    if (provider.configFields.some((field) => field.key === key)) return undefined;
    return cfg._ALLOWED_KEYS.has(key) ? cfg._effectiveValue(key)[0] : undefined;
  };
  for (const [key, value] of Object.entries(request.values ?? {})) {
    const name = canonical(key);
    if (has(value) && !has(configValue(config, name))) values[name] = value;
  }
  // Provider-owned required fields and alternative authentication are independent of Express's build plan.
  if (request.validateProvider !== false) {
    for (const field of provider.configFields) if (field.required) fields.set(field.key, { key: field.key, label: field.description, secret: field.secret });
    const have = (key: string): boolean => has(effective(key)) && (!GENERIC_ENDPOINT_KEYS.includes(key) || provider.inherit.has(key));
    if (provider.authAnyOf.length && !provider.authAnyOf.some((group) => group.every(have))) {
      const groups = provider.authAnyOf.filter((group) => group.every((key) => keys.has(key) ||
        GENERIC_ENDPOINT_KEYS.includes(key) && provider.inherit.has(key)));
      if (!groups.length) throw new CliError(`Provider '${provider.id}' declares no usable authentication configuration. Run 'abx provider info ${provider.id}'.`);
      let group = groups[0]!;
      if (groups.length > 1 && guidanceSeams.interactive(ctx, request.yes)) {
        getOutput(ctx).info(`Authentication choices for ${provider.id}:\n` + groups.map((g, i) => `  ${i + 1}. ${g.join(" + ")}`).join("\n"));
        for (;;) {
          const selected = await guidanceSeams.ask("Choose an authentication method (number; Enter cancels)", false);
          if (!selected) throw new Abort();
          const choice = Number(selected);
          if (Number.isInteger(choice) && choice >= 1 && choice <= groups.length) { group = groups[choice - 1]!; break; }
          getOutput(ctx).warning("Choose one of the listed authentication methods.");
        }
      } else if (groups.length > 1) {
        throw new CliError(`Missing authentication for provider '${provider.id}'. Configure one of: ` +
          groups.map((g) => g.join(" + ")).join("; or ") + `. Run 'abx provider config ${provider.id} init' in a terminal.`);
      }
      for (const key of group) fields.set(key, { key });
    }
  }
  const missing: GuidanceField[] = [];
  for (const [name, field] of fields) {
    if (!has(effective(name))) missing.push(field);
    else values[name] = effective(name);
  }
  const snapshot = (): Record<string, unknown> => ({ ...config, ...getOperationConfig(), ...values, ...overrides,
    provider_options: { ...config.provider_options, ...((overrides["provider_options"] as Record<string, unknown> | undefined) ?? {}),
      ...Object.fromEntries(Object.entries(values).filter(([name]) => keys.has(name) && !bundledConfig(provider.id)?.transportFields.has(name))) },
  });
  const execute = (): Promise<T> => {
    if (request.validateProvider !== false) provider.validateConfig(loadLayeredConfig({ provider: provider.id }));
    return action();
  };
  if (!missing.length) return withOperationConfig(snapshot(), execute);
  const repairKey = (key: string): string => keys.has(key) || GENERIC_ENDPOINT_KEYS.includes(key) && provider.inherit.has(key)
    ? `providers.${provider.id}.${key}` : key;
  const persistable = (field: GuidanceField): boolean => field.persist !== false && (keys.has(field.key) || Boolean(getKey(field.key)) || cfg._ALLOWED_KEYS.has(field.key));
  const repair = (field: GuidanceField): string => persistable(field) ? `abx config set ${repairKey(field.key)}`
    : field.flag ? `supply ${field.flag}` : field.env ? `set ${field.env}` : "supply this operation's documented option";
  const details = missing.map((f) => `  - ${f.key}: ${repair(f)}`).join("\n");
  const out = getOutput(ctx);
  if (!guidanceSeams.interactive(ctx, request.yes)) {
    throw new CliError(`Missing configuration for ${request.operation}:\n${details}\n` +
      (request.yes ? "--yes/-y skips configuration prompts. To enter missing values interactively, rerun this command without --yes/-y in a terminal.\n" : "") +
      "Run the configuration commands in a terminal, or supply the documented environment variables in automation. No cloud operation was submitted.");
  }
  const explanation = explainConfig(overrides);
  out.info(`Provider: ${provider.id}\nRegion: ${config.region || "(not configured)"} (${explanation["region"]?.source ?? "current command"})\n` +
    `API host: ${safeHost(config.sandbox_base_url)} (${explanation["sandbox_base_url"]?.source ?? "current command"})`);
  const registry = effective("acr_registry");
  if (typeof registry === "string" && registry) out.info(`Registry host: ${safeHost(registry.includes("://") ? registry : `https://${registry}`)}`);
  out.info(`${request.operation} needs ${missing.length} configuration value(s):\n${details}`);
  if (missing.some((f) => f.key === "sandbox_api_key")) out.info("Sandbox API keys create and connect to sandboxes. Alibaba Cloud AccessKeys used for builds do not replace a Sandbox API key.");
  const canSave = missing.some(persistable);
  let scope = "1";
  if (canSave) {
    for (;;) {
      scope = await guidanceSeams.ask("Configuration scope: 1 only this command (default), 2 save for future commands, 3 cancel", false);
      if (!scope || scope === "1" || scope === "2") break;
      if (scope === "3") throw new Abort();
      out.warning("Choose 1, 2 or 3. Enter uses configuration only for this command.");
    }
  }
  for (const field of missing) {
    const metadata = keys.get(field.key) ?? getKey(field.key);
    const secret = field.secret ?? metadata?.secret ?? /(?:secret|password|token|api_key)$/.test(field.key);
    for (;;) {
      const answer = await guidanceSeams.ask(`${field.label ?? field.key}${secret ? " (input hidden)" : ""}; Enter cancels`, secret);
      if (!answer.trim()) throw new Abort();
      let value: unknown = answer.trim();
      if (metadata) {
        value = coerce(metadata, answer);
        if (value === null || metadata.type === "url" && !validUrl(String(value), field.key === "sandbox_base_url" || field.key === "llm_base_url")) {
          out.warning(`Invalid value for '${field.key}'; expected ${metadata.type}${metadata.choices.length ? ` (${metadata.choices.join(", ")})` : ""}.`);
          continue;
        }
      }
      values[field.key] = value;
      break;
    }
  }
  if (scope === "2") {
    const saved: string[] = [];
    for (const field of missing) {
      if (!persistable(field)) { out.info(`${field.key} applies only to the current operation.`); continue; }
      try {
        const scoped = keys.has(field.key) || GENERIC_ENDPOINT_KEYS.includes(field.key) && provider.inherit.has(field.key);
        const location = cfg.saveGuidedValue(field.key, String(values[field.key]), scoped ? provider.id : undefined);
        saved.push(field.key);
        out.info(`Saved ${field.key} in ${location.path}. Change it later: abx config set ${repairKey(field.key)} (value hidden when sensitive).`);
      } catch {
        throw new CliError(`Could not finish saving '${field.key}'. ${saved.length ? `Completed fields: ${saved.join(", ")}.` : "No field has completed saving."} ` +
          "This field may have been written before cleanup failed; review 'abx config list', configuration support and file permissions. The operation was not started.");
      }
    }
    resetConfig(); resetLayeredConfig();
    for (const field of missing) {
      if (!persistable(field)) continue;
      const now = loadLayeredConfig(overrides);
      const actual = configValue(now, field.key) ?? cfg._effectiveValue(field.key)[0];
      if (String(actual) !== String(values[field.key])) {
        throw new CliError(`Saved '${field.key}' is overridden by another configuration source. Review 'abx config list' and the environment/project dotenv settings before retrying. The operation was not started.`);
      }
    }
  } else {
    out.info("Configuration applies only to this command; no credentials were saved to user configuration. Future commands may need configuration again.");
  }
  out.info(`Configuration for ${request.operation} is complete; continuing the current operation.`);
  return withOperationConfig(snapshot(), execute);
}

function validUrl(value: string, httpOnly = false): boolean {
  try { const url = new URL(value); return !httpOnly || url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
}

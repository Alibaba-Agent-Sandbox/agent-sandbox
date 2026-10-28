/** Project-owned, operation-aware configuration setup. Never retries an executed cloud mutation. */
import { getCurrentContext, type Context } from "./kit.js";
import { Abort, CliError } from "./errors.js";
import { canPrompt } from "./interaction.js";
import { confirm, prompt, select, type SelectOptions } from "./prompts.js";
import { getOutput } from "./output.js";
import { cliProvider, cliOptions } from "../providers/selection.js";
import { getProvider, resolveProviderId } from "../providers/registry.js";
import { collectSources, loadLayeredConfig, paths, resetLayeredConfig, type LayeredConfig } from "../transport/config_layers.js";
import { resetConfig } from "../transport/config.js";
import { getOperationConfig, withOperationConfig } from "../utils/operation_config.js";
import { assertConfigFilesReadable, assertConfigValuesValid } from "../utils/config_diagnostics.js";
import { CORE_KEYS, GENERIC_ENDPOINT_KEYS, getKey, type ConfigKey } from "../utils/config_keys.js";
import { validateConfigValue, authenticationChoices } from "../utils/config_resolver.js";
import { bundledConfig } from "../utils/bundled_config.js";
import { configurationTargetSummary } from "./config_target.js";
import { configurationFieldHelp } from "./configuration_help.js";
import { providerCliExtension, isProviderConfigSensitive } from "./provider_extensions.js";

export interface GuidanceField {
  key: string;
  label?: string;
  secret?: boolean;
  env?: string;
  /** Custom operation inputs without a config key may only be used for this operation. */
  persist?: boolean;
  flag?: string;
  /** Optional generation for a local secret; the value is never displayed. */
  generate?: () => string;
  /** Validate custom inputs using the same domain rule as their consumer. */
  validate?: (value: string) => boolean;
}

export interface ConfigurationRequest {
  ci?: boolean;
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
  ask: (label: string, secret: boolean, selection?: SelectOptions<string>): Promise<string> => selection ? select(label, selection) : prompt(label, {
    default: "", show_default: false, hide_input: secret, err: true,
  }) as Promise<string>,
  confirm: (message: string): Promise<boolean> => confirm(message, { default: false, err: true }),
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
  action: (values: Readonly<Record<string, unknown>>) => Promise<T>,
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
    if (cfg._ALLOWED_KEYS.has(key)) return cfg._effectiveValue(key)[0];
    const env = fields.get(key)?.env;
    return env ? process.env[env] : undefined;
  };
  for (const [key, value] of Object.entries(request.values ?? {})) {
    const name = canonical(key);
    if (has(value) && !has(configValue(config, name))) values[name] = value;
  }
  const runtimeAuth = providerCliExtension(provider.id)?.configuration?.runtimeAuthentication;
  const needsRuntimeAuth = Boolean(runtimeAuth && fields.has(runtimeAuth.key));
  if (runtimeAuth && needsRuntimeAuth && !has(effective(runtimeAuth.key))) {
    let group = runtimeAuth.alternatives.find(candidate => candidate.every(key => has(effective(key))));
    if (!group) {
      // A partially entered AccessKey pair is completed instead of asking for an unrelated API key.
      group = runtimeAuth.alternatives.find(candidate => candidate.some(key => has(effective(key))));
      if (!group) {
        if (!guidanceSeams.interactive(ctx, request.yes)) {
          getOutput(ctx).debug(runtimeAuth.help);
          const help = configurationFieldHelp(runtimeAuth.key, provider.id);
          throw new CliError(`Missing configuration for ${request.operation}. Configure one authentication method: ${runtimeAuth.alternatives.map(candidate => candidate.join(" + ")).join("; or ")}. Run 'abx config set providers.${provider.id}.${runtimeAuth.key}' in a terminal, or configure the alternative credentials. ${help ? `${help} ` : ""}No cloud operation was submitted.`);
        }
        const answer = await guidanceSeams.ask("Choose an authentication method", false, {
          choices: [...runtimeAuth.alternatives.map((candidate, index) => ({ name: candidate.join(" + "), value: String(index + 1) })), { name: "Cancel", value: "" }], default: "1", err: true,
        });
        const index = Number(answer || "1") - 1;
        group = runtimeAuth.alternatives[index];
        if (!answer || !group) throw new Abort();
      }
    }
    if (!group.includes(runtimeAuth.key)) fields.delete(runtimeAuth.key);
    for (const key of group) fields.set(key, { key });
  }
  // Provider-owned required fields and alternative authentication are independent of Express's build plan.
  if (request.validateProvider !== false) {
    for (const field of provider.configFields) if (field.required) fields.set(field.key, { key: field.key, label: field.description, secret: field.secret });
    const have = (key: string): boolean => has(effective(key)) && (!GENERIC_ENDPOINT_KEYS.includes(key) || provider.inherit.has(key));
    if (provider.authAnyOf.length && !provider.authAnyOf.some((group) => group.every(have))) {
      const { possible: groups } = authenticationChoices(provider.authAnyOf, new Set([...keys.keys(), ...provider.inherit]), have);
      if (!groups.length) throw new CliError(`Provider '${provider.id}' declares no usable authentication configuration. Run 'abx provider info ${provider.id}'.`);
      let group = groups[0]!;
      if (groups.length > 1 && guidanceSeams.interactive(ctx, request.yes)) {
        for (;;) {
          const selected = await guidanceSeams.ask("Choose an authentication method", false, {
            choices: [...groups.map((g, i) => ({ name: g.join(" + "), value: String(i + 1) })), { name: "Cancel", value: "" }], default: "", err: true,
          });
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
    else if (field.validate && !field.validate(String(effective(name)))) throw new CliError(`Invalid configuration for '${name}'; correct its value before continuing.`);
    else values[name] = effective(name);
  }
  const snapshot = (): Record<string, unknown> => ({ ...config, ...getOperationConfig(), ...values, ...overrides,
    provider_options: { ...config.provider_options, ...((overrides["provider_options"] as Record<string, unknown> | undefined) ?? {}),
      ...Object.fromEntries(Object.entries(values).filter(([name]) => keys.has(name) && !bundledConfig(provider.id)?.transportFields.has(name))) },
  });
  const execute = async (): Promise<T> => {
    if (request.validateProvider !== false) provider.validateConfig(loadLayeredConfig({ provider: provider.id }));
    if (runtimeAuth && needsRuntimeAuth && !has(effective(runtimeAuth.key))) values[runtimeAuth.key] = await runtimeAuth.resolve(loadLayeredConfig({ provider: provider.id }), {
      ci: request.ci === true || (ctx ?? getCurrentContext(true))?.obj?.["ci_explicit"] === true,
      confirm: message => guidanceSeams.interactive(ctx, request.yes) ? guidanceSeams.confirm(message) : Promise.resolve(false),
    });
    return withOperationConfig(snapshot(), () => action(Object.freeze({ ...values })));
  };
  if (!missing.length) return withOperationConfig(snapshot(), execute);
  const repairKey = (key: string): string => keys.has(key) || GENERIC_ENDPOINT_KEYS.includes(key) && provider.inherit.has(key)
    ? `providers.${provider.id}.${key}` : key;
  const persistable = (field: GuidanceField): boolean => field.persist !== false && (keys.has(field.key) || Boolean(getKey(field.key)) || cfg._ALLOWED_KEYS.has(field.key));
  const repair = (field: GuidanceField): string => persistable(field) ? `abx config set ${repairKey(field.key)}${field.env ? ` (or set ${field.env})` : ""}`
    : field.flag ? `supply ${field.flag}` : field.env ? `set ${field.env}` : "supply this operation's documented option";
  const details = missing.map((f) => `  - ${f.key}: ${repair(f)}`).join("\n");
  const fieldHelp = missing.map(field => configurationFieldHelp(field.key, provider.id)).filter((help): help is string => Boolean(help));
  const out = getOutput(ctx);
  if (!guidanceSeams.interactive(ctx, request.yes)) {
    throw new CliError(`Missing configuration for ${request.operation}:\n${details}\n` +
      (fieldHelp.length ? `${fieldHelp.join("\n")}\n` : "") +
      (request.yes ? "--yes/-y skips configuration prompts. To enter missing values interactively, rerun this command without --yes/-y in a terminal.\n" : "") +
      "Run the configuration commands in a terminal, or supply the documented environment variables in automation. No cloud operation was submitted.");
  }
  const target = configurationTargetSummary(provider.id, overrides);
  out.info(target.split("\n").map(line => line.replace(/ \([^)]*\)$/, "")).join(" · "));
  out.debug(target);
  const registry = effective("acr_registry");
  if (typeof registry === "string" && registry) out.info(`Registry host: ${safeHost(registry.includes("://") ? registry : `https://${registry}`)}`);
  out.debug(`${request.operation} needs ${missing.length} configuration value(s):\n${details}`);
  for (const help of fieldHelp) out.info(help);
  if (runtimeAuth && needsRuntimeAuth) out.debug(runtimeAuth.help);
  for (const field of missing) {
    const metadata = keys.get(field.key) ?? getKey(field.key);
    const secret = isProviderConfigSensitive(provider.id, field.key, field.secret ?? metadata?.secret ?? /(?:secret|password|token|api_key)$/.test(field.key));
    for (;;) {
      const answer = await guidanceSeams.ask(`${field.label ?? field.key}${secret ? " (input hidden)" : ""}; ${field.generate && persistable(field) ? "Enter generates a token" : "Enter cancels"}`, secret);
      if (!answer.trim() && (!field.generate || !persistable(field))) throw new Abort();
      let value: unknown = answer.trim() || field.generate!();
      if (field.validate && !field.validate(String(value))) {
        out.warning(`Invalid value for '${field.key}'; enter a nonempty value without line breaks.`);
        continue;
      }
      if (metadata) {
        value = validateConfigValue(metadata, value);
        if (value === null) {
          out.warning(`Invalid value for '${field.key}'; expected ${metadata.type}${metadata.choices.length ? ` (${metadata.choices.join(", ")})` : ""}.`);
          continue;
        }
      }
      values[field.key] = value;
      break;
    }
  }
  if (missing.some(persistable)) {
    const saved: string[] = [];
    for (const field of missing) {
      if (!persistable(field)) continue;
      try {
        const scoped = keys.has(field.key) || GENERIC_ENDPOINT_KEYS.includes(field.key) && provider.inherit.has(field.key);
        const location = cfg.saveGuidedValue(field.key, String(values[field.key]), scoped ? provider.id : undefined);
        saved.push(field.key);
        out.debug(`Saved ${field.key} in ${location.path}. Change it later: abx config set ${repairKey(field.key)} (value hidden when sensitive).`);
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
    out.info("Configuration saved.");
  }
  return withOperationConfig(snapshot(), execute);
}

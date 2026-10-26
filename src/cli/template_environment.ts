/** CLI-only runtime setup. SDK and protocol consumers remain noninteractive. */
import { randomBytes } from "node:crypto";
import type { Context } from "./kit.js";
import { withGuidedConfiguration } from "./config_guidance.js";
import { _effectiveValue } from "./commands/config_cmd.js";
import { resolveTemplateEnvironment } from "../template/environment.js";
import { CLI_CORE_KEYS } from "../utils/cli_config_keys.js";

/** Read the CLI application credential through its normal env/dotenv/user configuration. */
export function applicationToken(): string | undefined {
  const value = _effectiveValue("server_token")[0];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Fill declared application authentication and pass the resolved environment explicitly. */
export async function withTemplateEnvironment<T>(
  ctx: Context,
  declarations: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>>,
  yes: boolean,
  action: (environment: Readonly<Record<string, string>>) => Promise<T>,
): Promise<T> {
  // Only declared model inputs may inherit the CLI's saved model profile.
  const runtime = { ...overrides };
  for (const key of CLI_CORE_KEYS.filter(key => key.key.startsWith("llm_"))) {
    if (!Object.hasOwn(declarations, key.env) || declarations[key.env] || Object.hasOwn(runtime, key.env) || process.env[key.env]) continue;
    const [value, source] = _effectiveValue(key.key);
    if (source !== "default" && source !== "unset" && typeof value === "string" && value) runtime[key.env] = value;
  }
  overrides = runtime;
  if (!Object.hasOwn(declarations, "ABX_SERVER_TOKEN")) return action(resolveTemplateEnvironment(declarations, overrides));
  const explicit = overrides["ABX_SERVER_TOKEN"];
  // An explicit invalid override must not silently fall back to a stored token.
  if (explicit !== undefined) resolveTemplateEnvironment(declarations, { ...overrides, ABX_SERVER_TOKEN: explicit });
  return withGuidedConfiguration(ctx, {
    operation: "Configure template application", yes, validateProvider: false,
    requirements: [{ key: "server_token", label: "Application access token", env: "ABX_SERVER_TOKEN",
      secret: true, generate: () => randomBytes(32).toString("hex"), validate: value => Boolean(value.trim()) && !/[\r\n]/.test(value) }],
    values: { server_token: explicit },
    overrides: explicit === undefined ? {} : { server_token: explicit },
  }, async values => action(Object.freeze(resolveTemplateEnvironment(declarations, { ...overrides, ABX_SERVER_TOKEN: String(values["server_token"]) }))));
}

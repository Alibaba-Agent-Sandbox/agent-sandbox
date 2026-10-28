/** CLI-only runtime setup. SDK and protocol consumers remain noninteractive. */
import { randomBytes } from "node:crypto";
import type { Context } from "./kit.js";
import { getOutput } from "./output.js";
import { CliError } from "./errors.js";
import { _effectiveValue, saveGuidedValue } from "./commands/config_cmd.js";
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
  _yes: boolean,
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
  const configured = explicit ?? process.env["ABX_SERVER_TOKEN"] ?? _effectiveValue("server_token")[0];
  // Validate supplied credentials rather than replacing an invalid value with a new secret.
  if (configured !== undefined && configured !== null) {
    return action(Object.freeze(resolveTemplateEnvironment(declarations, { ...overrides, ABX_SERVER_TOKEN: String(configured) })));
  }
  if (explicit !== undefined) return action(resolveTemplateEnvironment(declarations, overrides));
  const generated = randomBytes(32).toString("hex");
  try {
    saveGuidedValue("server_token", generated);
    if (applicationToken() !== generated) throw new Error("Saved credential is overridden");
  } catch {
    throw new CliError("Could not save application authentication. No template preparation or sandbox creation was started. " +
      "Make the CLI user configuration writable, or supply your own ABX_SERVER_TOKEN through the environment or -e. " +
      "This is a private application token you choose, separate from your Sandbox API key; no cloud-console credential is needed.");
  }
  getOutput(ctx).info("Application authentication configured automatically and saved securely on this machine; later CLI commands reuse it. " +
    "Your platform API key keeps its selected configuration scope.");
  return action(Object.freeze(resolveTemplateEnvironment(declarations, { ...overrides, ABX_SERVER_TOKEN: generated })));
}

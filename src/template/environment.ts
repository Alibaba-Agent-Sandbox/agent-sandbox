import { ProviderConfigError } from "../models/provider_errors.js";

/** Resolve declared runtime defaults; application credentials come only from explicit runtime input. */
export function resolveTemplateEnvironment(
  declarations: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const environment = { ...Object.fromEntries(Object.entries(declarations).map(([key, value]) => [key, value || process.env[key] || ""])), ...overrides };
  if (Object.hasOwn(declarations, "ABX_SERVER_TOKEN")) {
    const token = overrides["ABX_SERVER_TOKEN"] ?? process.env["ABX_SERVER_TOKEN"];
    if (!token?.trim() || /[\r\n]/.test(token)) {
      throw new ProviderConfigError("Template services require ABX_SERVER_TOKEN before preparing or creating resources.");
    }
    environment["ABX_SERVER_TOKEN"] = token;
  }
  return environment;
}

/**
 * Template commands run on the active provider (`--provider`, `ABX_PROVIDER`, the configured default). A provider that
 * does not declare template support answers `E8004` before any registry, Docker or ACR work starts.
 */

import { getProvider, resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import { ProviderFeatureNotSupportedError } from "../providers/errors.js";
import { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";

/** `templates.read` for list/info; `templates.build` for build, push, create, deploy, install and delete. */
export type TemplateFeature = "templates.read" | "templates.build";

export function requireTemplateFeature(feature: TemplateFeature): void {
  const provider = getProvider(resolveProviderId(cliProvider()));
  provider.require(feature);
  // These legacy commands still execute the FC template implementation. A manifest
  // feature flag is not an adapter and must never route a plugin into FC credentials.
  const legacyFcCommand = feature === "templates.read" || feature === "templates.build";
  if (legacyFcCommand && provider.id !== BUILTIN_PROVIDER_ID) {
    throw new ProviderFeatureNotSupportedError(provider.id, feature, {
      suggestion: `The template CLI has no registered template adapter for '${provider.id}'. Use its documented template/image workflow or declared provider commands.`,
    });
  }
}

/**
 * Template commands run on the active provider (`--provider`, `ABX_PROVIDER`, the configured default). A provider that
 * does not declare template support answers `E8004` before any registry, Docker or ACR work starts.
 */

import { getProvider, resolveProviderId } from "../providers/registry.js";
import { ProviderFeatureNotSupportedError } from "../providers/errors.js";
import { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";
import { cliProvider } from "../providers/selection.js";

/** `templates.read` for list/info; `templates.build` for build, push, create, deploy, install and delete. */
export type TemplateFeature = "templates.read" | "templates.build";

export function requireTemplateFeature(feature: TemplateFeature): void {
  const provider = getProvider(resolveProviderId(cliProvider()));
  provider.require(feature);
  // These handlers own the FC/ACR pipeline. A feature flag is not a backend adapter.
  if (provider.id !== BUILTIN_PROVIDER_ID) {
    throw new ProviderFeatureNotSupportedError(provider.id, feature, {
      message: `This template command has no adapter for provider '${provider.id}'; refusing the Alibaba Express pipeline.`,
    });
  }
}

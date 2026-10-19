/** Feature discovery is generic; operation factories are selected by the template router. */
import { getProvider, resolveProviderId } from "../providers/registry.js";
import { ProviderFeatureNotSupportedError } from "../providers/errors.js";
import { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";
import { cliProvider } from "../providers/selection.js";
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

/** Guard belongs to the FC adapter, never to a generic template router. */
import { getProvider, resolveProviderId } from "../../registry.js";
import { cliProvider } from "../../selection.js";
import { ProviderFeatureNotSupportedError } from "../../errors.js";
import { CONFIG_METADATA } from "../metadata.js";
export function requireTemplateFeature(feature: string): void {
  const provider = getProvider(resolveProviderId(cliProvider()));
  if (provider.id !== CONFIG_METADATA.id) throw new ProviderFeatureNotSupportedError(provider.id, feature);
  provider.require(feature);
}

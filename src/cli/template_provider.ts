/** Feature discovery is generic; operation factories are selected by the template router. */
import { getProvider, resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
export type TemplateFeature = "templates.read" | "templates.build";
export function requireTemplateFeature(feature: TemplateFeature): void {
  getProvider(resolveProviderId(cliProvider())).require(feature);
}

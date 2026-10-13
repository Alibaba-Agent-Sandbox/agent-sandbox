/**
 * Template commands run on the active provider (`--provider`, `ABX_PROVIDER`, the configured default). A provider that
 * does not declare template support answers `E8004` before any registry, Docker or ACR work starts.
 */

import { getProvider, resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";

/** `templates.read` for list/info; `templates.build` for build, push, create, deploy, install and delete. */
export type TemplateFeature = "templates.read" | "templates.build";

export function requireTemplateFeature(feature: TemplateFeature): void {
  getProvider(resolveProviderId(cliProvider())).require(feature);
}

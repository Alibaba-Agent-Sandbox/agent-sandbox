/** Common region flag. Only providers declaring a region field accept it; derivation/defaults are adapter metadata. */
import { type Option, option } from "./kit.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import { defaultRegion } from "../providers/bundled_config.js";

/** Fallback region when nothing is configured. */
export const DEFAULT_REGION = defaultRegion();

export const _REGION_HELP = "Region override for providers that declare region (otherwise use the provider default)";

/**
 * The shared command-level `--region/-r` option. Add it to a command's `params`:
 * `command("x", { params: [regionOption(), ...] })`. The callback receives `params.region` (`null` when the user did
 * not pass the flag, which then falls back to the configured/persisted region).
 */
export function regionOption(): Option {
  return option(["--region", "-r", "region"], { default: null, metavar: "TEXT", help: _REGION_HELP });
}

/**
 * Return the effective region for a command invocation.
 *
 * Priority: explicit flag, then the selected provider's resolved configuration.
 */
export function resolveRegion(cliRegion: string | null): string {
  const region = cliRegion?.trim();
  return loadLayeredConfig({ provider: resolveProviderId(cliProvider()), provider_options: region ? { region } : {} }).region;
}

/** Sanitized target context shown before collecting credentials. */
import { explainConfig, loadLayeredConfig } from "../transport/config_layers.js";

/** Describe the effective destination without URL userinfo, query strings or credential values. */
export function configurationTargetSummary(providerId: string): string {
  const config = loadLayeredConfig({ provider: providerId });
  const explanation = explainConfig({ provider: providerId });
  let host = "(not configured)";
  try { host = new URL(config.sandbox_base_url).host; } catch { /* no raw URL in diagnostics */ }
  return `Provider: ${providerId}\nRegion: ${config.region || "(not configured)"} (${explanation["region"]?.source ?? "provider default"})\nAPI host: ${host} (${explanation["sandbox_base_url"]?.source ?? "provider default"})`;
}

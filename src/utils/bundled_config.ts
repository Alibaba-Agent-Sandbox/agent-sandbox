/** Distribution composition: register bundled metadata without loading cloud implementations. */
import { CONFIG_METADATA } from "./bundled_metadata.js";
import type { ConfigKey } from "./config_keys.js";
export interface BundledConfig {
  templateProfile?: import("../providers/template_profile.js").ProfileFields;
  id: string; keys: readonly ConfigKey[]; inherit: ReadonlySet<string>;
  derive: Readonly<Record<string, string>>; endpointDefaults: Readonly<Record<string, string>>;
  legacyFields: ReadonlySet<string>; omitDefaultOptions: boolean;
  legacyEnvironment: [string, string, boolean][];
}
export const bundledConfigs: readonly BundledConfig[] = [CONFIG_METADATA];
export const defaultConfig = CONFIG_METADATA;
export function bundledConfig(id: string): BundledConfig | undefined { return bundledConfigs.find((schema) => schema.id === id); }
export const bundledKeys = bundledConfigs.flatMap((schema) => [...schema.keys]);
export function defaultRegion(): string { return String(defaultConfig.keys.find((key) => key.key === "region")?.default ?? ""); }

/** Legacy URL helpers consume explicit distribution metadata without adapter discovery. */
export const legacyDataPlanePort = 49983;
export function legacyDataPlaneUrl(sandboxId: string, domain: string): string {
  return `https://${legacyDataPlanePort}-${sandboxId}.${domain}`;
}

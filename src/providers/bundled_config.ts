/** Distribution composition: register bundled metadata without loading cloud implementations. */
import { CONFIG_METADATA } from "./alicloud_express/metadata.js";
// Historical TransportConfig URL helpers delegate through distribution composition.
export { ENVD_PORT as legacyDataPlanePort, envdUrl as legacyDataPlaneUrl } from "./shared/e2b/url.js";
export { legacyPortAccess } from "./shared/e2b/ports.js";
import type { ConfigKey } from "../utils/config_keys.js";
export interface BundledConfig {
  templateProfile?: import("./template_profile.js").ProfileFields;
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

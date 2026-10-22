/** Distribution composition: register bundled metadata without loading cloud implementations. */
// This pure metadata module has only L0 data dependencies; it loads no provider runtime.
import { CONFIG_METADATA } from "../providers/alicloud_express/metadata.js";
import type { ConfigKey } from "./config_keys.js";
export interface BundledConfig {
  templateProfile?: import("../models/template_profile.js").ProfileFields;
  id: string; keys: readonly ConfigKey[]; inherit: ReadonlySet<string>;
  derive: Readonly<Record<string, string>>; endpointDefaults: Readonly<Record<string, string>>;
  transportFields: ReadonlySet<string>; omitDefaultOptions: boolean;
  transportEnvironment: [string, string, boolean][];
}
export const bundledConfigs: readonly BundledConfig[] = [CONFIG_METADATA];
export const defaultConfig = CONFIG_METADATA;
export function bundledConfig(id: string): BundledConfig | undefined { return bundledConfigs.find((schema) => schema.id === id); }
export const bundledKeys = bundledConfigs.flatMap((schema) => [...schema.keys]);
export function defaultRegion(): string { return String(defaultConfig.keys.find((key) => key.key === "region")?.default ?? ""); }

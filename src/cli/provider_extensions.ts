import type { ProviderConfigUi } from "./provider_config_contract.js";
/** CLI composition root: select provider-owned UI metadata; generic commands contain no backend implementation. */
import type { Context, Command, Param } from "./kit.js";
import { CLI_EXTENSION } from "../providers/alicloud_express/cli/extension.js";
import { resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
export interface ProviderCliExtension {
  id: string;
  configuration?: ProviderConfigUi;
  templateUi: Record<string, { params: readonly Param[]; help: string }>;
  createParams?: readonly Param[];
  deployHelp?: string;
  loadTemplates(): Promise<Record<string, unknown>>;
  loadDeploy?(): Promise<{ deploy_shortcut: Command }>;
  deployGenerated?(directory: string, options: Record<string, unknown>, ctx: Context): Promise<Record<string, unknown>>;
}
const extensions = new Map<string, ProviderCliExtension>([[CLI_EXTENSION.id, CLI_EXTENSION]]);
export function registerProviderCliExtension(extension: ProviderCliExtension): void { extensions.set(extension.id, extension); }
export function providerCliExtension(id = resolveProviderId(cliProvider())): ProviderCliExtension | undefined { return extensions.get(id); }

export function bundledCliConfigurations(): readonly ProviderConfigUi[] { return [...extensions.values()].flatMap((extension) => extension.configuration ? [extension.configuration] : []); }

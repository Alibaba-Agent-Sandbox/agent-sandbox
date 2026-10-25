import type { PreparedTemplate, ProjectTemplateOptions } from "../providers/template_contract.js";
import type { ProviderConfigUi } from "./provider_config_contract.js";
/** CLI composition root: select provider-owned UI metadata; generic commands contain no backend implementation. */
import type { Context, Command, Param } from "./kit.js";
import { CLI_EXTENSION } from "../providers/alicloud_express/cli/extension.js";
import { resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import type { StagedProject } from "../providers/shared/project.js";
export interface ProviderCliExtension {
  /** Snapshot provider-native source inputs before any resource mutation. */
  stageProject?(directory: string, options: ProjectTemplateOptions): Promise<StagedProject>;
  id: string;
  prepareProject?(directory: string, options: ProjectTemplateOptions, ctx: Context): Promise<PreparedTemplate>;
  configuration?: ProviderConfigUi;
  templateUi: Record<string, { params: readonly Param[]; help: string }>;
  createParams?: readonly Param[];
  deployHelp?: string;
  /** Concrete provider-owned base for explicit generated platform steps; Docker defaults stay unchanged. */
  generationBaseImage?(options: Record<string, unknown>): string | undefined;
  /** Provider-owned authentication requirements for its management catalog, not a host backend switch. */
  managementRequirements?(commandId: string): readonly string[];
  loadTemplates(): Promise<Record<string, unknown>>;
  loadDeploy?(): Promise<{ deploy_shortcut: Command }>;
}
const extensions = new Map<string, ProviderCliExtension>([[CLI_EXTENSION.id, CLI_EXTENSION]]);
export function registerProviderCliExtension(extension: ProviderCliExtension): void { extensions.set(extension.id, extension); }
export function providerCliExtension(id = resolveProviderId(cliProvider())): ProviderCliExtension | undefined { return extensions.get(id); }

export function bundledCliConfigurations(): readonly ProviderConfigUi[] { return [...extensions.values()].flatMap((extension) => extension.configuration ? [extension.configuration] : []); }

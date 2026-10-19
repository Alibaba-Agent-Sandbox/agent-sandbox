/**
 * Sandbox providers (backends): contract, registry, built-in provider and plugin management.
 *
 * The default provider is `alicloud-express` (Alibaba Cloud Express Edition, 阿里云极速版). Third-party providers are
 * installed from a directory or git URL and selected with `--provider`, `ABX_PROVIDER` or `[core] provider`.
 */

export { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";
export { FEATURES, Provider, configFieldToKey, type ConfigField, type ProviderFeature, type ProviderInfra, type SessionProtocols, type TerminalContext, type LegacyInfraOptions } from "./base.js";
export { AlicloudExpressProvider } from "./alicloud_express/index.js";
export { listProviderCommands, getProviderCommand, runProviderCommand, type ProviderCommand, type ProviderCommandOptions } from "./commands.js";
export { doctor, verifyHandshake, type DoctorReport } from "./doctor.js";
export * from "./errors.js";
export { ExecProvider } from "./exec_provider.js";
export { install, uninstall, update, InstallPlan } from "./installer.js";
export { loadManifest, parseManifest, type Manifest } from "./manifest.js";
export {
  ambientProviderId,
  builtinProvider,
  getProvider,
  listProviders,
  parseSandboxRef,
  qualify,
  registerProvider,
  resolveProviderId,
  unregisterProvider,
} from "./registry.js";
export { RestProvider } from "./rest_provider.js";
export {
  alicloudExpressProfile,
  dockerfileCmdLine,
  genericProfile,
  parseTemplateTable,
  profileForProvider,
  resolveTemplateProfile,
  type ServerStart,
  type TemplateProfile,
} from "./template_profile.js";
export { defineProviderContractTests, runContractSuite, parseOptions as parseProviderOptions } from "./testing.js";

export type { ProviderTemplateManager, TemplateBuildOptions, TemplateBuildRequest } from "./template_contract.js";

export type { ProviderImageRequest, ProviderImageResult, ProviderTemplates } from "./base.js";

export type { PreparedTemplate, ProjectTemplateOptions } from "./template_contract.js";

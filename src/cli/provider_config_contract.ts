/** UI metadata for optional provider configuration workflows. Values and prompts are backend-owned data. */
export interface ConfigPrompt {
  key: string; env?: string; prompt: string; hidden?: boolean;
  current?: boolean; default?: string; result: "stored" | "set";
}
export interface ProviderConfigUi {
  allowed: readonly (readonly [string, string])[];
  envStored: readonly (readonly [string, string])[];
  envOverrides: readonly (readonly [string, readonly string[]])[];
  groups: readonly (readonly [string, readonly string[]])[];
  sensitive: readonly string[];
  extraGroups: readonly (readonly [string, readonly string[]])[];
  initFields: readonly ConfigPrompt[];
  buildFields: readonly ConfigPrompt[];
  noninteractiveInit: readonly string[];
  noninteractiveBuild: readonly string[];
  environment: readonly string[];
  buildEnvironment: readonly string[];
  help: Record<string, string>;
}

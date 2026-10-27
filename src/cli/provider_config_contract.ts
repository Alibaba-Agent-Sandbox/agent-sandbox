/** UI metadata for optional provider configuration workflows. Values and prompts are backend-owned data. */
export interface ConfigPrompt {
  key: string; env?: string; prompt: string; hidden?: boolean;
  current?: boolean; default?: string; result: "stored" | "set";
}
export interface ProviderConfigUi {
  fieldHelp?: Readonly<Record<string, string>>;
  /** Alternatives and preparation are owned by the provider, not hardcoded by host guidance. */
  runtimeAuthentication?: {
    key: string;
    alternatives: readonly (readonly string[])[];
    help: string;
    resolve(config: import("../transport/config_layers.js").LayeredConfig, options: { ci: boolean; confirm(message: string): Promise<boolean> }): Promise<string>;
  };
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

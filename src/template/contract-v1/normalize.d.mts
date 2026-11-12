/** Publicly usable pure contract interfaces; no runtime credentials or cloud effects. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
export type ValidationStage = 'intent' | 'resolved';
export type SchemaValidator = ((value: unknown) => unknown) & {
  errors?: Array<{instancePath?: string; keyword?: string}> | null;
};
export type ProviderValidator = (stage: 'template.prepare' | 'sandbox.create', value: Record<string, unknown>, provider: string) => unknown;
export interface ContractOptions {
  stage?: ValidationStage;
  contract?: Record<string, unknown>;
  /** Already selected context; conflicts with an explicit declaration are rejected. */
  provider?: string;
  /** Required for resolved third-party plugins; must consume their actual stage schemas. */
  validateProvider?: ProviderValidator;
}
export interface SourceRecipe {
  dockerfile?: string;
  context?: '.';
}
export interface TemplateInputV1 {
  source?: SourceRecipe & {profiles?: Record<string, SourceRecipe>};
  image?: string;
  reference?: string;
  aliases?: string[];
  props?: Record<string, JsonValue>;
}
export interface ServiceV1 {
  protocol: string;
  version: number;
  port: number;
  operations?: string[];
}
export interface SandboxV1 {
  provider?: string;
  template: TemplateInputV1;
  instance?: Record<string, JsonValue>;
  start?: string;
  ready?: string;
  services?: Record<string, ServiceV1>;
  /** Additional access ports; no protocol, readiness or public-Gateway promise. */
  ports?: number[];
}
export interface DevsResourceV1 {
  component: string;
  props: Record<string, JsonValue> | string;
  actions?: JsonValue;
}
export interface DevsProjectV1 {
  edition: '3.0.0';
  name?: string;
  access?: string;
  vars?: Record<string, JsonValue>;
  resources: Record<string, DevsResourceV1>;
  flow?: Record<string, JsonValue>;
  actions?: JsonValue;
  template?: Record<string, JsonValue>;
  validation?: boolean;
}
export interface AgentsApplicationV1 {
  type: 'agents-api';
  roles: {gateway: string; worker: string; dispatcher: string};
  server: {source?: SourceRecipe; image?: string};
  state: {databaseUrl: string; vpcConfig?: Record<string, JsonValue>; databaseCa?: string};
  bindings: Record<string, JsonValue>;
  sessions?: Record<string, number | string>;
  limits?: Record<string, number | string>;
  storage?: Record<string, number | string>;
  hooks?: Record<string, JsonValue>;
}
export interface TemplateV1 {
  specVersion: 1;
  name: string;
  sandbox?: SandboxV1;
  deployment?: DevsProjectV1;
  application?: AgentsApplicationV1;
}
export interface CompiledTemplateV1 {
  name: string;
  kind: 'sandbox' | 'serving' | 'application';
  provider?: string;
  sandbox?: SandboxV1;
  deployment?: DevsProjectV1;
  resources?: Record<string, JsonValue>;
  env?: Record<string, string>;
  provides?: Record<string, ServiceV1>;
  ports?: number[];
  start_cmd?: string | null;
  ready_cmd?: string | null;
  template_id?: string;
  image?: string;
  aliases?: string[];
  build_profiles?: Record<string, SourceRecipe>;
  application?: Record<string, unknown>;
  /** Private resolved credentials: never persist in a public plan, receipt or image. */
  bindingValues?: Record<string, unknown>;
  roleResources?: {gateway: string; worker: string; dispatcher: string};
  /** These can contain secrets; persistence must use the original intent instead. */
  roleProps?: Record<string, Record<string, JsonValue>>;
}
export function schemaForStage(schema: Record<string, unknown>, stage?: ValidationStage): Record<string, unknown>;
export function normalizeTemplateV1(manifest: unknown, validate: SchemaValidator, options?: ContractOptions): TemplateV1;
export function compileTemplateV1(manifest: unknown, validate: SchemaValidator, options?: ContractOptions): CompiledTemplateV1;
export function pointerValue(document: unknown, pointer: string): JsonValue;
export function normalizeRegistryV1(metadata: unknown, template: unknown, validateRegistry: SchemaValidator, validateTemplate: SchemaValidator, options?: {contract?: Record<string, unknown>}): Record<string, JsonValue>;

/** Pure source reader. Unknown tags, aliases, non-string keys and unsafe numbers fail. */
export const MAX_YAML_BYTES: 1048576;
export function parseYamlV1(source: string | Uint8Array): JsonValue;

/** Pure resource admission; no credential lookup, cloud effects or expression evaluation. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
export type ValidationStage = 'intent' | 'resolved';
export type SchemaValidator = ((value: unknown) => unknown) & {errors?: Array<{instancePath?: string; keyword?: string}> | null};
export type ProviderValidator = (stage: 'template.prepare' | 'volume.create', value: Record<string, unknown>, provider: string) => unknown;
export interface ContractOptions {stage?: ValidationStage; contract?: Record<string, unknown>; provider?: string; validateProvider?: ProviderValidator}
export interface BuildStep {type: 'USER' | 'WORKDIR' | 'ENV' | 'RUN'; args: string[]}
export type BuildConfig = {dockerfile: string; context?: string; steps?: never} | {steps: BuildStep[]; dockerfile?: never; context?: never};
export interface TemplateInputV1 {reference?: string; region?: string; image?: string; buildConfig?: BuildConfig; [key: string]: unknown}
export type ResourceAction = {run: string; path?: string; component?: never} | {component: string; path?: string; run?: never};
export type ResourceActions = Partial<Record<'pre-deploy' | 'success-deploy' | 'fail-deploy' | 'complete-deploy', ResourceAction[]>>;
export interface VolumeV1 {reference?: string; retain?: boolean; props?: Record<string, JsonValue>}
export interface SandboxV1 {provider: string; template: TemplateInputV1; actions?: ResourceActions; volumes?: Record<string, VolumeV1>}
export interface DevsResourceV1 {component: string; props: Record<string, JsonValue>; actions?: ResourceActions}
export interface TemplateV1 {specVersion: 1; name: string; vars?: Record<string, JsonValue>; sandbox?: Record<string, SandboxV1>; serving?: Record<string, DevsResourceV1>}
export interface CompiledTemplateV1 extends Omit<TemplateV1, 'specVersion'> {kind: 'sandbox' | 'serving' | 'application'}
export function schemaForStage(schema: Record<string, unknown>, stage?: ValidationStage): Record<string, unknown>;
export function normalizeTemplateV1(manifest: unknown, validate: SchemaValidator, options?: ContractOptions): TemplateV1;
export function compileTemplateV1(manifest: unknown, validate: SchemaValidator, options?: ContractOptions): CompiledTemplateV1;
export function pointerValue(document: unknown, pointer: string): JsonValue;
export function normalizeRegistryV1(metadata: unknown, template: unknown, validateRegistry: SchemaValidator, validateTemplate: SchemaValidator, options?: {contract?: Record<string, unknown>}): Record<string, JsonValue>;
export const MAX_YAML_BYTES: 1048576;
export function parseYamlV1(source: string | Uint8Array): JsonValue;

export interface TemplateService { protocol: string; version: number; port: number; operations: string[] }
export interface TemplateLaunchPlan { supported: boolean; reason?: string; required_operations: string[]; missing_operations: string[]; services: Record<string, TemplateService> }
export interface LaunchProvider { id: string; operation_contract_version: 1; operations: {cli: readonly string[]; python: readonly string[]}; workflow_inputs: readonly string[]; startup_modes: readonly string[] }
export function validateTemplateManifest(manifest: unknown): Record<string, unknown>;
export function planTemplateLaunch(manifest: unknown, provider: LaunchProvider, consumer: string, prepared?: boolean): TemplateLaunchPlan;

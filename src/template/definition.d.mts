import type { ContractOptions, TemplateV1, CompiledTemplateV1 } from './contract-v1/normalize.mjs';
export function normalizeProjectIntent(value: unknown, options?: ContractOptions): TemplateV1;
export function compileResolvedProject(value: unknown, options?: ContractOptions): CompiledTemplateV1;
export function sandboxModelInput(value: unknown, options?: ContractOptions): Record<string, unknown>;
export function normalizeCatalogMetadata(value: unknown): {specVersion: 1; name: string; description: {en: string; zh: string}; tags?: string[]; author?: string; [key: string]: unknown};

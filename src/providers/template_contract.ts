/** Backend-independent template management contract. Factories own credentials, API mapping and polling. */
import type { TemplateInfo } from "../models/template.js";
import type { LayeredConfig } from "../transport/config_layers.js";
export interface TemplateBuildOptions {
  alias?: string | null; timeout?: number; poll_interval?: number;
  cpu_count?: number | null; memory_mb?: number | null;
  start_cmd?: string | null; ready_cmd?: string | null;
}
export interface ProviderTemplateManager {
  create?(image: string, options: Readonly<Record<string, unknown>>): Promise<TemplateInfo>;
  push?(image: string, options: Readonly<Record<string, unknown>>): Promise<unknown>;
  buildProject?(directory: string, options: Readonly<Record<string, unknown>>): Promise<unknown>;
  list?(): Promise<TemplateInfo[]>;
  get?(id: string): Promise<TemplateInfo>;
  delete?(id: string): Promise<void>;
  build?(dockerfile: string, options?: TemplateBuildOptions): Promise<TemplateInfo>;
  close?(): Promise<void>;
}
export interface TemplateBuildRequest {
  config: LayeredConfig; dockerfile: string; options: TemplateBuildOptions;
}

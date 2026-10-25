/** Backend-independent template management contract. Factories own credentials, API mapping and polling. */
import type { ResourceJournalCallbacks } from "../template/resource_journal.js";
import type { TemplateInfo } from "../models/template.js";
import type { LayeredConfig } from "../transport/config_layers.js";
export interface TemplateBuildOptions {
  alias?: string | null; timeout?: number; poll_interval?: number;
  cpu_count?: number | null; memory_mb?: number | null;
  start_cmd?: string | null; ready_cmd?: string | null;
}
/** A ready, provider-owned reference handed directly to sandbox creation. Never contains credentials. */
export interface PreparedTemplate {
  reference: string; status: "ready";
  startup_command?: string; ready_command?: string;
  metadata?: Record<string, string>;
  provider_options?: Record<string, unknown>;
  owned_resources?: Array<{ intent_id: string; kind: "image" | "template"; id: string; cleanup: "manual" | "template.delete"; owned: true }>;
  identity?: { image_digest?: string; native_version?: string };
}
export interface ProjectTemplateOptions {
  alias: string; timeout: number;
  build_profile?: { id: string; dockerfile: string; context: "." };
  journal?: ResourceJournalCallbacks;
  template: { name: string; cpu: number; memory: number; start_cmd: string | null; ready_cmd: string | null };
}
export interface ProviderTemplateManager {
  prepareProject?(directory: string, options: ProjectTemplateOptions): Promise<PreparedTemplate>;
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

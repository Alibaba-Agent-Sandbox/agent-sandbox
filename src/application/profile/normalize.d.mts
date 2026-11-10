export interface ProfileCatalog {
  schema_version: number;
  profiles: Record<string, {
    defaults: Record<string, unknown>;
    bindings: Record<string, Record<string, unknown>>;
  }>;
}
export function applicationProfile(manifest: unknown): unknown;
export function normalizeApplicationProfile<T>(manifest: T, catalog: ProfileCatalog): T;

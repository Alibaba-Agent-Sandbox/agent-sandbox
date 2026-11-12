/** Local names locate existing receipts; they do not create a second cloud authority. */
import fs from "node:fs";
import path from "node:path";
import { ApplicationError, record, writeJson } from "../application/config.js";
import { paths, type LayeredConfig } from "../transport/config_layers.js";
import { Sandbox } from "../api/sandbox.js";
import { cliOptions, cliProvider } from "../providers/selection.js";
import { getProvider, resolveProviderId } from "../providers/registry.js";

export interface Deployment {
  version: 1;
  name: string;
  kind: "sandbox" | "application";
  provider: string;
  providerOptions?: Record<string, unknown>;
  connection?: { api_url?: string; domain?: string };
  status: "preparing" | "ready" | "requires_recovery" | "deleted";
  createdAt: string;
  updatedAt: string;
  source?: string;
  /** Original local configuration source; its private values are never copied into this record. */
  configurationSource?: string;
  sandboxId?: string;
  /** Written before entering resource requests. Absent means unknown for older records. */
  effectsStarted?: boolean;
  launch?: Record<string, unknown>;
  journal?: string;
  receipt?: string;
  build?: string;
  ownsBuild?: boolean;
  borrowedBuild?: string;
  bindings?: string;
  previous?: string;
}
export function validateDeploymentName(name: string): string {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) throw new ApplicationError("Deployment name must start with a lowercase letter and contain at most 63 lowercase letters, digits or hyphens.");
  return name;
}
export function deploymentDirectory(name: string): string { return path.join(paths.abxDir, "deployments", validateDeploymentName(name)); }
export function readDeployment(name: string): Deployment | undefined {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) return undefined;
  const file = path.join(deploymentDirectory(name), "deployment.json");
  if (!fs.existsSync(file)) return undefined;
  const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!record(data) || data.version !== 1 || data.name !== name || !["application", "sandbox"].includes(String(data.kind)) || typeof data.provider !== "string") throw new ApplicationError("Invalid local deployment record; preserve it for recovery.");
  return data as unknown as Deployment;
}
export function saveDeployment(value: Deployment): void {
  value.updatedAt = new Date().toISOString();
  writeJson(path.join(deploymentDirectory(value.name), "deployment.json"), value);
}
export function listDeployments(): Deployment[] {
  const directory = path.join(paths.abxDir, "deployments");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).sort().flatMap(name => {
    const value = readDeployment(name); return value ? [value] : [];
  });
}
/** Explicit provider overrides must not redirect a saved instance to a different backend. */
export function checkDeploymentSelection(value: Deployment): void {
  if (cliProvider() && resolveProviderId(cliProvider()) !== value.provider) throw new ApplicationError("The selected Provider differs from this deployment's Provider.");
  for (const [key, input] of Object.entries(cliOptions())) {
    if (!getProvider(value.provider).configFields.find(field => field.key === key)?.secret && value.providerOptions?.[key] !== input) throw new ApplicationError(`The explicit ${key} override differs from the saved deployment target.`);
  }
}
export function sandboxTarget(reference: string): { id: string; provider?: string; provider_options?: Record<string, unknown>; api_url?: string; domain?: string } {
  const saved = readDeployment(reference);
  if (!saved) return { id: reference };
  checkDeploymentSelection(saved);
  if (saved.kind !== "sandbox") throw new ApplicationError("This deployment is an application. Use its business endpoint; sandbox operations require a Sandbox ID.");
  if (!saved.sandboxId || saved.status === "deleted") throw new ApplicationError("This deployment has no available Sandbox. Inspect its status or recover it.");
  return { id: saved.sandboxId, provider: saved.provider, provider_options: saved.providerOptions, ...saved.connection };
}
export async function connectSandboxTarget(reference: string): Promise<Sandbox> {
  const { id, ...options } = sandboxTarget(reference);
  return Sandbox.connect(id, options);
}

/** Snapshot resolved routing without copying authorization into an operation record. */
export function captureDeploymentTarget(providerId: string, config: LayeredConfig) {
  const provider = getProvider(providerId);
  const providerOptions = Object.fromEntries(provider.configFields.filter(field => !field.secret).flatMap(field => {
    const value = config.provider_options[field.key];
    return value === undefined || value === null ? [] : [[field.key, value]];
  }));
  const connection = {
    ...(provider.inherit.has("sandbox_base_url") ? { api_url: config.sandbox_base_url } : {}),
    ...(provider.inherit.has("sandbox_domain") ? { domain: config.sandbox_domain } : {}),
  };
  return { provider: providerId, providerOptions, connection };
}

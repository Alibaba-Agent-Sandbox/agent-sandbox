/** Optional pushed-image template API, independent of FC/Docker/ACR deployment. */
import { getProvider, resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import { ProviderConfigError, ProviderTemplateHostError } from "../providers/errors.js";
import type { ProviderImageRequest, ProviderImageResult } from "../providers/base.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { _effectiveOptions } from "./sandbox.js";

/** Explicit provider selection and its own credential/configuration namespace. */
export interface ProviderImageOptions {
  provider?: string;
  provider_options?: Record<string, unknown>;
}

/** Validate the shared image-only request before creating any provider resources. */
export function validateProviderImage(input: ProviderImageRequest): void {
  const invalid = (): never => { throw new ProviderConfigError("Invalid image deployment request; see 'abx template from-image --help'."); };
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  if (Object.keys(input).some((key) => !["source", "name", "spec", "registry", "timeout", "signal"].includes(key))) invalid();
  const source = input.source;
  if (!source || typeof source !== "object" || Array.isArray(source) || source.kind !== "image" || Object.keys(source).some((key) => !["kind", "image"].includes(key))) invalid();
  if (typeof source.image !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/.test(source.image) || source.image.includes("://")) invalid();
  if (typeof input.name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(input.name)) invalid();
  if (input.timeout !== undefined && (typeof input.timeout !== "number" || !Number.isFinite(input.timeout) || input.timeout <= 0 || input.timeout > 3600)) invalid();
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) invalid();
  if (input.spec !== undefined) {
    if (!input.spec || typeof input.spec !== "object" || Array.isArray(input.spec)) invalid();
    if (Object.keys(input.spec).some((key) => !["cpu", "memory", "start_cmd", "ready_cmd"].includes(key))) invalid();
    for (const n of [input.spec.cpu, input.spec.memory]) if (n !== undefined && (!Number.isSafeInteger(n) || n <= 0)) invalid();
    for (const s of [input.spec.start_cmd, input.spec.ready_cmd]) if (s !== undefined && (typeof s !== "string" || !s.trim())) invalid();
    if (input.spec.start_cmd !== undefined && input.spec.ready_cmd === undefined) invalid();
  }
  if (input.registry !== undefined) {
    const r = input.registry;
    if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).some((key) => !["username", "password"].includes(key)) ||
      typeof r.username !== "string" || !r.username || typeof r.password !== "string" || !r.password) invalid();
  }
}

/** Convert a pushed OCI image through the selected provider's optional factory; always release local factory resources. */
export async function deployProviderImage(input: ProviderImageRequest, options: ProviderImageOptions = {}): Promise<ProviderImageResult> {
  validateProviderImage(input);
  if (input.signal?.aborted) throw new ProviderConfigError("Provider image deployment was cancelled.");
  const provider = getProvider(resolveProviderId(options.provider ?? cliProvider()));
  provider.require("templates.deploy");
  const config = loadLayeredConfig({ provider: provider.id, provider_options: _effectiveOptions(provider, options.provider_options) ?? {} });
  provider.validateConfig(config);
  let templates;
  let ready: ProviderImageResult | undefined;
  let failure: unknown;
  try {
    templates = await provider.buildTemplates(config);
    const result = await templates.deploy(input);
    if (!result || result.status !== "ready" || result.ref !== input.source.image ||
      typeof result.template_id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(result.template_id) ||
      typeof result.build_id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(result.build_id)) {
      throw new Error("Invalid provider result");
    }
    ready = { template_id: result.template_id, build_id: result.build_id, status: "ready", ref: input.source.image };
  } catch (error) {
    // Provider/SDK error bodies can contain credentials, including unknown encodings.
    failure = error instanceof ProviderTemplateHostError ? error : new ProviderConfigError("Provider image deployment failed or was cancelled. A submitted remote build may still exist; inspect the provider dashboard.");
  }
  if (templates?.close) {
    try { await templates.close(); }
    catch { failure = new ProviderConfigError("Provider template resources could not be closed. A submitted remote build may still exist; inspect the provider dashboard."); }
  }
  if (failure) throw failure;
  return ready!;
}

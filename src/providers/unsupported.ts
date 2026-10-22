/** Missing protocol groups fail closed, without constructing a different backend's transport. */
import { ProviderFeatureNotSupportedError } from "../models/provider_errors.js";
export function unsupportedProtocol(provider: string, feature: string): Record<string, (...args: unknown[]) => Promise<never>> {
  return new Proxy({}, { get(_target, name) {
    if (typeof name !== "string" || name === "then") return undefined;
    return async () => { throw new ProviderFeatureNotSupportedError(provider, feature); };
  } });
}

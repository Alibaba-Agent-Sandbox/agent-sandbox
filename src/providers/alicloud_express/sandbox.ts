/** Express-specific optional create inputs; the shared wire adapter remains provider-neutral. */
import type { SandboxConfig } from "../../models/sandbox.js";
import { QuotaExceededError, SandboxCreationError, TemplateNotFoundError } from "../../models/errors.js";
import type { HTTPStatusError } from "../../transport/http.js";
import { SandboxProtocol } from "../shared/e2b/sandbox.js";
import { networkWire, parseCreateNetwork, networkCreateSchema, networkSecretValues } from "./network_schema.js";

export class ExpressSandboxProtocol extends SandboxProtocol {
  override _handleCreateError(error: HTTPStatusError, config?: SandboxConfig): never {
    if (!config || !networkSecretValues(config.network).length) return super._handleCreateError(error, config);
    // Do not copy service text or request/response objects: credentials may be
    // reflected through encodings that cannot be safely covered by replacement.
    const status = error.response.status_code;
    const Ctor = status === 404 ? TemplateNotFoundError : status === 429 ? QuotaExceededError : SandboxCreationError;
    const safe = new Ctor(`Express sandbox creation failed (HTTP${status}). Network credential details were withheld.`, {
      suggestion: "Inspect the selected template and network settings before deliberately retrying.", docs_url: "",
    });
    Object.defineProperty(safe, "status_code", { value: status });
    throw safe;
  }

  protected override createPayload(config: SandboxConfig): Record<string, unknown> {
    const payload = super.createPayload(config);
    if (config.network === null) return payload;
    const validated = networkCreateSchema.parse(parseCreateNetwork(config.network, config.secure !== false));
    const { allowInternetAccess, ...network } = networkWire(validated);
    payload.network = network;
    if (allowInternetAccess !== undefined) payload.allowInternetAccess = allowInternetAccess;
    // The standard secure switch is required for SDK access to private public-port gateways.
    payload.secure = config.secure !== false;
    return payload;
  }
}

/** Lazy Express API-key resolution shared by declared data-plane operations. */
import { ApiKeyAuth } from "../../transport/auth_contract.js";
import type { LayeredConfig } from "../../transport/config_layers.js";
import { HttpClient } from "../../transport/http.js";
import { ProviderTimeoutError } from "../../models/provider_errors.js";
import { resolveSandboxApiKey } from "./managed_api_key.js";

/** Resolve a prepared key without authorizing creation or renewal; close even after a late resolution. */
export function dataPlaneClient(config: LayeredConfig): {
  get(signal: AbortSignal): Promise<HttpClient>;
  close(): Promise<void>;
} {
  let http: HttpClient | undefined;
  let preparing: Promise<HttpClient> | undefined;
  let closed = false;
  return {
    async get(signal) {
      if (closed || signal.aborted) throw new ProviderTimeoutError("Provider command was cancelled before sending a request.");
      preparing ??= (async () => {
        const key = await resolveSandboxApiKey(config);
        if (closed || signal.aborted) throw new ProviderTimeoutError("Provider command was cancelled before sending a request.");
        http = new HttpClient(config.toTransportConfig(), new ApiKeyAuth(key));
        return http;
      })();
      return preparing;
    },
    async close() { closed = true; await http?.close(); },
  };
}

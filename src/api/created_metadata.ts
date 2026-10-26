/** Internal observation bound to one newly created resource and its resolved provider configuration. */
import { SandboxNotFoundError } from "../models/errors.js";
import { ProviderResourceNotFoundError } from "../models/provider_errors.js";
import type { SandboxInfo } from "../models/sandbox.js";
import type { Provider } from "../providers/base.js";
import { LayeredConfig } from "../transport/config_layers.js";
import { HTTPStatusError } from "../transport/http.js";

export type CreatedMetadata = { state: "found"; info: SandboxInfo } | { state: "absent" } | { state: "unknown" };
export type CreatedMetadataReader = () => Promise<CreatedMetadata>;

/** Never reload defaults: TransportConfig alone omits provider-specific routing and credentials. */
export function freezeCreatedMetadataReader(provider: Provider, config: LayeredConfig, id: string): CreatedMetadataReader {
  try {
    const snapshot = structuredClone(config);
    const build = provider.buildInfra.bind(provider);
    return async () => {
      try {
        const infra = await build(new LayeredConfig(structuredClone(snapshot)));
        let result: CreatedMetadata;
        try {
          try { result = { state: "found", info: await infra.sandbox_protocol.getInfo(id) }; }
          catch (error) {
            if (error instanceof SandboxNotFoundError || error instanceof ProviderResourceNotFoundError
              || (error instanceof HTTPStatusError && error.response.status_code === 404)) result = { state: "absent" };
            else result = { state: "unknown" };
          }
        } finally {
          if (infra.close) await infra.close();
          else await infra.http_client?.close();
        }
        return result;
      } catch { return { state: "unknown" }; }
    };
  } catch { return async () => ({ state: "unknown" }); }
}

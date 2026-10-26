/** Independently verify explicit create requirements before reporting a usable sandbox. */
import { SandboxNotFoundError } from "../models/errors.js";
import { ProviderResourceNotFoundError } from "../models/provider_errors.js";
import { HTTPStatusError } from "../transport/http.js";
import type { SandboxManager } from "./mcp.js";
import type { JsonObject } from "./_py.js";

/** A failed check rolls back only the resource created by this request, preserving its recovery identity. */
export async function verifyCreatedResources(
  manager: SandboxManager, id: string, requested: { cpu?: number; memory?: number },
): Promise<JsonObject | null> {
  if (requested.cpu === undefined && requested.memory === undefined) return null;
  let observed: { cpu: number | null; memory: number | null } = { cpu: null, memory: null };
  try {
    const info = await manager.observeSandbox(id);
    observed = {
      cpu: typeof info.cpu_count === "number" ? info.cpu_count : null,
      memory: typeof info.memory_mb === "number" ? info.memory_mb : null,
    };
    if ((requested.cpu === undefined || requested.cpu === observed.cpu)
      && (requested.memory === undefined || requested.memory === observed.memory)) return null;
  } catch { /* Private provider messages do not enter the MCP response. */ }
  let cleanupVerified = false;
  try {
    await manager.killSandbox(id);
    try { await manager.observeSandbox(id); }
    catch (error) {
      cleanupVerified = error instanceof SandboxNotFoundError || error instanceof ProviderResourceNotFoundError
        || (error instanceof HTTPStatusError && error.response.status_code === 404);
    }
  } catch { /* The returned identity permits an explicit cleanup retry. */ }
  const unknown = (requested.cpu !== undefined && observed.cpu === null)
    || (requested.memory !== undefined && observed.memory === null);
  return {
    error: unknown ? "The created sandbox's requested resources could not be verified."
      : "The provider did not apply the requested sandbox resources.",
    category: "resource_configuration", verified: false,
    requested_resources: requested, observed_resources: observed,
    sandbox_id: id, cleanup_verified: cleanupVerified,
    suggestion: "Select or build a template with the required resources, then verify its sandbox metadata. Retry cleanup of this sandbox ID if cleanup_verified is false.",
  };
}

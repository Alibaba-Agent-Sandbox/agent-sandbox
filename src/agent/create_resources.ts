/** Independently verify explicit create requirements before reporting a usable sandbox. */
import type { CreatedMetadataReader } from "../api/created_metadata.js";
import type { JsonObject } from "./_py.js";

/** A failed check rolls back only the resource created by this request, preserving its recovery identity. */
export async function verifyCreatedResources(
  id: string, requested: { cpu?: number; memory?: number },
  readCreatedMetadata?: CreatedMetadataReader,
  rollbackCreated?: () => Promise<void>,
): Promise<JsonObject | null> {
  if (requested.cpu === undefined && requested.memory === undefined) return null;
  let observed: { cpu: number | null; memory: number | null } = { cpu: null, memory: null };
  try {
    const metadata = await readCreatedMetadata?.();
    if (metadata?.state !== "found") throw new Error("Created resource metadata is unavailable.");
    const info = metadata.info;
    observed = {
      cpu: Number.isInteger(info.cpu_count) && (info.cpu_count ?? 0) > 0 ? info.cpu_count! : null,
      memory: Number.isInteger(info.memory_mb) && (info.memory_mb ?? 0) > 0 ? info.memory_mb! : null,
    };
    if ((requested.cpu === undefined || requested.cpu === observed.cpu)
      && (requested.memory === undefined || requested.memory === observed.memory)) return null;
  } catch { /* Private provider messages do not enter the MCP response. */ }
  let cleanupVerified = false;
  try { await rollbackCreated?.(); }
  catch { /* A failed response can follow a committed delete; still read back. */ }
  try { cleanupVerified = (await readCreatedMetadata?.())?.state === "absent"; }
  catch { /* The returned identity permits an explicit cleanup retry. */ }
  const unknown = (requested.cpu !== undefined && observed.cpu === null)
    || (requested.memory !== undefined && observed.memory === null);
  return {
    error: unknown ? "The created sandbox's requested resources could not be verified."
      : "The provider did not apply the requested sandbox resources.",
    category: "resource_configuration", verified: false,
    requested_resources: requested, observed_resources: observed,
    sandbox_id: id, cleanup_verified: cleanupVerified,
    ...(!cleanupVerified ? { recovery_sandbox_id: id } : {}),
    suggestion: "Select or build a template with the required resources, then verify its sandbox metadata. Retry cleanup of this sandbox ID if cleanup_verified is false.",
  };
}

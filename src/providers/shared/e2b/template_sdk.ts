/** Optional E2B protocol helper, requested explicitly by an adapter; never selected by provider ID. */
import { ProviderTemplateHostError } from "../../../models/provider_errors.js";

/** Load the pinned template constructor only when a plugin opts into this SDK helper. */
export async function loadTemplate(): Promise<unknown> {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new ProviderTemplateHostError("node-version");
  const sdkPackage = "e2b";
  try {
    const { Template } = await import(sdkPackage) as { Template: unknown };
    return Template;
  } catch {
    throw new ProviderTemplateHostError("sdk-missing");
  }
}

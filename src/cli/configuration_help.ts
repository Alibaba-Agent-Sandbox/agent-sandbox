/** Short, actionable field help shared by setup and in-command configuration. */
import { providerCliExtension } from "./provider_extensions.js";

export function configurationFieldHelp(key: string, provider: string): string | undefined {
  if (key === "server_token") return "The application access token protects services inside your sandbox. Choose Save for future commands to generate a random token with Enter; it will also be used by abx run. You do not need to obtain it from a cloud console.";
  if (key === "llm_api_key") return "Use an API key from the model service you intend to call. Configure its endpoint with 'abx config set llm_base_url'.";
  return providerCliExtension(provider)?.configuration?.fieldHelp?.[key];
}

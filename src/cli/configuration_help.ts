/** Short, actionable field help shared by setup and in-command configuration. */
import { providerCliExtension } from "./provider_extensions.js";

export function configurationFieldHelp(key: string, provider: string): string | undefined {
  if (key === "server_token") return "ABX_SERVER_TOKEN protects the application API inside your sandbox and is separate from your Sandbox API key and Alibaba Cloud AccessKeys. You do not obtain it from a cloud console: template launch generates and saves it automatically when missing. Later abx run calls reuse it. You can optionally choose your own private token. Run 'abx config init' to generate and save it, or 'abx config set server_token' to enter your own token with hidden input.";
  if (key === "llm_api_key") return "Use an API key from the model service you intend to call. Configure its endpoint with 'abx config set llm_base_url'.";
  return providerCliExtension(provider)?.configuration?.fieldHelp?.[key];
}

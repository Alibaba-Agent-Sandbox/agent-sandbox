/** Short, actionable field help shared by setup and in-command configuration. */
export function configurationFieldHelp(key: string, provider: string): string | undefined {
  if (key === "server_token") return "The application access token protects services inside your sandbox. Choose Save for future commands to generate a random token with Enter; it will also be used by abx run. You do not need to obtain it from a cloud console.";
  if (key === "llm_api_key") return "Use an API key from the model service you intend to call. Configure its endpoint with 'abx config set llm_base_url'.";
  if (provider !== "alicloud-express") return undefined;
  return ({
    sandbox_api_key: "Get your Sandbox API key: Agent Sandbox console > Express > API Keys, in the selected region. https://help.aliyun.com/zh/agent-sandbox/getting-started/create-api-key",
    access_key_id: "Template builds use an Alibaba Cloud AccessKey pair. Create or find it in RAM > Users > Authentication. https://help.aliyun.com/zh/acr/create-and-obtain-an-accesskey-pair",
    acr_namespace: "Use an existing ACR namespace in the selected region, or create one in Container Registry > Personal Edition > Namespaces. https://help.aliyun.com/zh/acr/user-guide/manage-namespaces",
  } as Record<string, string>)[key];
}

/** Editable MCP HTTP application source, deployed through the ordinary template lifecycle. */
import type { TemplateProfile } from "../providers/template_profile.js";
import { SERVER_SDK_RELEASE_VERSION } from "../utils/server_sdk_pin.js";

export const MCP_REQUIREMENTS = `--index-url https://pypi.org/simple
agent-sandbox-client[mcp]==${SERVER_SDK_RELEASE_VERSION}
`;

export const MCP_APP_PY = `"""Authenticated MCP Streamable HTTP application."""
import os

from agent_sandbox.agent.mcp_http import create_mcp_app, require_auth_token

app = create_mcp_app(
    auth_token=require_auth_token(
        os.environ.get("ABX_MCP_AUTH_TOKEN") or os.environ.get("ABX_SERVER_TOKEN")
    ),
    sandbox_api_key=os.environ.get("ABX_SANDBOX_API_KEY"),
    sandbox_base_url=os.environ.get("ABX_SANDBOX_BASE_URL"),
    sandbox_domain=os.environ.get("ABX_SANDBOX_DOMAIN"),
    template=os.environ.get("ABX_DEFAULT_TEMPLATE", "base"),
)
`;

/** Editable native FC service. Session state remains in the service process. */
export function mcpScaffold(profile: TemplateProfile): Map<string, string> {
  return new Map([
    ["template.yaml", `specVersion: 1
name: {name}
serving:
  api:
    component: serverless-devs/fc3@0.1.26
    actions:
      pre-deploy:
        - component: serverless-devs/fc3@0.1.26 build --dockerfile ./Dockerfile --context .
    props:
      region: cn-hangzhou
      functionName: {name}
      runtime: custom-container
      code: .
      cpu: 1
      memorySize: 2048
      timeout: 120
      role: "\${env('FC_EXECUTION_ROLE')}"
      customContainerConfig:
        image: "\${env('FC_IMAGE')}"
        port: 9000
      environmentVariables:
        ABX_SERVER_TOKEN: "\${env('ABX_SERVER_TOKEN')}"
        ABX_SANDBOX_API_KEY: "\${env('ABX_SANDBOX_API_KEY')}"
        ABX_SANDBOX_BASE_URL: "\${env('ABX_SANDBOX_BASE_URL')}"
        ABX_SANDBOX_DOMAIN: "\${env('ABX_SANDBOX_DOMAIN')}"
        ABX_DEFAULT_TEMPLATE: base
      triggers:
        - triggerName: http
          triggerType: http
          triggerConfig:
            authType: anonymous
            methods: [GET, POST, DELETE, OPTIONS]
`],
    ["Dockerfile", `FROM ${profile.base_image}
WORKDIR ${profile.workdir}
COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 9000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9000"]
`],
    ["requirements.txt", MCP_REQUIREMENTS],
    ["app.py", MCP_APP_PY],
    [".dockerignore", ".git\n.abx\n.env\n.env.*\n.venv\n__pycache__\n"],
    ["README.md", `# {name}

An editable MCP Streamable HTTP service. Edit app.py, Dockerfile and the native FC
props in template.yaml. The service creates Sandbox instances for MCP sessions.

## Configuration

Set FC_IMAGE to a writable image repository and a unique version tag. Set
FC_EXECUTION_ROLE to an existing FC execution role ARN. Supply the Sandbox API key,
API URL and sandbox domain through ABX_SANDBOX_API_KEY, ABX_SANDBOX_BASE_URL and
ABX_SANDBOX_DOMAIN for the same account and region. Keep credentials in local private
configuration or environment variables, outside version control.

ABX_SERVER_TOKEN authenticates MCP clients and is separate from the Sandbox API key.
The CLI prepares its default application token when this declared input is missing;
external clients use that token as a Bearer token. You can explicitly override it.

## Deploy and call

\`\`\`bash
abx deploy . --name {name}
abx status {name}
\`\`\`

Use the FC HTTP trigger endpoint with /mcp appended and send
Authorization: Bearer <application-token>. The trigger accepts HTTP without FC signing;
the application still validates its Bearer token.

POST /mcp accepts JSON-RPC initialize, tools/list and tools/call. Reuse the returned
Mcp-Session-Id header after initialization. DELETE /mcp ends a session and cleans up its
owned sandboxes. GET /mcp returns 405; server notification SSE is unsupported.
GET /health checks the process.

Sessions are held in process memory. FC replacement or routing a request to a different
instance does not preserve them. Configure an appropriate native FC affinity policy and
validate the intended scaling behavior before relying on long sessions; this starter does
not provide distributed session persistence.

End each MCP session with DELETE /mcp before running \`abx delete {name} --yes\`.
`],
  ]);
}

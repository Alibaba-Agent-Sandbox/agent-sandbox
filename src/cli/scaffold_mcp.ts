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

/** A single MCP process keeps session affinity on one sandbox instance. */
export function mcpScaffold(profile: TemplateProfile): Map<string, string> {
  const start = `python3 -m uvicorn app:app --app-dir ${profile.workdir} --host 0.0.0.0 --port 9000`;
  return new Map([
    ["template.yaml", `spec_version: 5
name: {name}
version: "1.0.0"
description: "Authenticated MCP Streamable HTTP server"
base: ${JSON.stringify(profile.base_image)}
workdir: ${JSON.stringify(profile.workdir)}
${profile.server_start === "platform_start_cmd" ? "generation: 2\n" : ""}start_cmd: ${JSON.stringify(start)}
ready_cmd: ${JSON.stringify("python3 -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:9000/health', timeout=5)\"")}
provides:
  mcp: { protocol: http, version: 1, port: 9000, operations: [mcp] }
env:
  ABX_SERVER_TOKEN: ""
  ABX_MCP_AUTH_TOKEN: ""
  ABX_SANDBOX_API_KEY: ""
  ABX_SANDBOX_BASE_URL: ""
  ABX_SANDBOX_DOMAIN: ""
  ABX_DEFAULT_TEMPLATE: "base"
resources:
  cpu: 1
  memory: 2048
`],
    ["Dockerfile", `FROM ${profile.base_image}
WORKDIR ${profile.workdir}
COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 9000
`],
    ["requirements.txt", MCP_REQUIREMENTS],
    ["app.py", MCP_APP_PY],
    [".dockerignore", ".git\n.abx\n.env\n.env.*\n.venv\n__pycache__\n"],
    ["README.md", `# {name}

An editable MCP Streamable HTTP application. Change app.py and template.yaml,
then build and deploy it with the normal template and application commands.

## Deploy

The MCP server creates sandboxes for its sessions. Give it the Sandbox API key,
API URL and sandbox domain for the same account and region. These are runtime
inputs; the CLI's ability to build an image does not configure this service.

\`\`\`bash
abx deploy . --name {name} -e ABX_SANDBOX_API_KEY="$ABX_SANDBOX_API_KEY" -e ABX_SANDBOX_BASE_URL="$ABX_SANDBOX_BASE_URL" -e ABX_SANDBOX_DOMAIN="$ABX_SANDBOX_DOMAIN"
\`\`\`

The CLI generates and saves ABX_SERVER_TOKEN on this machine when needed. The
MCP Bearer token uses that value unless you explicitly supply ABX_MCP_AUTH_TOKEN.
Use the deployment's mcp service URL with /mcp appended. Configure the client
with Authorization: Bearer <MCP_TOKEN> and any provider endpoint headers returned
for that URL. Provider traffic authentication and the MCP Bearer token are
separate credentials; retain both when the provider requires them. Keep secrets
out of template source and version control.

## HTTP usage and limits

POST /mcp accepts JSON-RPC initialize, tools/list and tools/call. After initialize,
reuse the returned Mcp-Session-Id header. DELETE /mcp ends that session and cleans
up its owned sandboxes. GET /mcp returns 405 because server notification SSE is
not supported. GET /health checks the process. The service uses one process in
one sandbox; sessions are kept in memory and do not survive its replacement.

For example, send POST /mcp with Content-Type: application/json,
Authorization: Bearer <MCP_TOKEN>, and this body:

\`\`\`json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
\`\`\`

Use the returned session header for subsequent requests. The MCP tools create,
inspect and execute within separate session sandboxes. End each session with
DELETE /mcp, then remove the application with \`abx delete {name} --yes\`.
`],
  ]);
}

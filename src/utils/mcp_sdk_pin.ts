/** The unpublished client/runtime pair comes from one accepted, tested source revision. */
export const MCP_SDK_GIT_SHA = "13b214b334b1dba26c46f94feea6f4699d5038cb";
const archive = `https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/${MCP_SDK_GIT_SHA}.tar.gz`;
export const MCP_SERVER_PIP_SPEC = `agent-sandbox-server @ ${archive}#subdirectory=server-sdk`;
export const MCP_CLIENT_PIP_SPEC = `agent-sandbox-client[mcp] @ ${archive}#subdirectory=client-sdk`;

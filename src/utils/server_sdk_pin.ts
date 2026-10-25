/** Exact published runtime requirement shared by generation and scaffolding. */
export const SERVER_SDK_RELEASE_VERSION = "0.4.0a6";
export const SERVER_SDK_RELEASE_SPEC = `agent-sandbox-server==${SERVER_SDK_RELEASE_VERSION}`;

/** The Dockerfile line written by template scaffold. */
export const ABX_SERVER_INSTALL = `RUN pip install --index-url https://pypi.org/simple --no-cache-dir "${SERVER_SDK_RELEASE_SPEC}"`;

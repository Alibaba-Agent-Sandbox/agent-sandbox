/**
 * Entry point equivalent to `python -m agent_sandbox.agent.mcp`.
 *
 * Reads the sandbox connection settings from the environment and serves the
 * MCP STDIO transport until stdin closes or SIGINT/SIGTERM arrives.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SandboxMCPServer } from "./mcp.js";

/** Environment-derived constructor options (`main()` in the Python module). */
export function serverOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): {
  api_key: string | null;
  api_url: string | null;
  domain: string | null;
  template: string;
} {
  return {
    api_key: env.ABX_SANDBOX_API_KEY || null,
    api_url: env.ABX_SANDBOX_BASE_URL || null,
    domain: env.ABX_SANDBOX_DOMAIN || null,
    template: env.ABX_DEFAULT_TEMPLATE || "base",
  };
}

/**
 * Entry point for running the MCP server directly. Resolves when the STDIO
 * loop has ended and the session's sandboxes were cleaned up; the caller
 * decides when to exit the process.
 */
export async function main(): Promise<void> {
  const server = new SandboxMCPServer(serverOptionsFromEnv());
  await server.run();
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().then(
    () => process.exit(0),
    (exc: unknown) => {
      process.stderr.write(`${exc instanceof Error ? (exc.stack ?? exc.message) : String(exc)}\n`);
      process.exit(1);
    },
  );
}

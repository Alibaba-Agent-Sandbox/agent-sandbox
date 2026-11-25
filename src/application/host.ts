/** Host prerequisite for managed builds; component execution uses real Node/loader files. */
import { createRequire } from "node:module";
import { ApplicationError } from "./config.js";

/** Reject unsupported standalone managed preparation before local or cloud effects. */
export function assertManagedApplicationHost(): void {
  let standalone = false;
  try {
    const sea = createRequire(import.meta.url)("node:sea") as { isSea?: () => boolean };
    standalone = Boolean(sea.isSea?.());
  } catch { /* Older Node versions have no SEA inspection module. */ }
  if (standalone) throw new ApplicationError(
    "Managed FC application build/deploy requires Node.js 20+ and the npm CLI. " +
    "Install 'npm install -g @agent-sandbox/cli@0.6.0-alpha.1' and run this command with that installation. " +
    "The standalone binary can still preview a deployment with --plan.",
  );
}

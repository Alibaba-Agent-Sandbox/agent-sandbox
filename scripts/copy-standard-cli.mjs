import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const destination = new URL("../dist/standard_cli/", import.meta.url);
mkdirSync(destination, { recursive: true });
for (const name of ["runtime.mjs", "THIRD_PARTY_NOTICES.txt", "runtime.mjs.LEGAL.txt", "templates"]) {
  cpSync(new URL(`../src/standard_cli/${name}`, import.meta.url), fileURLToPath(new URL(name, destination)), { recursive: true });
}

// The pure planner is shared with static catalog consumers and must also ship in npm/SEA inputs.
const workflowDestination = new URL("../dist/template/", import.meta.url);
mkdirSync(workflowDestination, { recursive: true });
for (const name of ["launch_plan.mjs", "launch-v1.json", "workflow_plan.mjs", "workflow-v1.json", "verification-profiles.json"]) {
  cpSync(new URL(`../src/template/${name}`, import.meta.url), fileURLToPath(new URL(name, workflowDestination)));
}

import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const destination = new URL("../dist/standard_cli/", import.meta.url);
mkdirSync(destination, { recursive: true });
for (const name of ["runtime.mjs", "THIRD_PARTY_NOTICES.txt", "runtime.mjs.LEGAL.txt", "templates"]) {
  cpSync(new URL(`../src/standard_cli/${name}`, import.meta.url), fileURLToPath(new URL(name, destination)), { recursive: true });
}

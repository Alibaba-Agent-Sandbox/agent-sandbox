// Exercise an installed package or a real SEA, outside source-module imports.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
assert.ok(process.argv[2], "Pass an installed abx path or a binary directory");
let artifact = resolve(process.argv[2]);
if (statSync(artifact).isDirectory()) {
  const binaries = readdirSync(artifact).filter((name) => name.startsWith(`abx-${version}-`) && !name.endsWith(".sha256"));
  assert.equal(binaries.length, 1, "Expected one actual executable for this platform");
  artifact = join(artifact, binaries[0]);
}
const run = (args) => {
  const result = spawnSync(artifact, args, { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: process.platform === "win32" && artifact.endsWith(".cmd") });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${args.join(" ")} failed`);
  return result.stdout;
};
assert.ok(run(["--version"]).includes(version), "Installed artifact has the wrong version");
assert.match(run(["--help"]), /Usage:/i);
assert.match(run(["create", "--help"]), /--detach/);
assert.match(run(["template", "image", "--help"]), /Usage:/i);
const declaration = /^export const STANDARD_LICENSES = (.+);$/m.exec(readFileSync(join(root, "src/standard_cli/notices.ts"), "utf8"));
assert.ok(declaration, "Missing complete reviewed notice declaration");
assert.equal(run(["--licenses"]), JSON.parse(declaration[1]), "Installed artifact notices differ from the complete source");
console.log(`PASS: installed abx ${version}: version, root/standard/native help and complete notices`);

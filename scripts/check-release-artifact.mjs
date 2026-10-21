// Exercise an installed package or a real SEA, outside source-module imports.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const rootHelp = run(["--help"]);
assert.match(rootHelp, /Usage:/i);
assert.doesNotMatch(rootHelp, /^Providers:$/m, "Provider belongs in Command groups");
assert.match(rootHelp.split("Command groups:\n")[1]?.split("\n\n")[0] ?? "", /^ {2}provider\s/m);
assert.match(rootHelp, /https:\/\/registry\.agent-sandbox\.cn\/templates\//);
assert.match(rootHelp, /create\s+Create a sandbox\.\s+\(alias: abx sandbox create\)/, "Installed artifact must explain the create shortcut");
assert.match(rootHelp, /run\s+Run a registered sandbox command\.\s+\(alias: abx sandbox\s+command run\)/, "Installed artifact must explain registered commands before their alias");
assert.match(run(["create", "--help"]), /--detach/);
assert.match(run(["template", "image", "--help"]), /Usage:/i);
assert.match(run(["--native", "template", "list", "--help"]), /--official-api/);
assert.match(run(["--native", "config", "get", "region"]), /\S/);
const projectRoot = mkdtempSync(join(tmpdir(), "abx-onboarding-"));
try {
  const project = join(projectRoot, "project");
  const missing = spawnSync(artifact, ["template", "deploy", project, "-y"], { encoding: "utf8", timeout: 60000, windowsHide: true, shell: process.platform === "win32" && artifact.endsWith(".cmd") });
  assert.equal(missing.status, 2, "Missing project must fail before cloud deployment");
  assert.match(missing.stderr, /abx template scaffold/);
  assert.equal(existsSync(project), false, "Batch deploy must not create an unrequested project");
  run(["template", "scaffold", "--template", "python", project]);
  writeFileSync(join(project, "Dockerfile"), "keep original\n");
  const overwrite = spawnSync(artifact, ["template", "scaffold", "--template", "python", project, "-y"], { encoding: "utf8", timeout: 60000, windowsHide: true, shell: process.platform === "win32" && artifact.endsWith(".cmd") });
  assert.equal(overwrite.status, 1, "Yes alone must not authorize replacement");
  assert.equal(readFileSync(join(project, "Dockerfile"), "utf8"), "keep original\n");
  run(["template", "scaffold", "--template", "python", project, "--force", "-y"]);
  assert.match(readFileSync(join(project, "Dockerfile"), "utf8"), /FROM/);
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}
const declaration = /^export const STANDARD_LICENSES = (.+);$/m.exec(readFileSync(join(root, "src/standard_cli/notices.ts"), "utf8"));
assert.ok(declaration, "Missing complete reviewed notice declaration");
const runtimeDeclaration = /^export const RUNTIME_DEPENDENCY_NOTICES = (.+);$/m.exec(readFileSync(join(root, "src/licenses/runtime_dependencies.ts"), "utf8"));
assert.ok(runtimeDeclaration, "Missing complete reviewed runtime dependency notice declaration");
assert.equal(run(["--licenses"]), JSON.parse(declaration[1]) + JSON.parse(runtimeDeclaration[1]), "Installed artifact notices differ from the complete source");
console.log(`PASS: installed abx ${version}: version, root/standard/native help and complete notices`);

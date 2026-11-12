// Exercise an installed package or a real SEA, outside source-module imports.
import assert from "node:assert/strict";
import { TERMINAL_DRIVER } from "./terminal-driver.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
for (const name of ["deploy", "list", "status", "logs", "delete", "recover"]) assert.match(rootHelp, new RegExp(`^ {2}${name}\\s`, "m"));
assert.doesNotMatch(rootHelp, /^ {2}(create|exec|run|kill|info)\s/m);
assert.match(run(["deploy", "--help"]), /--template-id/);
assert.match(run(["sandbox", "exec", "--help"]), /Everything after the sandbox ID/);
assert.match(run(["template", "init", "--help"]), /--from/);
const providerHelp = run(["--provider", "alicloud-express", "provider", "run", "template.list", "--help"]);
assert.match(providerHelp, /team_id/); assert.match(providerHelp, /--region/);
assert.match(run(["config", "get", "region"]), /\S/);
const projectRoot = mkdtempSync(join(tmpdir(), "abx-onboarding-"));
try {
  const project = join(projectRoot, "project");
  // Isolate credentials/config before verifying continuation into provider preflight.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["path", "systemroot", "windir", "comspec", "pathext", "tmp", "temp", "lang", "lc_all", "ci", "github_actions"].includes(key.toLowerCase())));
  environment.HOME = projectRoot;
  environment.USERPROFILE = projectRoot;
  environment.XDG_CONFIG_HOME = join(projectRoot, ".config");
  environment.ABX_NO_KEYCHAIN = "1";
  const invokeProject = (args, extraEnvironment = {}) => {
    const result = spawnSync(artifact, args, { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      cwd: projectRoot, env: { ...environment, ...extraEnvironment }, shell: process.platform === "win32" && artifact.endsWith(".cmd") });
    assert.ifError(result.error);
    return result;
  };
  // Unrelated upstream state must never break ABX help or supply a different identity.
  mkdirSync(join(projectRoot, ".e2b"));
  writeFileSync(join(projectRoot, ".e2b", "config.json"), "{invalid unrelated configuration");
  const standardHelp = invokeProject(["deploy", "--help"]);
  assert.equal(standardHelp.status, 0, "A corrupt ~/.e2b/config.json must not affect ABX help");
  assert.match(standardHelp.stdout, /Usage:/i);
  assert.equal(readFileSync(join(projectRoot, ".e2b", "config.json"), "utf8"), "{invalid unrelated configuration", "ABX must not rewrite unrelated E2B state");
  const missingKey = invokeProject(["deploy", "--template-id", "base", "--yes"]);
  assert.equal(missingKey.status, 1, "No-key standard create must stop before submitting a cloud request");
  assert.match(missingKey.stdout + missingKey.stderr, /Missing configuration/i);
  assert.match(missingKey.stdout + missingKey.stderr, /sandbox_api_key/);
  assert.doesNotMatch(missingKey.stdout + missingKey.stderr, /e2b auth login|e2b\.dev\/dashboard/i);
  assert.doesNotMatch(missingKey.stdout + missingKey.stderr, /Configuration scope|input hidden/i, "A subprocess without a terminal must never ask for credentials");
  // Reach built-in provider execution identity in the actual delivered artifact.
  // The closed loopback port prevents cloud mutation; credentials are synthetic.
  const managedProject = join(projectRoot, "managed-project");
  mkdirSync(managedProject);
  writeFileSync(join(managedProject, "template.yaml"), "specVersion: 1\nname: base\nsandbox:\n  provider: alicloud-express\n  template:\n    reference: base\n  services: {}\n");
  const managedLaunch = invokeProject(["--provider", "alicloud-express", "--json", "deploy", managedProject, "--name", "artifact-probe", "--yes"], {
    ABX_SANDBOX_API_KEY: "placeholder-test-key",
    ABX_SANDBOX_BASE_URL: "http://127.0.0.1:1",
    ABX_SANDBOX_DOMAIN: "localhost",
  });
  assert.notEqual(managedLaunch.status, 0, "Closed loopback must stop before a real create");
  const managedFailure = JSON.parse(managedLaunch.stdout);
  assert.match(managedFailure.message, /Sandbox creation has an uncertain outcome/,
    "Built-in provider identity must load from the artifact without sidecar source files");
  assert.doesNotMatch(managedFailure.message, /ENOENT|providers[\\/]|File or directory not found/);
  const invalid = invokeProject(["deploy", "--unknown-local-option"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /No such option/i);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /Configuration scope|Missing configuration/i, "Syntax errors precede credential setup");
  const nativeJson = invokeProject(["--json", "deploy", "--template-id", "base", "--yes"]);
  assert.equal(nativeJson.status, 1);
  assert.match(JSON.parse(nativeJson.stdout).message, /sandbox_api_key/);
  assert.doesNotMatch(nativeJson.stdout + nativeJson.stderr, /Configuration scope|input hidden/i);
  const ciCreate = invokeProject(["--ci", "deploy", "--template-id", "base", "--yes"], { CI: "1" });
  assert.equal(ciCreate.status, 1);
  assert.match(JSON.parse(ciCreate.stdout).message, /sandbox_api_key/);
  assert.doesNotMatch(ciCreate.stdout + ciCreate.stderr, /Configuration scope|input hidden/i);
  assert.equal(invokeProject(["template", "init", project, "--template", "python", "--yes"]).status, 0);
  for (const name of ["template.yaml", "Dockerfile", "commands.py"]) assert.ok(existsSync(join(project, name)));
  const missing = invokeProject(["template", "build", project, "--yes"]);
  assert.equal(missing.status, 1, "Source build must reach Provider credential preflight");
  assert.match(missing.stdout + missing.stderr, /Missing configuration/i);
  assert.match(missing.stdout + missing.stderr, /access_key_id/);
  assert.doesNotMatch(missing.stdout + missing.stderr, /Configuration scope|input hidden/i);
  const ci = invokeProject(["--ci", "template", "build", project, "--yes"]);
  assert.equal(ci.status, 1); assert.match(JSON.parse(ci.stdout).message, /Missing configuration/i);
  writeFileSync(join(project, "Dockerfile"), "keep original\n");
  const overwrite = invokeProject(["template", "init", "--template", "python", project, "-y"]);
  assert.equal(overwrite.status, 1, "Yes alone must not authorize replacement");
  assert.equal(readFileSync(join(project, "Dockerfile"), "utf8"), "keep original\n");
  assert.equal(invokeProject(["template", "init", "--template", "python", project, "--force", "-y"]).status, 0);
  assert.match(readFileSync(join(project, "Dockerfile"), "utf8"), /FROM/);
  // Exercise the shipped executable in a real terminal; cancellation precedes Docker/cloud work.
  if (process.platform !== "win32") {
    const python = spawnSync("python3", ["-c", "import pty, fcntl, termios"], { encoding: "utf8" });
    assert.equal(python.status, 0, "POSIX release verification requires python3 PTY support");
    const terminalEnv = { ...environment, TERM: "xterm-256color" };
    delete terminalEnv.CI;
    delete terminalEnv.GITHUB_ACTIONS;
    const spec = {
      argv: [artifact, "sandbox", "exec", "artifact-probe-unregistered", "true"], stdout_terminal: true,
      steps: [{ wait_for: "access_key_id + access_key_secret", keys: "\x1b[B\x1b[B\r" }],
    };
    const driven = spawnSync("python3", ["-c", TERMINAL_DRIVER, JSON.stringify(spec)], {
      encoding: "utf8", timeout: 60000, env: terminalEnv, cwd: projectRoot,
    });
    assert.ifError(driven.error);
    assert.equal(driven.status, 0, driven.stderr);
    const terminal = JSON.parse(driven.stdout);
    assert.equal(terminal.timed_out, false, "Terminal menu did not finish");
    assert.equal(terminal.status, 1, "Cancel must stop deployment");
    assert.match(terminal.stderr, /Choose an authentication method/);
    assert.doesNotMatch(terminal.stderr, /Configuration scope|Save for future commands/);
    assert.match(terminal.stderr, /Cancel/);
    assert.doesNotMatch(terminal.stderr, /input hidden|Configuration.*complete; continuing/);
    assert.ok(!existsSync(join(projectRoot, ".abx", ".env")), "Cancel must not save credentials");
    assert.ok(!existsSync(join(projectRoot, ".abx", "config.toml")), "Cancel must not save configuration");
    console.log("PASS: installed executable authentication menu: Down/Down/Enter cancels before credential input");
  }

} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}
const declaration = /^export const STANDARD_LICENSES = (.+);$/m.exec(readFileSync(join(root, "src/standard_cli/notices.ts"), "utf8"));
assert.ok(declaration, "Missing complete reviewed notice declaration");
const runtimeDeclaration = /^export const RUNTIME_DEPENDENCY_NOTICES = (.+);$/m.exec(readFileSync(join(root, "src/licenses/runtime_dependencies.ts"), "utf8"));
assert.ok(runtimeDeclaration, "Missing complete reviewed runtime dependency notice declaration");
assert.equal(run(["--licenses"]), JSON.parse(declaration[1]) + JSON.parse(runtimeDeclaration[1]), "Installed artifact notices differ from the complete source");
console.log(`PASS: installed abx ${version}: version, isolated guidance, one JSON result, one frontend help and complete notices`);

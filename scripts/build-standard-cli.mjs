import { verifyPrebundledNotices } from "./standard-provenance.mjs";
// Reproduce the pinned standard command implementation without runtime SDK dependencies.
// First run npm ci --prefix vendor/e2b-cli. The separate lockfile is intentional.
import fs from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base = process.env["ABX_E2B_BASELINE"] ?? path.join(root, "vendor/e2b-cli");
const { build } = await import(pathToFileURL(path.join(base, "node_modules/esbuild/lib/main.js")).href);
const output = path.join(root, "src/standard_cli");
fs.mkdirSync(output, { recursive: true });
const assetDirectory = path.join(base, "node_modules/@e2b/cli/dist/templates");
const { SERVER_SDK_RELEASE_VERSION } = await import('../dist/utils/server_sdk_pin.js');
const pythonInstall = `python -m pip install --index-url https://pypi.org/simple "agent-sandbox-client==${SERVER_SDK_RELEASE_VERSION}"`;
const templateAssets = Object.fromEntries(fs.readdirSync(assetDirectory).map((name) => {
  let contents = fs.readFileSync(path.join(assetDirectory, name), "utf8");
  contents = contents.replaceAll("from e2b import", "from agent_sandbox import");
  if (name === "readme.hbs") contents = contents
    .replaceAll("pip install e2b", pythonInstall)
    .replace("sandbox = Sandbox.create('{{name}}')\n\n# Your sandbox is ready to use!\nprint('Sandbox created successfully')", "sandbox = Sandbox.create('{{name}}')\ntry:\n    print('Sandbox created successfully')\nfinally:\n    sandbox.kill()")
    .replace("    sandbox = await AsyncSandbox.create('{{name}}')\n    \n    # Your sandbox is ready to use!\n    print('Sandbox created successfully')", "    sandbox = await AsyncSandbox.create('{{name}}')\n    try:\n        print('Sandbox created successfully')\n    finally:\n        await sandbox.kill()")
    .replaceAll("E2B Sandbox Template", "Agent Sandbox Template")
    .replace("- An E2B account (sign up at [e2b.dev](https://e2b.dev))", "- An Alibaba Agent Sandbox account")
    .replace("- Your E2B API key (get it from your [E2B dashboard](https://e2b.dev/dashboard))", "- A sandbox API key from the Alibaba Console")
    .replace("E2B_API_KEY=your_api_key_here", "{{#if isPython}}ABX_SANDBOX_API_KEY=your_api_key_here\n   ABX_SANDBOX_BASE_URL=https://api.<region>.sandbox.aliyuncs.com\n   ABX_SANDBOX_DOMAIN=<region>.sandbox.aliyuncs.com{{else}}E2B_API_KEY=your_api_key_here\n   E2B_API_URL=https://api.<region>.sandbox.aliyuncs.com\n   E2B_DOMAIN=<region>.sandbox.aliyuncs.com{{/if}}");
  return [name, contents];
}));
const result = await build({
  absWorkingDir: base,
  entryPoints: [path.join(base, "node_modules/@e2b/cli/dist/index.js")],
  bundle: true, platform: "node", target: "node20", format: "esm",
  outfile: path.join(output, "runtime.mjs"), metafile: true, legalComments: "linked",
  banner: { js: `// Generated from pinned sources; see vendor/e2b-cli and THIRD_PARTY_NOTICES.txt.
import { createRequire as abxCreateRequire } from "node:module";
import { fileURLToPath as abxFileURLToPath } from "node:url";
import { dirname as abxDirname, basename as abxBasename } from "node:path";
const abxTemplateAssets = ${JSON.stringify(templateAssets)};
function abxReadTemplateAsset(filename) {
  const contents = abxTemplateAssets[abxBasename(filename)];
  if (contents === undefined) throw new Error("Unknown bundled template asset");
  return contents;
}
const require = abxCreateRequire(typeof __filename === "string" ? __filename : import.meta.url);
const __dirname = typeof __filename === "string" ? abxDirname(__filename) : abxDirname(abxFileURLToPath(import.meta.url));` },
});
// Project authentication/branding adapters leave wire formats and parser/terminal behavior pinned.
const runtimeFile = path.join(output, "runtime.mjs");
let runtime = fs.readFileSync(runtimeFile, "utf8");
if (!/\.name\(["`]e2b["`]\)/.test(runtime)) throw new Error("Pinned program name changed; review source update");
const pythonHint = 'asPrimary(`pip install e2b`)} (install e2b dependency)';
if (runtime.split(pythonHint).length - 1 !== 2) throw new Error("Pinned Python installation hints changed");
runtime = runtime.replaceAll(pythonHint, pythonHint.replace("(install e2b dependency)", "(install agent-sandbox-client dependency)"));
runtime = runtime.replaceAll("pip install e2b", JSON.stringify(pythonInstall).slice(1, -1));
runtime = runtime.replace(/\.name\(["`]e2b["`]\)/, '.name("abx")').replaceAll("e2b sandbox exec", "abx sandbox exec");
if (!runtime.includes("main(), exports.pkg = pkg;")) throw new Error("Pinned command completion entry changed");
runtime = runtime.replace("main(), exports.pkg = pkg;", "exports.completion = main(), exports.pkg = pkg;");
// ABX uses Alibaba API-key configuration, never an unrelated E2B browser-login identity.
const userConfigStart = runtime.indexOf("function getUserConfig() {");
const userConfigEnd = runtime.indexOf("function isObject(", userConfigStart);
if (userConfigStart < 0 || userConfigEnd < 0) throw new Error("Pinned user authentication boundary changed");
runtime = runtime.slice(0, userConfigStart) + "function getUserConfig() { return null; }\n    " + runtime.slice(userConfigEnd);
const authBoxStart = runtime.indexOf("var authErrorBox = () => boxen(");
const authBoxEnd = runtime.indexOf("function ensureAPIKey()", authBoxStart);
if (authBoxStart < 0 || authBoxEnd < 0) throw new Error("Pinned authentication diagnostic changed");
runtime = runtime.slice(0, authBoxStart) + 'var authErrorBox = () => "Sandbox API key is missing. Run abx config set sandbox_api_key in a terminal, or set ABX_SANDBOX_API_KEY in automation. This is the Alibaba Agent Sandbox key; build AccessKeys do not replace it.";\n    ' + runtime.slice(authBoxEnd);
let embeddedReads = 0;
runtime = runtime.replace(/fs\.readFileSync\((path\.join\([^\n]*?\.hbs`[^\n]*?\)), `utf8`\)/g, (_match, filename) => {
  embeddedReads++;
  return `abxReadTemplateAsset(${filename})`;
});
if (embeddedReads !== 5) throw new Error(`Expected five pinned scaffold asset reads, got ${embeddedReads}`);
const helpAnchor = "var prog = program.version";
if (!runtime.includes(helpAnchor)) throw new Error("Pinned help entry changed");
runtime = runtime.replace(helpAnchor, `
sandboxCommand.addHelpText("after", "\\nAgent Sandbox extensions: upload, download, files, process, command, system, capabilities. Use each command's --help.");
templateCommand.addHelpText("after", "\\nAgent Sandbox extensions: from-image, build, deploy, scaffold, install, push, search, info. Use scaffold --prompt for generation or scaffold --adopt for an existing project.");
for (const abxCommand of sandboxCommand.commands) {
  if (abxCommand.name() === "create" || abxCommand.name() === "spawn") abxCommand.addHelpText("after", "\\nAgent Sandbox: --prompt <description> generates a template before creation. Use abx create --prompt DESCRIPTION --help for its --yes, --detach and --build options.");
}
program.hook("preAction", async (_program, command) => {
  const hook = globalThis[Symbol.for("agent-sandbox.cli.configuration")];
  if (typeof hook !== "function") return;
  const commandPath = [];
  for (let current = command; current && current.parent; current = current.parent) commandPath.unshift(current.name());
  if (commandPath[0] === "template" && ["init", "migrate"].includes(commandPath[1])) return;
  try {
    if (commandPath[0] === "sandbox" && ["create", "spawn"].includes(commandPath[1])) {
      buildLifecycle(command.opts()["lifecycle.ontimeout"], command.opts()["lifecycle.autoresume"]);
    }
    const resolved = await hook({ commandPath, options: command.opts() });
    apiKey = resolved.apiKey;
    connectionConfig = new ConnectionConfig({ apiKey, apiUrl: resolved.apiUrl, domain: resolved.domain });
    client = new ApiClient(connectionConfig, { requireApiKey: false });
  } catch (error) {
    console.error(error instanceof Error ? error.message || "Configuration cancelled." : "Configuration setup failed.");
    process.exit(1);
  }
});
${helpAnchor}`);
fs.writeFileSync(runtimeFile, runtime);
fs.writeFileSync(path.join(output, "runtime.d.mts"), "// Maintained declaration boundary for the pinned bundled command implementation.\ndeclare const runtime: { completion: Promise<void> };\nexport default runtime;\n");
for (const output of Object.values(result.metafile.outputs)) {
  for (const dependency of output.imports) {
    if (dependency.external && !isBuiltin(dependency.path)) throw new Error(`Unbundled runtime dependency: ${dependency.path}`);
  }
}
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  let dir = path.dirname(path.resolve(base, input));
  while (dir.startsWith(path.join(base, "node_modules"))) {
    const metadata = path.join(dir, "package.json");
    if (fs.existsSync(metadata)) {
      const pkg = JSON.parse(fs.readFileSync(metadata, "utf8"));
      // ESM/CJS subdirectories can contain only {"type":"module"}; attribution belongs to the package root.
      if (typeof pkg.name === "string" && typeof pkg.version === "string") { packages.add(dir); break; }
    }
    dir = path.dirname(dir);
  }
  if (!packages.has(dir)) throw new Error(`Cannot identify bundled source package: ${input}`);
}
let notice = "Pinned CLI source port: @e2b/cli 2.20.0, e2b 2.50.0.\n\n";
const manifest = [];
for (const dir of [...packages].sort()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const licenseFiles = fs.readdirSync(dir).filter((name) => /^licen[cs]e|^copying|^notice/i.test(name) && fs.statSync(path.join(dir, name)).isFile()).sort();
  if (!pkg.license || licenseFiles.length === 0) throw new Error(`Missing license attribution: ${pkg.name}@${pkg.version}`);
  manifest.push({ name: pkg.name, version: pkg.version, license: pkg.license });
  notice += `\n--- ${pkg.name}@${pkg.version} (${pkg.license ?? "see source"}) ---\n`;
  for (const name of licenseFiles) notice += fs.readFileSync(path.join(dir, name), "utf8") + "\n";
}
// Verify upstream prebundled inputs separately from esbuild's external package graph.
const prebundled = JSON.parse(fs.readFileSync(path.join(base, "prebundled-sources.json"), "utf8"));
const prebundledNotices = fs.readFileSync(path.join(base, "prebundled-notices.txt"), "utf8");
const upstreamMap = fs.readFileSync(path.join(base, "node_modules/@e2b/cli/dist/index.js.map"), "utf8");
for (const pkg of verifyPrebundledNotices(upstreamMap, prebundled, prebundledNotices)) {
  if (!manifest.some(existing => existing.name === pkg.name && existing.version === pkg.version)) {
    manifest.push({ name: pkg.name, version: pkg.version, license: pkg.license });
  }
}
notice += "\n--- Pinned upstream prebundled package attributions ---\n" + prebundledNotices;

// Retain legal comments from the upstream prebundled input when the final SEA build strips comments.
notice += "\n--- Retained bundled source notices ---\n" + fs.readFileSync(`${runtimeFile}.LEGAL.txt`, "utf8");
notice = notice.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
fs.writeFileSync(path.join(output, "THIRD_PARTY_NOTICES.txt"), notice);
const licenses = fs.readFileSync(path.join(root, "LICENSE"), "utf8") + "\n" + fs.readFileSync(path.join(root, "NOTICE"), "utf8") + "\n" + notice;
fs.writeFileSync(path.join(output, "notices.ts"), "// Generated license text; rebuild with npm run vendor:e2b.\nexport const STANDARD_LICENSES = " + JSON.stringify(licenses) + ";\n");
fs.writeFileSync(path.join(root, "vendor/e2b-cli/sources.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.mkdirSync(path.join(output, "templates"), { recursive: true });
for (const [name, contents] of Object.entries(templateAssets)) fs.writeFileSync(path.join(output, "templates", name), contents);
console.log(`Built standard commands with ${manifest.length} dependency notices.`);

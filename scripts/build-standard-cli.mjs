import { verifyPrebundledNotices } from "./standard-provenance.mjs";
// Reproduce the pinned standard command implementation without runtime SDK dependencies.
// First run npm ci --prefix vendor/e2b-cli. The separate lockfile is intentional.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base = process.env["ABX_E2B_BASELINE"] ?? path.join(root, "vendor/e2b-cli");
const { build } = await import(pathToFileURL(path.join(base, "node_modules/esbuild/lib/main.js")).href);
const output = path.join(root, "src/standard_cli");
fs.mkdirSync(output, { recursive: true });
// Only the SDK is bundled: command parsing, prompts and output belong to abx.
const result = await build({
  absWorkingDir: base,
  stdin: { contents: 'export { Sandbox, ApiClient, ConnectionConfig, CommandExitError, NotFoundError } from "e2b";', resolveDir: base, sourcefile: 'sdk-entry.mjs' },
  bundle: true, platform: "node", target: "node20", format: "esm",
  outfile: path.join(output, "runtime.mjs"), metafile: true, legalComments: "linked",
  banner: { js: `// Generated from pinned e2b SDK 2.50.0; see vendor/e2b-cli and THIRD_PARTY_NOTICES.txt.
import { createRequire as abxCreateRequire } from "node:module";
const require = abxCreateRequire(typeof __filename === "string" ? __filename : import.meta.url);` },
});
const runtimeFile = path.join(output, "runtime.mjs");
// esbuild retains blank JSDoc lines from the pinned SDK; normalize only those comment lines.
fs.writeFileSync(runtimeFile, fs.readFileSync(runtimeFile, "utf8").replace(/^(\s*\*)[ \t]+$/gm, "$1"));
fs.writeFileSync(path.join(output, "runtime.d.mts"), '// Bundled SDK boundary; no CLI parser or import-time command execution.\nexport { Sandbox, ApiClient, ConnectionConfig, CommandExitError, NotFoundError } from "e2b";\n');
for (const emitted of Object.values(result.metafile.outputs)) {
  for (const dependency of emitted.imports) {
    if (dependency.external && !isBuiltin(dependency.path)) throw new Error(`Unbundled runtime dependency: ${dependency.path}`);
  }
}
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (input === "sdk-entry.mjs") continue;
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
let notice = "Pinned SDK: e2b 2.50.0. Terminal/stdin algorithms adapted from @e2b/cli 2.20.0 (Apache-2.0).\n\n";
const manifest = [];
const supplementary = JSON.parse(fs.readFileSync(path.join(base, "sdk-license-sources.json"), "utf8"));
const supplementaryNotices = fs.readFileSync(path.join(base, "sdk-license-notices.txt"), "utf8");
if (createHash("sha256").update(supplementaryNotices).digest("hex") !== supplementary.notices_sha256) throw new Error("SDK license notices changed");
for (const dir of [...packages].sort()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const licenseFiles = fs.readdirSync(dir).filter((name) => /^licen[cs]e|^copying|^notice/i.test(name) && fs.statSync(path.join(dir, name)).isFile()).sort();
  if (!pkg.license) throw new Error(`Missing license attribution: ${pkg.name}@${pkg.version}`);
  if (!licenseFiles.length && !supplementary.packages.some(entry => entry.name === pkg.name && entry.version === pkg.version && entry.license === pkg.license)) throw new Error(`Missing SDK license source: ${pkg.name}@${pkg.version}`);
  manifest.push({ name: pkg.name, version: pkg.version, license: pkg.license });
  notice += `\n--- ${pkg.name}@${pkg.version} (${pkg.license ?? "see source"}) ---\n`;
  for (const name of licenseFiles) notice += fs.readFileSync(path.join(dir, name), "utf8") + "\n";
}
// Preserve the existing separator before the following upstream CLI attribution.
notice += supplementaryNotices.replace(/\n+$/, "\n\n");
// Verify retained provenance of the upstream terminal/stdin source port.
const prebundled = JSON.parse(fs.readFileSync(path.join(base, "prebundled-sources.json"), "utf8"));
const prebundledNotices = fs.readFileSync(path.join(base, "prebundled-notices.txt"), "utf8");
const upstreamMap = fs.readFileSync(path.join(base, "node_modules/@e2b/cli/dist/index.js.map"), "utf8");
verifyPrebundledNotices(upstreamMap, prebundled, prebundledNotices);
const cliRoot = path.join(base, "node_modules/@e2b/cli");
manifest.push({ name: "@e2b/cli", version: "2.20.0", license: "Apache-2.0" });
notice += "\n--- @e2b/cli@2.20.0 (Apache-2.0; adapted terminal/stdin source) ---\n";
notice += fs.readFileSync(path.join(cliRoot, "LICENSE"), "utf8");

// Retain legal comments from the upstream prebundled input when the final SEA build strips comments.
notice += "\n--- Retained bundled source notices ---\n" + fs.readFileSync(`${runtimeFile}.LEGAL.txt`, "utf8");
notice = notice.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
fs.writeFileSync(path.join(output, "THIRD_PARTY_NOTICES.txt"), notice);
const licenses = fs.readFileSync(path.join(root, "LICENSE"), "utf8") + "\n" + fs.readFileSync(path.join(root, "NOTICE"), "utf8") + "\n" + notice;
fs.writeFileSync(path.join(output, "notices.ts"), "// Generated license text; rebuild with npm run vendor:e2b.\nexport const STANDARD_LICENSES = " + JSON.stringify(licenses) + ";\n");
fs.writeFileSync(path.join(root, "vendor/e2b-cli/sources.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Built pinned Sandbox SDK with ${manifest.length} dependency notices.`);

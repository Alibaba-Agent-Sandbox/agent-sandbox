/** Maintainer-only refresh. Normal builds verify the committed pinned provenance offline. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, prebundledIdentities } from "./standard-provenance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "vendor/e2b-cli");
const sourceMap = readFileSync(join(base, "node_modules/@e2b/cli/dist/index.js.map"));
const spdxRevision = "31ba1a50e5397e00a304dbadc76531740e89ee48";
const decode = value => new TextDecoder("utf-8", { fatal: true }).decode(value);
async function download(url, optional = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (optional && response.status === 404) return null;
  assert.ok(response.ok, `Attribution source returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
function archive(data, args) {
  return execFileSync("tar", args, { input: data, maxBuffer: 20 * 1024 * 1024 });
}
async function inspectPackage(identity) {
  const split = identity.lastIndexOf("@");
  const name = identity.slice(0, split), version = identity.slice(split + 1);
  const metadata = JSON.parse(decode(await download(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`)));
  assert.equal(metadata.name, name); assert.equal(metadata.version, version);
  assert.ok(metadata.dist.tarball.startsWith("https://registry.npmjs.org/"));
  const data = await download(metadata.dist.tarball);
  const integrity = /^(sha256|sha512)-([A-Za-z0-9+/]+=*)$/.exec(metadata.dist.integrity);
  assert.ok(integrity, "Missing exact registry content integrity");
  assert.equal(createHash(integrity[1]).update(data).digest("base64"), integrity[2], "Registry tarball integrity mismatch");
  const paths = decode(archive(data, ["-tzf", "-"])).trim().split("\n");
  const extract = path => archive(data, ["-xzOf", "-", "--", path]);
  const declaration = JSON.parse(decode(extract("package/package.json")));
  assert.equal(declaration.name, name); assert.equal(declaration.version, version);
  assert.equal(declaration.license, metadata.license, "Registry/archive license declaration mismatch");
  const files = [];
  const retain = (path, bytes, prefix = "") => files.push({ path, sha256: digest(bytes), text: (prefix + decode(bytes)).replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "") });
  for (const path of paths) {
    if (/^package\/(?:licen[cs]e|copying|notice)[^/]*$/i.test(path)) retain(path.slice(8), extract(path));
  }
  if (!files.length && name === "@bufbuild/protobuf") {
    assert.match(metadata.gitHead, /^[0-9a-f]{40}$/);
    const origin = `https://raw.githubusercontent.com/bufbuild/protobuf-es/${metadata.gitHead}/LICENSE`;
    retain(origin, await download(origin));
    const header = decode(extract("package/dist/esm/wire/varint.js")).match(/^(?:\/\/[^\n]*\n)+/)[0];
    assert.ok(header.includes("Redistribution and use") && header.includes("EVEN IF ADVISED"));
    retain("dist/esm/wire/varint.js#BSD-notice", Buffer.from(header));
  }
  if (!files.length) {
    const source = typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url;
    const repository = source?.replace(/^git\+/, "").replace(/^git:\/\/github.com\//, "https://github.com/").replace(/\.git$/, "");
    assert.match(repository ?? "", /^https:\/\/github.com\/[\w.-]+\/[\w.-]+$/);
    assert.match(metadata.gitHead, /^[0-9a-f]{40}$/);
    for (const candidate of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md", "license.txt"]) {
      const origin = `${repository.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${metadata.gitHead}/${candidate}`;
      const bytes = await download(origin, true);
      if (bytes) { retain(origin, bytes); break; }
    }
  }
  let sourceKind = "upstream-license-text";
  if (!files.length) {
    assert.ok(["MIT", "CC-BY-3.0", "CC0-1.0"].includes(metadata.license), "Unsupported declared-license fallback");
    sourceKind = "published-notices-and-declared-spdx-reference";
    for (const path of paths) {
      if (path === "package/package.json" || /^package\/readme.md$/i.test(path)) retain(path.slice(8), extract(path));
    }
    const origin = `https://raw.githubusercontent.com/spdx/license-list-data/${spdxRevision}/text/${metadata.license}.txt`;
    retain(origin, await download(origin), "Canonical SPDX reference text for the published declaration. Copyright placeholders are reference text; no holder/year is inferred.\n");
  }
  assert.ok(files.length, "Missing retained attribution");
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { source_kind: sourceKind, name, version, license: metadata.license, integrity: metadata.dist.integrity, files };
}
const identities = prebundledIdentities(sourceMap);
const packages = new Array(identities.length);
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < identities.length) { const index = next++; packages[index] = await inspectPackage(identities[index]); }
}));
packages.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
let notices = "";
for (const pkg of packages) {
  notices += `\n--- ${pkg.name}@${pkg.version} (${pkg.license}) ---\n`;
  for (const file of pkg.files) notices += file.text + "\n";
}
const manifest = { source_map_sha256: digest(sourceMap), packages: packages.map(pkg => ({
  ...pkg, files: pkg.files.map(({ path, sha256 }) => ({ path, sha256 })),
})), notices_sha256: digest(notices) };
writeFileSync(join(base, "prebundled-sources.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(base, "prebundled-notices.txt"), notices);
console.log(`Retained provenance and notices for ${packages.length} exact prebundled identities.`);

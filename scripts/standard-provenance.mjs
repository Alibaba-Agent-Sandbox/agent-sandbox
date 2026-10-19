import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export function digest(value) { return createHash("sha256").update(value).digest("hex"); }

export function prebundledIdentities(sourceMap) {
  const document = JSON.parse(sourceMap);
  assert.ok(Array.isArray(document.sources), "Missing pinned source-map inputs");
  const identities = new Set();
  for (const source of document.sources) {
    const match = /\/\.pnpm\/([^/]+)\/node_modules\/(.+)/.exec(source);
    if (!match) {
      assert.ok(!source.includes("node_modules/"), "Unidentified third-party source-map input");
      continue;
    }
    const parts = match[2].split("/");
    const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    const prefix = name.replace("/", "+") + "@";
    assert.ok(match[1].startsWith(prefix), "Source-map package identity mismatch");
    const version = match[1].slice(prefix.length).split("_")[0].split("(")[0];
    assert.match(version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/, "Invalid pinned package version");
    identities.add(`${name}@${version}`);
  }
  assert.ok(identities.size > 0, "No third-party identities in pinned source map");
  return [...identities].sort();
}

export function verifyPrebundledNotices(sourceMap, manifest, notices) {
  assert.equal(digest(sourceMap), manifest.source_map_sha256, "Pinned upstream source-map drift");
  assert.equal(digest(notices), manifest.notices_sha256, "Prebundled notice bytes changed");
  const expected = prebundledIdentities(sourceMap);
  assert.ok(Array.isArray(manifest.packages), "Missing prebundled package manifest");
  const actual = manifest.packages.map(pkg => `${pkg.name}@${pkg.version}`).sort();
  assert.deepEqual(actual, expected, "Incomplete or extra prebundled attribution identities");
  for (const pkg of manifest.packages) {
    assert.ok(typeof pkg.license === "string" && pkg.license.length > 0, "Missing declared license");
    assert.match(pkg.integrity, /^sha(?:256|512)-[A-Za-z0-9+/]+=*$/, "Missing tarball integrity");
    assert.ok(pkg.files?.length > 0, "Missing retained attribution provenance");
    for (const file of pkg.files) assert.match(file.sha256, /^[0-9a-f]{64}$/, "Missing source notice hash");
    assert.ok(notices.includes(`--- ${pkg.name}@${pkg.version} (`), "Missing package notice heading");
  }
  return manifest.packages;
}

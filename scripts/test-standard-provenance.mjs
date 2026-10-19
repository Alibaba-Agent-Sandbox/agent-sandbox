import { test } from "node:test";
import assert from "node:assert/strict";
import { digest, verifyPrebundledNotices } from "./standard-provenance.mjs";

function fixture() {
  const map = JSON.stringify({ sources: ["../src/cli.ts", "../node_modules/.pnpm/@scope+lib@1.2.3_peer@9/node_modules/@scope/lib/index.js"] });
  const notices = "--- @scope/lib@1.2.3 (MIT) ---\nRetained copyright and license";
  return { map, notices, manifest: { source_map_sha256: digest(map), notices_sha256: digest(notices), packages: [{
    name: "@scope/lib", version: "1.2.3", license: "MIT", integrity: "sha512-AAAA", files: [{ sha256: "0".repeat(64) }],
  }] } };
}
test("accepts complete pinned package/peer identities and notice bytes", () => {
  const {map, manifest, notices} = fixture();
  assert.equal(verifyPrebundledNotices(map, manifest, notices).length, 1);
});
for (const [name, mutate] of [
  ["upstream drift", f => { f.map += " "; }],
  ["notice truncation", f => { f.notices = "truncated"; }],
  ["omitted identity", f => { f.manifest.packages = []; }],
  ["extra identity", f => { f.manifest.packages.push({...f.manifest.packages[0], name: "extra"}); }],
  ["missing source provenance", f => { f.manifest.packages[0].files = []; }],
]) test(`rejects ${name}`, () => {
  const f = fixture(); mutate(f);
  assert.throws(() => verifyPrebundledNotices(f.map, f.manifest, f.notices));
});
test("rejects unrecognized foreign inputs even if the map hash was updated", () => {
  const f = fixture(); f.map = JSON.stringify({ sources: ["../node_modules/unknown/index.js"] });
  f.manifest.source_map_sha256 = digest(f.map);
  assert.throws(() => verifyPrebundledNotices(f.map, f.manifest, f.notices), /Unidentified/);
});

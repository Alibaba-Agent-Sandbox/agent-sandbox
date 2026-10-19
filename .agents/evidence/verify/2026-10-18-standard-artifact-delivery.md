# Standard artifact delivery verification — 2026-10-18

Result: PARTIAL pending final exact-head CI and parent conditional cloud acceptance.

Source: migration PR40 converged with accepted CLIad704f41; locked Node22.22.2
vendor inputs CLI2.20.0/protocol2.50.0; tested Python implementationcceb318d.

- Initial source-map audit:705 inputs,610 third-party inputs,86 package identities.
  The original SEA identified13 of86 prebundle identities. The
  [initial inventory](2026-10-18-standard-artifact-delivery/initial-inventory.json)
  remains a distinct partial receipt; no historical failure is relabelled.
- Exact integrity-checked tarballs/pinned upstream files retained81 license sources.
  Five packages publish declarations/notices without a standalone license file.
  Final manifest retains those published metadata/READMEs and explicitly labelled
  canonical SPDX references, with source hashes; no holder/year is inferred.
- Maintainer refresh implemented as Node plus read-only tar inspection, satisfying
  repository language boundaries. Actual Node refresh retained all86 identities.
- The source/notice verifier's7 behavioral controls PASS, including source drift,
  missing/extra identity, truncated bytes and missing provenance rejection.
- Expanded executable regression reproduced a real partial write: license output
  stopped near64KiB and omitted package identities. Awaiting the stdout callback
  produces the full219074-byte supplied declaration; actual SEA readback includes
  every prebundle identity. Standard-command exit also drains real streams.
- Generated Python recipes now install both source distributions atcceb318d.
  Actual displayed pair installed cleanly; pip check, standard sync/async,
  interpreter, native provider and server imports PASS. No upstream E2B runtime.
  Two old template tests expected an unshipped PyPI recipe; assertions now require
  both matching source archive URLs, rather than weakening installation coverage.

Final deterministic generation, executable/template regressions, quality and
current-head hosted results follow after the final staged artifact build.
No cloud resource is created by these artifact checks. Parent real Express evidence
and missing enabled pause/snapshot prerequisite remain separately recorded in
[convergence verification](2026-10-18-standard-provider-convergence.md).

Final artifact receipt: source replay byte-identical for12 shipped files;7 verifier
controls and22 standard executable/configuration/template regressions PASS. Strict
typecheck PASS; lintzero errors/252 warnings; hygienePASS; health105 PASS/11
immutable-history WARN/zero FAIL. Node maintainer refresh actually ran successfully.
The final combined graph has108 dependency identities, including all86 prebundle
identities;81 entries retain upstream license text and5 explicitly retain published
notices/declarations plus pinned canonical reference text. This is an attribution
inventory, not a claim of an external legal review.

Actual final Linux SEA:f80467354487545138af0401d979b06e19ffe8e5cd8008c799741320271518e8.
Through a real pipe it emits219088 bytes and all108 identities. New executable
regression compares the entire supplied project/third-party bundle, not only headings.
Actual real Express invocation through that SEA produced exactly200000 stdout bytes.
Owned sandbox killed in finally and independently read back404;zero residuals.
Fresh documented Python pair installed with no upstream E2B runtime and correct
sync/async/native/server entries. No sandbox/model acceptance was moved to Actions.

Initial partial inventory and output failures remain distinct earlier receipts.
The technical source/attribution/install gates are now satisfied locally. The parent
PR still needs final exact-head hosted CI, SDK47 acceptance, and enabled conditional
Express pause/snapshot success. No credential or account/function setting changed.

Portable rendering follow-up: normalize rendered CRLF/trailing whitespace while
retaining original source-byte hashes and all words/notices. Normalized Node refresh,
7 verifier controls,22 executable/template/config regressions, typecheck/lint/
hygiene/health all PASS. Scoped diff/whitespace check PASS without gate exceptions.
Final normalized SEA SHA256abc121f16c63ab60584c2c1542d245af5bc078a111b2ac68d2d2cfeb04b52576
emits exactly219073 supplied bytes and all108 identities through a pipe.

Actual npm tarball built and installed into a new consumer using its generated lock
and npm ci; installed abx emitted the complete same219073 bytes and all108 identities.
This is local package-artifact acceptance, with no registry publication. The earlier
f8046735 real Express200000-byte output/owned cleanup receipt remains valid for
the unchanged command implementation; later changes normalize notice rendering.

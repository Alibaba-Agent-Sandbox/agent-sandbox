# Verification: CLI0.4.0 publication preparation — 2026-10-19

Result: PASS for installed-artifact local acceptance; hosted matrix and actual publication remain required before the release task is complete.

Base accepted main6e8421feb9722297ef70bd56e299ce9f4b0d8c5c. Node22.22.2/npm12.0.2/Linux x86_64. Reproducible npm ci with package lock; version0.4.0 in package/lock. No existing tag or historical capture modified.

## Executed local checks

- npm run typecheck/build PASS; ESLint zero errors (existing warnings retained).
- Actual npm pack, global installation into a clean user prefix, and real Linux SEA build PASS. Both installed executables pass version, root/standard/native help and exact complete-notice comparisons.
- Locally initiated real Express, separately for installed npm and actual SEA: CLI create base --detach, stdout, remote exit7,100KiB CLI upload, independent remote SHA256, CLI download with byte equality, CLI list, CLI kill plus independent API404. Eight checks each PASS, total16; zero owned sandboxes remaining. No cloud keys uploaded to Actions; no model test was invoked.
- The real POSIX installer fetched the actual Linux SEA and its SHA256 from a local HTTP release fixture, installed identical bytes into a fresh prefix and passed the same executable checks. SHA256 b735362e50082074c22b6f2ce277342497bff4d3e1213c1b1803f06a45fd6796. This is not yet a public GitHub download claim.
- First full unit checkpoint:3990 PASS/21 FAIL/2 SKIP. One real failure was the historical version snapshot still expecting0.3.0; preserve that capture and add the actual0.4.0 capture. The frozen-artifact repeat:3991 PASS/20 FAIL/2 SKIP. Remaining failures exercise managed loopback/RPC/raw TCP/TLS/WebSocket:HTTP501 network-audit-disabled and proxy framing differ from the fixture. Assertions are preserved; no full local-unit pass claimed. Complete hosted Node20/22 is required.
- Initial installer suite:7 PASS/1 FAIL because shellcheck was absent. Install pinned shellcheck-py0.11.0.1 in the audit tool environment; final installer8 PASS. New/current snapshot suite116 PASS. YAML parse and four actual guard-script cases PASS:correct tag/latest, branch refusal, mismatching tag refusal, prerelease/next.

## Delivery gates

Health/hygiene, final diff and hosted checks are recorded before merge. Five-platform package/native verification, draft asset/checksum inventory, actual npm credential usability, public-registry installation and public-installer execution remain release gates. Existing NPM_API_TOKEN name was readable but its value was not read; repository variable listing returned403 and was not retried. Explicit Release publication replaces reliance on that optional variable. Issue66 remains open until channel acceptance is complete.

No claim of PyPI release or all-template/provider acceptance. Local E2E resources were independently absent after cleanup; private identifiers and raw cloud output are not stored here.

Final preparation gates: repository health105 PASS/11 registered historical WARN/0 FAIL; hygiene and diff checks PASS. Final documentation/metadata repack has612 runtime files byte-identical to the globally installed artifact used for the16 cloud checks; no SEA binary is included in the npm archive. Final fresh global-prefix installation and artifact smoke PASS. SHA256738dc309404b640188c65e93f8cad7a823db318a250a2380c185564b08333c43. Complete five-platform npm/native smoke runs are part of the tag workflow.

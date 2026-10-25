# Verification: CLI 0.5.1 public release

- Date: 2026-10-25
- Result: PASS for release delivery and fresh public-package acceptance. Local full-suite limitations are preserved below.
- Reviewed PR head: `9e35dfd8f017194184f4a1012214d26f72bc623a`.
- Actual merge and annotated v0.5.1 target: `8b4d9ad1ebf8b1329039bc292a3fe0ac1a32784f`.
- Owner: [Issue 153](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/153), [merged PR 154](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/154).

## Delivery gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Final PR CI | PASS | [Run 40183814695](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40183814695): Node 20/22 full tests and parity coverage, typecheck, installed package verification and installer |
| Actual main CI | PASS | [Run 40184194099](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40184194099), same five required jobs |
| Five binary platforms | PASS | [Run 40184565506](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40184565506): Linux x64/arm64, macOS x64/arm64 and Windows x64 |
| Existing draft publication | PASS | [Release v0.5.1](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.5.1), release ID 423320042, published 2026-10-25T10:26:22Z; no duplicate release or changed tag |
| npm workflow | PASS | [Run 40184777604](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40184777604) |
| Fresh official npm install and artifact smoke | PASS | Empty npm user/global config, fresh prefix/cache, official registry; version, terminal guidance, single JSON result, standard/native help and complete notices |
| Public archive integrity | PASS | All 12 assets present; npm release archive matches its SHA-256 sidecar and public npm SHA-512 integrity |
| Public installed bare-catalog cloud E2E | PASS | Fresh HOME, real public Git catalog, base TTL300, exec42, native CLI kill --yes, independent API GET404 and finally no owned resources |

## Local verification limits

The earlier default-concurrency local full run completed with **4271 passed, 76 failed, 57 skipped** (1802.59 seconds). Failures include CLI/PTY subprocess deadlines, intercepted raw HTTP/TLS/WebSocket loopback responses and a newer auto-discovered provider versus the fixture host version. They remain failures; do not describe the local full run as passing or infer that every failure has one proven cause.

The exact CI provider revision `de4fbf647966459feb57a35ab590b938024abe0e` resolved that fixture mismatch: **7 passed / 1 live-server skip**. The isolated malformed-HTTP/TLS cases still received injected 502 responses or failed trust/proxy expectations; a single ADV command still exceeded its existing 20-second deadline. No version, timeout or security check was weakened. Final exact-head PR and main CI passed their complete Node 20/22 suites in the required environment.

Targeted managed parser/native launch tests passed 78 assertions, and source/search/output tests passed 21. Final typecheck and scoped lint passed; full lint had 0 errors/274 existing warnings; repository health had 105 passes/11 warnings/0 failures. Candidate cloud success and earlier runner defects are preserved in the [candidate record](2026-10-25-cli-051-managed-catalog.md).

## Reproduce the public-package acceptance

```sh
npm install --prefix "$PWD/cli-acceptance" @agent-sandbox/cli@0.5.1 --registry=https://registry.npmjs.org
ABX_BIN="$PWD/cli-acceptance/node_modules/.bin/abx" node .agents/evidence/verify/2026-10-25-cli-051-public-release/public-catalog-launch.mjs
```

Supply Express credentials through the environment, never command-line arguments. The [runner](2026-10-25-cli-051-public-release/public-catalog-launch.mjs) uses a fresh HOME and the default public Git catalog without an override. It validates a single JSON launch result, executes `python3 -c 'print(6 * 7)'`, calls native `kill --yes`, and independently checks API absence. The fetched public YAML SHA-256 is recorded without credentials or sandbox IDs.

## Cleanup and scope

The runner reconciles only its own journal entries in `finally`; unresolved intents fail acceptance and retain the journal. No source-template rebuild or four-native cloud matrix is claimed by this release check. The published 0.5.0 package/tag and the earlier actual public-catalog failure remain unchanged.

Published npm archive SHA-256: `3c5bac30cedcb48ecea5b34d9ee3fcb43d2fb069ebff6c54a6bd5ce162ad1efa`. Both exact-version and latest public npm metadata returned version 0.5.1.

Public acceptance output (credentials, private endpoints and sandbox IDs omitted):

```text
PASS: public CLI 0.5.1 launched bare catalog name base with TTL 300 and empty initial cache
Public catalog SHA256: 8fcb10e223a4e592d3f4fa44069dcc966eeb91799cd768ce106470368f7acdd9
PASS: remote exec returned 42
PASS: CLI kill and independent API absence check
PASS: all owned resources independently absent
exit 0
```

[Machine-readable release evidence](2026-10-25-cli-051-public-release/release.json) records exact checks, asset names/sizes and integrity. Current installation examples and CHANGELOG now identify 0.5.1; default installer version remains determined by the website mirror manifest, without claiming an unexecuted mirror-installer rerun.

# Verification: Guided operation configuration

- Date: 2026-10-22
- Change: [Issue #99](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/99); [implemented decision](../../notes/implemented/feature/2026-10-22-guided-configuration.md)
- Result: PARTIAL — local full-suite baseline failures remain; implementation-commit CI, artifacts and recorded real-cloud checks pass. Final-head acceptance and release are tracked separately
- Source under test: implementation commit `8d7ed8e24b42e6a9c61588fa2668890aa5d31b61` on `fix/cli-guided-configuration-20261022`, based on `c8e8ad784323b8903505442cbc77d433a0d0367a`; final evidence and additional E2E follow in the same PR
- Binary/package under test: `@agent-sandbox/cli` 0.4.6 sources; a built Linux x64 Node SEA executable named `abx-0.4.6-linux-x64` for artifact and real guided-cloud verification
- Environment: Linux x86_64, Node.js v22.22.2, npm 12.0.2; real Alibaba Express service for standard lifecycle and guided-configuration runs. Credentials supplied by the task coordinator through an isolated credential harness; values, service host, region and private template names are not recorded

## What was verified

Operation-specific setup can collect temporary or persistent configuration, preserve Provider isolation and valid false/zero values, diagnose source problems, and continue using the same configuration in actual legacy/layered/profile consumers. Configuration command regressions cover real storage metadata, source precedence, cancellation, canonical migration failure, lossless dotenv handling, exported/multiline deletion, atomic legacy TOML replacement, and noninteractive modes. The real cloud standard suite exercised lifecycle, command and terminal behavior with owned-resource cleanup. The final SEA additionally passed real terminal hidden credential entry, operation-only scope without persistence, create continuation, no-stdin remote exec, kill, and independent HTTP 404 cleanup readback.

This receipt retains the completed final full-suite failure instead of replacing it with passing focused tests. Independent comparison reproduced the same 20 network failures on the unmodified base. The corrected PTY assertion passed in the final full run. The final standard-cloud repeat and complete three-suite offline run also passed. Exact npm-tarball installation and parity checks passed as recorded below. The implementation commit also passed all remote CI gates; final-head CI and publication remain separate gates.

## Commands run

Repository commands were executed from the owning checkout:

```bash
npm run typecheck
npm run lint
make typecheck
make lint
npm run check:hygiene
bash scripts/check-repo-health.sh --quiet
git diff --check

npx vitest run \
  tests/test_cli/test_config_commands.test.ts \
  tests/test_cli/test_config_init.test.ts \
  tests/test_cli/test_config_providers.test.ts \
  tests/test_cli/test_configuration_setup_regressions.test.ts \
  tests/test_cli/test_guidance_contract.test.ts \
  tests/integration/test_credential_priority_e2e.test.ts
```

The final full-suite run used `make test` (which invokes the repository test command); its actual failure counts appear below. Earlier implementation runs had additional failures and were superseded by this final run. The remaining failures are not reported as passing.

For real standard-cloud verification, the coordinator invoked `node e2e/standard.mjs` through a credential-isolating harness with `ABX_BIN` selecting `dist/binary/abx-0.4.6-linux-x64`. The harness supplied credentials in memory and an isolated HOME. `NODE_EXTRA_CA_CERTS` supplied the trusted audit CA while TLS certificate verification remained enabled. The private harness location and secret configuration are omitted. The equivalent public entry command, with those environment values already supplied, is:

```bash
ABX_BIN="$PWD/dist/binary/abx-0.4.6-linux-x64" node e2e/standard.mjs
ABX_BIN="$PWD/dist/binary/abx-0.4.6-linux-x64" node e2e/guided-configuration.mjs
# Set ABX_GUIDED_STEPS_SOURCE_TEMPLATE_ID to an existing verified public generation-2 ID.
ABX_BIN="$PWD/dist/binary/abx-0.4.6-linux-x64" node e2e/guided-template-steps.mjs
```

Additional final frontend/artifact gates were run through these repository entry points:

```bash
npx vitest run tests/test_cli_evidence/test_evidence_snapshots.test.ts
npx vitest run --config scripts/capture-cli-evidence.vitest.config.mjs --reporter=dot
npm run test:standard-provenance
npm run vendor:e2b
npm run vendor:e2b
npx vitest run tests/test_cli/test_template_onboarding_pty.test.ts
node scripts/check-release-artifact.mjs dist/binary/abx-0.4.6-linux-x64
ABX_BIN="$PWD/dist/binary/abx-0.4.6-linux-x64" npm run e2e:offline
```

## Results

| Scenario/check | Result | Observed outcome |
| --- | --- | --- |
| Type checking | PASS | `npm run typecheck` and final `make typecheck`, exit 0. |
| Repository ESLint | PASS with warnings | `npm run lint` and final `make lint`, exit 0; 0 errors and 252 warnings. Warnings are not represented as a warning-free run. |
| Hygiene | PASS | `npm run check:hygiene`, exit 0; no local paths or credential-shaped strings reported. |
| Repository health and documentation links/records | PASS with warnings | `PASS=105`, `WARN=11`, `FAIL=0`, exit 0. Warnings concern recommended configuration files/publish hooks and registered historical evidence. |
| Whitespace/diff check | PASS | `git diff --check`, exit 0. |
| Latest focused configuration/consumer collection | PASS | 6 files, 148 tests passed. Includes the final atomic-writer and multiline-deletion regressions. |
| Common operation-guidance contract | PASS, included above | 21 tests cover actual temporary/persistent consumers, same-named Provider fields, auth alternatives, stale adapter values, source/write errors, cancellation, and no action replay. |
| Configuration setup regressions | PASS, included above | 25 tests include real command storage/readback, explicit deletion, required false/zero values, lossless serialization, failure preservation and machine-mode input policy. |
| Existing credential-priority integration | PASS, included above | 7 tests; explicit project dotenv paths are preserved and IDE registrations do not embed Sandbox keys. |
| Final full suite | FAIL — identical baseline failures | 178 files: 172 passed, 6 failed. 4,237 tests: 4,215 passed, 20 failed, 2 skipped. The corrected PTY assertion passed. Independent verification reproduced all 20 remaining network/HTTP/TLS/WebSocket failures with identical test names and first errors on the unmodified base. |
| Independent unchanged-base comparison | PASS | Base `c8e8ad7`, the same 6 files and 58 tests: 38 passed, 20 failed. All 20 failed test names and first errors matched the implementation run; no additional failure appeared in the implementation comparison. This comparison does not turn the local full suite green. |
| Built SEA real standard-cloud lifecycle | PASS | Harness exit 0. Detached creation, stdout and remote command-failure behavior, template listing, stateful PTY, connect retention, expiry, kill and cleanup all reported PASS. Post-terminal lease shortening respects the backend minimum. |
| Final-source SEA executable | PASS | Built artifact SHA-256 `919cb326a7d75ccdb17b70b1ccbbf51e76a32d3fffdb6b220df538e56fa6ce33`; version 0.4.6. |
| CLI snapshots and evidence capture | PASS | 117 snapshot tests passed. Capture ran 116 cases, skipped 0, and wrote 17 current evidence files. Historical evidence is preserved. |
| Standard provenance and reproducible source replay | PASS | 7 provenance tests passed. Two locked vendor replays produced identical runtime SHA-256 `a48dc129725a924de858310d3ba36cef0e61024280dc748202a21b252112c770`. |
| SEA offline subset | PASS with skip | 65 passed, 1 skipped. This subset is included in the separately completed three-suite offline result below. |
| Template onboarding PTY and installed-artifact gate | PASS | 6 PTY tests passed. The actual SEA artifact gate passed version, isolated guidance, single JSON result, root/standard/native help and dependency notices. |
| Real interactive guided cloud workflow, final SEA | PASS | Real terminal input was hidden; only-this-command configuration left no persisted credential. Create continued, remote exec returned expected output using explicit no-stdin input, kill succeeded, and a separate service GET confirmed HTTP 404 after cleanup. Harness exit 0. |
| Complete three-suite offline run | PASS with skip | `e2e:offline` completed all three selected suites: 81 passed, 1 skipped, 0 cloud sandboxes created, 0 leaked. The leak check is skipped because these suites create no cloud sandboxes. |
| Final rebuilt SEA standard-cloud repeat | PASS | The final SEA with the recorded SHA-256 repeated all standard lifecycle/command/PTY/connect/expiry checks and cleanup successfully; harness exit 0. |
| Implementation-commit CI | PASS | Node 20/22 full tests and parity, typecheck/lint, installer, package/provenance and Markdown links passed on `8d7ed8e`. Final evidence/E2E head is checked separately before merge. |
| Real platform-steps deploy | PASS | A verified public generation-2 source first passed real create/exec/kill and independent HTTP 404. The SEA deployment process had only AccessKeys, no Sandbox key or ACR configuration, and an empty local-tools PATH. Registration reached ready, a new sandbox contained the exact RUN marker, and both sandboxes plus the uniquely owned template were deleted with independent HTTP 404 and final alias-inventory absence. |
| Merge, release and installer delivery | NOT YET VERIFIED | No merge or publication success is inferred from local checks or the implementation-commit CI. |

## Independent review

A dedicated review agent remained separate from implementation throughout three rounds. Round 1 checked the command/configuration inventory and ownership contracts. Round 2 exercised actual CLI, terminal and file behavior and closed scoped-key, same-name Provider field, source-precedence, MCP-target and standard E2B-state findings. Round 3 repeated negative probes, real MCP STDIO initialize, cancellation/secret handling and multiline dotenv cleanup, then reviewed the final diff and the cloud harness resource/credential boundaries. No reported implementation blocker remains. This internal review is separate from required GitHub checks or any repository-required human review.

The final platform-steps harness SHA-256 is `b0bce02529074237536b21c2211513af0be031c8e86d53b9d16aca27b6e36d50`. It preserves generation, image, resources and runtime commands from the verified public source. It resolves runtime aliases before ownership checks, filters returned inventory on the client, validates IDs before CLI use and never replays a submission. Failed cleanup preserves only owned references in a mode-0600 recovery state file. The successful run removed its temporary directories.

## Publication-candidate checks

The implementation was committed as `8d7ed8e24b42e6a9c61588fa2668890aa5d31b61` and pushed through [PR #100](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/100). The implementation commit passed [CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39722294352) (Node 20/22 full tests and parity, typecheck/lint, installer, package and pinned-source replay) and [Markdown links](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39722294295). Final evidence/E2E changes require their own current-head checks before merge. This is not a merge or release claim.

- The exact `npm pack` tarball was installed into an isolated global prefix. `node scripts/check-release-artifact.mjs <installed-abx>` passed for version 0.4.6, configuration isolation, machine output, command help and notices.
- `npm run parity:coverage` passed all **907** CLI ledger contracts, with zero failed/skipped contracts and zero missing contracts. All 11 entries moved to the Python SDK were verified in that checkout. This gate reports ledger coverage; its underlying Vitest run still encounters the 20 independently reproduced baseline transport failures.
- Two intentionally changed contracts are explicitly mapped in `parity/changed-contracts.json`: temporary credential scope replaces implicit saving, and plan-aware build owns the namespace requirement. The historical ledger is preserved. The mocked CLI integration suite supplies explicit placeholder configuration and all 10 tests pass.
- After moving the generated, ignored parity report out of the checkout, repository health again returned **105 PASS / 11 WARN / 0 FAIL**, and hygiene passed. The generated report itself contains local test paths and is not a deliverable.

## Cleanup

Focused tests use isolated temporary homes, placeholders and filesystem fixtures. They make no real cloud changes. Temporary operation-scope tests verify that no user dotenv/TOML files or credential environment mutations escape the action. Failed atomic writes remove temporary replacement files and preserve the previous configuration; cancellation does not start the action.

The real standard suite reported successful kill and complete cleanup of its own created sandboxes, including terminal/expiry cases. Its final result was successful and the coordinator's harness returned exit 0. No private resource identifiers are retained in this receipt. The final guided-cloud suite also used a `finally` cleanup: the owned sandbox was killed and a separate authenticated GET returned HTTP 404. It verified that no credential files were persisted. The two preliminary guided probes likewise ran their cleanup despite their stdin-harness failures. The platform-steps run separately verified absence of its source-check sandbox, marker sandbox and unique template; no owned resource remains. A preliminary source-check cleanup probe exposed a runtime-template alias versus actual-ID difference; it was resolved read-only, then that exact owned sandbox was killed and returned HTTP 404. The helper now handles canonical references explicitly, and the recovery directory was removed.

## Problems found

- Supplementary real platform-steps verification first preserved a known public source's generation 1. CreateTemplate explicitly rejected it with HTTP 400 / `InvalidParameter` (E7010): platform steps require generation 2. Two unique failed aliases were subsequently absent from the official inventory and returned HTTP 404 from the standard template query; no sandbox was submitted in those runs. The test now checks that prerequisite before any write, and the bilingual guidance records it. A source must be an actually verified existing public generation-2 template; neither generation nor image is silently changed. This API constraint does not become a credential prompt or mutation replay.

- The full local suite remains nonpassing in the latest completed run. Its failure counts are retained above; independent unchanged-base comparison reproduced the same 20 network-audit/proxy/TLS/WebSocket failures with matching names and first errors.
- Two preliminary guided-cloud probes inherited a stdin pipe: the remote command produced its expected output, but the frontend's subsequent close-input request returned HTTP 404 and failed the probe. Both probes cleaned up in `finally`. The final harness explicitly used `stdin=DEVNULL` for its intended no-stdin exec path and passed. This result does not certify every piped-stdin variant.
- ESLint and health checks report warnings; neither is described as warning-free.
- Multi-field configuration persistence is not transactional. An individual destination write is atomic, and diagnostics distinguish incomplete batch/previous-copy cleanup rather than claiming all-or-nothing success.

## Not verified

Pending at freeze: final-head CI, merge state, package publication and website installer delivery. General Docker/ACR builds, private-image publication, LLM external accounts and every third-party cloud Provider were not exercised live by this verification; their owned guidance contracts were tested with isolated fixtures, not certified as real cloud execution. Final SEA guided-cloud, repeated standard-cloud and complete offline verification are complete as recorded above. No skipped or pending check is counted as a pass.

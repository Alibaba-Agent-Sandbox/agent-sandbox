# Verification: public managed catalog resolution

- Date: 2026-10-25
- Change: [Issue 153](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/153)
- Result: PARTIAL — candidate cloud E2E passed; full local run has subprocess timeouts and publication gates are pending.
- Candidate: CLI 0.5.1, scoped patch over released `408e618f38c11e5df98f0e6fb859465060f4fdb8`.
- Environment: Linux x64, Node.js 22; real Express credentials supplied only through environment variables.

## Previous public release and defect

CLI 0.5.0 was published through [binary workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40180261740) and [npm workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40181040899). Public version metadata and latest resolved to 0.5.0; a fresh official npm installation passed `scripts/check-release-artifact.mjs`. All 12 release assets were present. The npm archive matched its SHA-256 sidecar and public npm SHA-512 integrity.

The subsequent actual public-catalog `template launch base` failed with exit 4 before resource creation. Read-only search omitted `base`; the parser consumed only the 46 source entries and skipped the four entries in `managed_templates`. Earlier local-manifest and synthetic-entry tests did not cover this integration. No owned resources or unresolved resource intents remained. The first test runner withheld stderr, so its exit code alone was not a root-cause diagnosis; catalog and parser inspection established the omission.

## Candidate checks

The fixture is the exact [published catalog revision](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/45eb6c40b8d40e8ae1799420631cec1f5cb2f832/awesome-templates.yaml), including both lists, with no fabricated repositories for managed rows.

| Check | Result | Scope |
| --- | --- | --- |
| Parser + launch regressions | PASS, 78 tests | Both lists; four native IDs; cached YAML; single JSON result; no source fetch/prepare |
| Search and install commands | PASS, 20 tests | Four native names searchable; native source installation suggests launch |
| Cache | PASS | Cache stores raw YAML and is re-parsed, no format migration |
| Typecheck/build | PASS | Initial candidate |
| Full suite | In progress with failures | Default-concurrency ADV command/PTY subprocess cases exceeded their existing 20-second limit during concurrent filesystem-heavy checks; isolated rerun pending, not counted as pass |
| Final lint/health | Pending | Dependency symlink removed; temporary dependency copy moved outside repository |
| Actual public Git catalog → Express | PASS | Bare `base`, isolated empty home, TTL 300; exec 42; CLI kill --yes; independent GET 404 |
| PR/main CI, binaries, public npm | Pending | Must complete before reporting 0.5.1 published |

First candidate cloud launch returned exit 0 and created the sandbox. The launch resolver emitted a success diagnostic to stdout before the final result, breaking the OutputManager single-document JSON contract; the runner failed before exec and its finally block independently confirmed cleanup. A temporary multi-value parser allowed remote exec 42 but masked this defect. Review of the existing output contract caught it: lookup diagnostics now use stderr, and regression/cloud runners require JSON.parse of the entire stdout. The intermediate CLI kill was aborted because the runner omitted the native command’s --yes confirmation; cleanup still independently confirmed absence. The final runner passes --yes explicitly. A second invocation overlapped a dist rebuild and failed at version lookup before create; the corrected retry starts only after build completion. These partial runs are not counted as an E2E pass.

## Reproduction

Install dependencies from the lockfile and run `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, and `bash scripts/check-repo-health.sh`.

Supply Express credentials through the environment and set `ABX_BIN` to the candidate or freshly installed public CLI, then run:

```sh
node .agents/evidence/verify/2026-10-25-cli-051-managed-catalog/public-catalog-launch.mjs
```

The runner uses the default public Git catalog, with no index override. It launches bare `base`, executes `python3 -c 'print(6 * 7)'`, kills the sandbox, and independently checks API absence. It captures stderr in memory and masks credentials, private hosts and temporary paths before error reporting.

Final strict-JSON candidate run passed all four assertions: public catalog launch, remote result 42, CLI kill plus independent absence, and journal-based cleanup. Credentials and sandbox identifiers were not recorded.

## Cleanup and limitations

Cleanup runs in `finally` using the task's resource journal; only task-owned resources may be deleted. Unresolved resource intents fail the run and retain the journal. Public 0.5.0 artifacts and tag remain unchanged. This patch does not rerun the 46-source-template cloud matrix or claim runtime validation of the other three native providers/templates.

Current bilingual installation documentation also reflects the verified public Python client/server 0.4.0a1 alpha while retaining explicit source pins used by scaffold and MCP generation. Historical reports are unchanged.

# Verification: Shortcut help patch release

- Date: 2026-10-21
- Result: PARTIAL (remote CI and release validation pending)
- Package: @agent-sandbox/cli 0.4.2; Node.js 22.22.2; Linux.
- Source change: 2551954, plus patch version metadata, immutable version capture,
  artifact help assertions and this delivery record.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/91

## Authorization and scope

The user requested pushing the existing correction through CI testing and release,
and identified the workspace `.env` as the GitHub credential source. Authentication
was verified in memory. No credential values are copied to files, argv or logs.
The published v0.4.1 tag is preserved; this contribution uses a new v0.4.2 patch.
Continue using the repository Issue-to-merge and change-record skills.

## What was verified

The previous [local verification](2026-10-21-shortcut-help-descriptions.md) and
[help capture](../cli/2026-10-21-shortcut-help.md) remain historical. The initial
GitHub blocker is resolved using the user-provided credential source. Public
Issue/PR searches found no matching contribution; Issue #91 now tracks delivery.
The release artifact checker additionally verifies create and registered-run
purpose text before their canonical alias notes on installed npm and SEA builds.

## Commands and results

- Authenticated GitHub API user/repository reads: PASS; push access confirmed.
- Current default branch: main at 3e86e7a2b790365d12fa30dd4f3736d2fe50a154.
- Latest published release before this contribution: v0.4.1.
- `ABX_UPDATE_EVIDENCE=1 npm test -- tests/test_cli_evidence/test_evidence_snapshots.test.ts -t 'test_evidence_snapshot \[version\]'`: PASS, 1 version capture; 116 intentionally filtered tests.
- Patch version and root lock package both become 0.4.2; historical captures remain intact.

- `npm run build`: PASS, exit 0.
- `npm test -- tests/test_cli/test_command_surface.test.ts tests/test_cli_evidence/test_evidence_snapshots.test.ts`: PASS, 128 tests, exit 0.
- `npm pack --pack-destination <candidate-directory>` and global installation
  of the exact 0.4.2 tarball into an isolated prefix: PASS, exit 0.
- `node scripts/check-release-artifact.mjs <installed-abx>`: PASS, exit 0;
  real installed version, shortcut purpose/alias output, standard/native help,
  a non-help config read and complete license text all verified.

## Delivery gates

Push a scoped branch and create a PR against main. Verify current-head Node20/22,
typecheck/lint, package build/provenance, installer and Markdown checks before
merging without bypass. Tag only the verified merged source. Wait for all five
platform binary checks and checksum assets in the draft Release before publication.
Publishing the Release must trigger the npm publisher, including exact-tarball
installation and public-registry reinstallation. Record failures instead of
reporting a queued/pending job as a pass.

## Cleanup and limits

Only local help/package/binary behavior is affected; no cloud sandbox or template
is needed for this correction. No cloud resource was created. Full real-cloud and
Python-oracle parity are not claimed. Host-local transport failures documented
in the earlier evidence remain unchanged; remote CI is the authority for this
publication. Remote CI, merge, assets and npm publication remain pending here.

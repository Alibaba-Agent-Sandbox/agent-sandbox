# Verification: release contract recovery

- Date: 2026-10-23
- Result: PASS for local installed-artifact/helper/workflow regressions; current-head CI, merge and actual publication remain separate gates.
- Source: patch on d77b9455b6e619b4a07b99ec56cf9dcb696c21fa; package candidate 0.4.8.
- Environment: Linux, Node 22.22.2. No cloud credentials or remote cloud mutations needed for parser/packaging verification.

## Trigger

All five v0.4.7 platform builds stopped on the obsolete --official-api assertion in the installed npm artifact gate: [failed run](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39888718908). No GitHub Release or npm 0.4.7 was published. The failed tag is retained unchanged. [Issue #111](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/111) tracks delivery through public readback.

## Executed checks

| Check | Result |
| --- | --- |
| Actual npm pack, global installation into a private temporary prefix, check-release-artifact.mjs against installed bin | PASS: version 0.4.8, isolated guidance, one JSON result, root/standard/native help and complete notices |
| Current help/version captures | PASS: three new captures; merged earlier evidence preserved |
| Native entry, snapshots and both deployment helpers through the actual built parser | PASS: 123 tests across 3 files; helper invocations append help, never build/deploy cloud resources |
| Release workflow actual shell/identity/checksum/diagnostic guards | PASS: 25 tests; wrong-version, wrong-name, missing and multiple candidates rejected |
| npm run typecheck; npm run lint | PASS: zero type/lint errors; existing lint warnings retained |
| bash -n scripts/build_hermes.sh scripts/deploy_all_templates.sh; git diff --check | PASS |

The candidate npm install resolved 111 runtime dependencies; one dependency install script was blocked by local npm policy, and the actual installed-artifact check still passed. No bypass or dependency-source change was applied.

## Corrections and follow-through

Installed-artifact smoke now runs in normal package CI before tag creation. The release publisher retains contents-read/OIDC permissions; a separate needs-publish contents-write job downloads the exact tested npm candidate, validates its version/name/cardinality, writes SHA-256 and uploads both files for the website mirror. An actual-shell regression caught the initial `errexit`/AND-list cardinality pitfall; separate fail-fast assertions now reject ambiguous candidates.

Native list/info help explains its current AccessKey contract, standard listing remains distinct, and helper scripts pass explicit Express selection and subcommand-local region without retired flags. A real parser intercept validates both scripts without performing deployments.

## Boundaries

No new Codex Docker/ACR run, template qualification, backend API behavior or error-reporting implementation is claimed. The prior actual Express create/exec/owned-cleanup readback is preserved in [command recovery evidence](2026-10-23-command-recovery-review.md). These packaging/help changes use real installed components and do not need unrelated cloud mutations.

This pre-merge evidence does not claim that final CI, five platform binaries, npm publication or website delivery already completed. Their exact results and URLs are recorded in the PR and Issue #111 before closing delivery.

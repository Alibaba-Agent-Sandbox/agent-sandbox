# Verification: shared CLI shell and response formatting primitives

- Date: 2026-10-26
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/191
- Result: PASS for the scoped local and real-cloud checks; remote CI/review is checked separately before merge.
- Tested source: base `6bf637fcbbc2daa3717477e127ace68b0931a347` plus the exact eight source/test files and SHA-256 hashes in [the receipt](2026-10-26-shared-cli-primitives.json).
- Binary: Node.js entry built from this candidate with `npm run build`; package version remains 0.5.6. This is source acceptance, not publication of a new npm or SEA release.
- Environment: Linux x64, Node 22.22.2, real configured Alibaba Express control/data planes. The region was not independently measured; the configured API target and credentials came from ignored environment input, with values omitted.

## What was verified

Three identical POSIX literal renderers share one implementation. The identical float formatter and MCP response constructors forward to their existing owners, retaining import paths and output contracts. Twelve real `/bin/sh` round trips preserve empty strings, quotes, whitespace, Unicode and shell expansion syntax. Existing generated-command and MCP tests remain passing. The real CLI STDIO run created a matching 2-CPU/2048-MiB sandbox, verified independent metadata and files, exercised durable task commands and working directories containing single quotes and spaces, then confirmed owned resource absence.

## Commands run

- `npm ci`: PASS using the repository lockfile; no dependency files changed.
- `ABX_SERVER_SDK_SRC=<server-sdk-src> PYTHON_SDK_ROOT=<python-sdk-checkout> ABX_AWESOME_PROVIDERS=<provider-checkout> make ci`: PASS, using the same external-fixture variables as repository CI.
- `npm run build`: PASS after removing the type import made unused by consolidation.
- `npm run lint`: PASS, zero errors and 275 existing warnings after that cleanup.
- `node --check e2e/mcp-lifecycle.mjs`: PASS.
- `npx vitest run tests/test_utils/test_shell.test.ts tests/test_agent/test_mcp.test.ts tests/test_agent/test_mcp_http.test.ts tests/test_agent/test_workflow_reliability.test.ts`: PASS, 121 tests after the final source cleanup.
- `node e2e/mcp-lifecycle.mjs`: PASS with authorized credentials supplied only through the environment, after the build completed.
- `bash scripts/check-repo-health.sh --quiet`: PASS, 105 checks, 11 existing warnings, zero failures.
- `npm run check:hygiene` and `git diff --check`: PASS.

## Results

| Check | Result | Detail |
| --- | --- | --- |
| Full unit suite | PASS | 205 files; 4,562 passed, two existing skips |
| Python parity ledger | PASS | 907/907 passed; 11 moved Python tests verified present |
| Typecheck/build/package/hygiene | PASS | Full local CI, including npm package entry and Skill reference closure |
| Literal POSIX shell arguments | PASS | 12 actual shell executions; expansion syntax remains literal data |
| MCP cloud lifecycle and quoted durable task | PASS | 18 checks in the receipt, including independent resource metadata and post-delete inventory |
| Existing output contracts | PASS | Full tests and parity preserve generated command text and JSON-RPC shapes |

## Cleanup

The passing cloud run destroyed exactly its owned sandbox, and a separate SDK inventory read confirmed that exact raw sandbox ID absent. The existing test closes both MCP processes and removes their temporary homes. A read-only check after the earlier failed attempt also returned an empty account inventory. No broad cleanup operation was used.

## Problems found

An offline dependency-install attempt failed because the npm cache was incomplete; normal lockfile installation succeeded. An initial local CI run passed its tests with 57 skips but failed parity because server/provider fixture paths were absent. Repeating with the repository CI fixture variables passed all 907 ledger entries and reduced skips to the existing two.

The first MCP cloud attempt failed its create check while local CI was rebuilding `dist`. Its existing runner suppressed the create-error details, so the cause is not established. Authentication and a read-only list then succeeded with no visible sandboxes. Rebuilding once, stopping build mutations, and running the expanded acceptance against the stable output passed all 18 checks. The failed attempt is not counted as passing evidence.

## Not verified

Local checks used Node 22; the PR's Node 20/22 matrix must pass separately. No source-template Docker/ACR build, provider/model matrix, Windows POSIX-shell execution, package release or deployment was performed. These primitives preserve behavior and do not certify unrelated backends or templates.

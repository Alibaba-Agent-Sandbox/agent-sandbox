# Verification: MCP client distribution

- Date: 2026-10-16
- Change: proposed MCP client distribution note; overlaps existing PR #23.
- Result: BLOCKED
- Binary / package under test: `@agent-sandbox/cli` 0.3.0, built with TypeScript from the working tree.
- Environment: Linux, Node 22.22.2; npm 10.9.4 used as an isolated task tool because system npm 12.0.2 fails at startup. Credentials: placeholders only; no credential files read by these checks.

## What was verified

`abx mcp deploy` generates `requirements.txt` with `agent-sandbox-client[mcp]`
and `uvicorn>=0.29`. The Python client's project metadata declares this distribution
and the MCP extra. The import namespace stays `agent_sandbox`.

## Commands run

- `npm ci --ignore-scripts --no-audit --no-fund` (isolated npm 10 after system npm failed).
- `node node_modules/vitest/vitest.mjs run tests/test_cli/test_mcp_commands.test.ts`
- `node node_modules/typescript/bin/tsc -p tsconfig.build.json`
- `ABX_BIN="node /mnt/anyenv/workspace/agent-sandbox/dist/bin/abx.js" node e2e/run.mjs --suite offline --filter mcp-deploy-client-requirements --json /tmp/abx-mcp-e2e.json`
- `node scripts/capture-cli-evidence.mjs --command mcp` (task npm/npx on PATH).
- `make test lint typecheck` (task npm on PATH; stopped after test failure).
- `make lint typecheck` (task npm on PATH; separately executed to avoid test failure short-circuit).
- A follow-up Vitest run selected the 14 failed files, removing inherited HTTP/HTTPS/ALL proxy variables only from that child process; after confirming the platform refusal it was interrupted (exit 130).
- `bash scripts/check-repo-health.sh --quiet`
- `npm run check:hygiene` (task npm on PATH).
- `ABX_UPDATE_EVIDENCE=1 node node_modules/vitest/vitest.mjs run tests/test_cli_evidence/test_evidence_snapshots.test.ts -t mcp`
- `npm pack --dry-run --json --ignore-scripts` (task npm on PATH).
- `git diff --check`
- Public package metadata HTTP GETs to `https://registry.npmjs.org/@agent-sandbox%2fcli` and `https://pypi.org/pypi/agent-sandbox-client/json`.

## Results

| Scenario / test | Result | Notes |
|---|---|---|
| MCP command unit tests | PASS | 31 tests. Includes generated requirements content regression. |
| TypeScript production build | PASS | Built real CLI entry point. |
| MCP deploy black-box artifact regression | PASS | Real process/filesystem; exact requirements and app/config file presence. |
| MCP CLI evidence capture | PASS | 3 capture cases, zero skipped. Golden refresh: 9 MCP snapshots passed, 101 unrelated cases filtered. No golden changes. |
| Local npm package contents | PASS | `dist/bin/abx.js` present and mapped by `bin.abx`; this does not prove registry installation. |
| Full unit suite, inherited environment | FAIL | 14 failed / 139 passed files; 38 failed / 3746 passed / 1 skipped tests. 340.71 s. Follow-up run of the 14 failed files reproduced the platform HTTP 501 rejection and was stopped (exit 130); no further retries. |
| Lint / typecheck | PASS | ESLint: 0 errors, 221 warnings; TypeScript strict typecheck passed. |
| Repository health | FAIL | PASS=95, WARN=5, FAIL=10. Existing URL/dependency checks, Python parity scripts, missing examples, stale links/ADRs, en/zh page mismatch, local-path findings. No finding in the changed files. |
| Source hygiene | PASS | No local paths or credential-like strings found. |
| Whitespace check | PASS | `git diff --check`. |
| Public npm CLI metadata | BLOCKED | HTTP 404 Not Found; package cannot be installed from the public npm registry. |
| Public Python client metadata | BLOCKED | HTTP 404 Not Found; generated deployment requirements cannot be installed from public PyPI yet. |

## Cleanup

The black-box harness used its isolated temporary filesystem and cleaned it on exit.
No cloud resources were created; created=0, leaked=0. The leak-check scenario skipped
with reason "no cloud sandboxes were created"; no claim of cloud cleanup verification.

## Problems found

- System `npm ci` failed before dependency installation: `Class extends value undefined is not a constructor or null`.
  An isolated npm 10 installation allowed dependency installation without changing the system toolchain.
- An initial black-box invocation used a relative CLI entry path and failed after the harness changed cwd.
  The rerun with an absolute entry path passed.
- Both required public package endpoints returned HTTP 404.
- Local HTTP/RPC fixture requests were rejected with HTTP 501 and the exact response `项目网络审计已关闭`; engine, cubesandbox and transport assertions consequently fail. Removing inherited proxy variables for the follow-up test process still reproduced this platform response. No platform permission or network configuration was changed.
- Template install tests fail with `Docker not found in PATH. Install Docker or start Docker Desktop.`
- The archive extraction regression expects directory modes 0755 but observes 0700; FORCE_COLOR/NO_COLOR stderr and Python-oracle fidelity tests also fail. These are outside the requirements-name change.
- The original package-name source/doc correction and a unit regression already exist in open PR #23;
  merge the added black-box scenario and verification records into that existing change.

## Not verified

Clean PyPI installation and an FC-hosted MCP service could not be verified because the
client distribution is unavailable on public PyPI; local network fixtures also received
the platform HTTP 501 rejection described above. No real-cloud MCP deployment or
cloud regression suite ran in this subtask. Keep the decision proposed and report this
work as in progress until package availability and repository-required real-cloud checks pass.

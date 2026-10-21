# Verification: CLI onboarding

- Date: 2026-10-21
- Base: 8cac4d85d92a722809d887df4d738e0666ff35a1
- Result: PARTIAL (local product acceptance passes; remote CI/release pending)
- Package under test: @agent-sandbox/cli 0.4.3, Node.js 22.22.2, Linux.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/93

## Behavior

Provider is grouped with peer commands. Root help links the template Registry
and gives a runnable scaffold/deploy sequence. Local project preparation and
replacement consent run before file writes or provider deployment. Legacy
standard create options retain parser failure with corrected guidance.

## Commands and results

- `npm ci --no-audit --no-fund`: PASS, exit 0; lockfile install.
- Regressions against unchanged 0.4.2 source: expected failure, 11 failed and
  3 passed; demonstrates the prior defects.
- Final focused onboarding, terminal, command-surface and snapshot checks:
  PASS, 143 tests.
- `npm run typecheck`, `npm run build`: PASS, exit 0.
- `npm run lint`: PASS, exit 0; zero errors, 253 existing warnings.
- Full `npm test` without external fixtures: 4081 passed, 11 failed, 56 skipped;
  ten host transport failures plus initial terminal harness line-wrap failure.
- Full `npm test` with server/provider fixtures: 4126 passed, 20 failed,
  2 skipped. The terminal regression passes; ten host transport failures and
  ten fixture/network failures remain (engine/cubesandbox responses include
  HTTP 501 with project network auditing disabled). Transport/provider code
  is unchanged. Remote Node 20/22 checks must pass before merge.
- Final `node e2e/onboarding.mjs` and terminal Vitest wrapper: PASS. Three real
  terminal/filesystem cases create a selected project and stop for review,
  preserve originals on decline, and replace template files on confirmation.
- Offline E2E filtered to root help, legacy flag guidance, missing projects and
  overwrite consent: PASS, five scenarios. Leak check skipped because no cloud
  sandboxes were created.
- `npm pack`, isolated global installation and
  `node scripts/check-release-artifact.mjs <installed-abx>`: PASS. Version 0.4.3,
  help, notices, missing-project guidance and overwrite controls verified.
- Parity report reused from the full fixture run: 881 pass, zero failed/skipped,
  26 existing integration entries missing; 11 moved entries verified.
- Help evidence capture: PASS, 43 cases, zero skipped; see
  [dated capture](../cli/onboarding-20261021/cli/help.md).
- `make dist-check`, `npm run check:hygiene`, `git diff --check` and
  `bash scripts/check-repo-health.sh --quiet`: PASS, exit 0.

## Findings and corrections

The artifact regex initially violated a repeated-space lint rule and was fixed.
PTY default columns split a prompt marker; the harness now sets dimensions and
handles prompt/exit races. Repository health rejects Python source files, so
the POSIX acceptance uses an MJS entry with Python stdlib code inline. The
actual-terminal scenarios and wrapper pass after those corrections.

The ten host transport failures match the previously verified baseline:
refused TCP/error text, HTTP parsing, TLS stores, proxy and WebSocket semantics.
All local failures and skips remain disclosed above, not counted as passes.

## Cleanup and limits

Only local files/test directories are created. No cloud sandbox or template is
needed for this correction. Remote CI, release and official mirror acceptance
are pending. npm registry publication has an independently documented access
blocker in https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66;
never claim that channel published unless its actual workflow succeeds.

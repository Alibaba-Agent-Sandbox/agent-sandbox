# Verification: Template project auto-creation

- Date: 2026-10-21
- Base: dc17b8c0109a398a9a88d616bd35758bf27d4ea6
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/97
- Package: @agent-sandbox/cli 0.4.5, Linux x64, Node.js 22.22.2.
- Result: PARTIAL (local behavior/artifact acceptance passes; remote CI/release pending)

## Behavior and scope

Missing projects can be created inline and the original build/deploy continues.
Yes/CI selects Python; interactive creation honors the selected case. Alias,
timeout and provider dispatch options survive. The shared scaffold writer keeps
overwrite protections and suppresses intermediate results during deployment.
Only CLI-local preparation/dispatch and metadata/docs change; no cloud backend
implementation or standard create contract changes.

## Executed checks

| Check | Actual result |
| --- | --- |
| `npm ci --no-audit --no-fund` | PASS, exit 0, lockfile installation |
| Initial regressions against unchanged 0.4.4 | Expected failure: 14 failed, 10 passed; batch rejection and stop-for-review reproduced |
| Onboarding regressions after fix | PASS, 27 cases |
| Focused onboarding/template/deploy checks before final three added cases | PASS, 137 cases |
| `npm run typecheck` | PASS, exit 0 |
| `npm run lint` | PASS, zero errors, 253 existing warnings |
| `npm run build` | PASS, exit 0 |
| Full `npm test` | 4095 passed, 10 failed, 56 skipped; failures match the prior host transport baseline |
| Updated active/version evidence | PASS, 117 snapshot cases; historical captures preserved |
| `node e2e/onboarding.mjs` | PASS, three real-terminal/filesystem scenarios |
| Filtered offline E2E | PASS, four scenarios; leak check skipped because no cloud sandboxes were created |
| Packed and globally installed npm artifact | PASS, installed 0.4.5 checker succeeds normally and with CI=true |
| Actual Linux SEA | PASS, built 0.4.5 executable checker succeeds normally and with CI=true |
| Help capture | PASS, 43 cases, zero skipped; dated capture linked below |
| Reused full-run parity report | 875 pass, six skipped server-SDK guide checks, 26 existing excluded integration entries missing, 11 moved entries verified |
| `make dist-check` | PASS, package entry point present |
| Record health | PASS, 105 checks, 11 historical/recommended-file warnings, zero failures |
| Hygiene/diff gates | PASS after rewording slash-separated prose that resembled a home-directory path; no allowlist exception |

## Actual component acceptance

The real terminal confirms creation, selects a case, writes a real project and
continues into the original provider credential preflight. It then stops with the
expected missing-credentials error in the isolated environment. Rejecting scaffold
replacement preserves originals; confirming replaces template files and keeps
unrelated data. The installed package and SEA independently verify yes and CI
creation, generated manifest/Dockerfile/commands, one-result JSON and retained
overwrite protection. Credential variables, home directory and working directory
are isolated, so these checks
cannot deploy to a real account. Provider continuation and parameter preservation
are also observed through the existing CLI composition boundary with a recorder.

## Failures, skips and limits

The ten local failures match the previous run: refused-TCP/error text, HTTP response
parsing, TLS trust stores, HTTP proxy and WebSocket semantics. Transport code and
assertions are unchanged. The optional server/provider fixture checkouts are not
supplied to this local run; remote CI supplies them. Skips and failures are not
claimed as passes. Current-head Node 20/22 remote checks must pass before merge.

No real cloud build/registration is claimed; the changed behavior is local project
creation and continuation into the existing provider workflow. Remote publication,
five-platform builds and official mirror/default-installer acceptance are pending.
npm publication has the independent E404 blocker in
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66.

## Cleanup and capture

Temporary local project directories are removed. No cloud sandbox/template was
created and none leaked. Credentials are excluded from records and artifacts.

- [Dated help capture](../cli/autocreate-20261021/cli/help.md)

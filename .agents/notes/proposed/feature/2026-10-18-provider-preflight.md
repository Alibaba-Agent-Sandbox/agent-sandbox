# Decision: Reject unsupported provider work before side effects

Status: proposed

## Problem
resumeConnect swallowed permission/conflict/quota/server failures and could return
successful metadata instead. Native PTY lacked its declaration check. Internal
Express deploy and natural-language deploy checked ownership after reading project,
credentials or invoking generation. These fixes must reach main independently of
the conditional standard migration feature.

## Decision
Only404/405 allow legacy resume fallback. Check PTY before wire/session access,
Express template ownership before config/files, and the generation/deploy adapter
before any model/workspace activity. Preserve existing valid command/API contracts.

## API Design
Failures remain typed and keep backend status. Declared template features alone do
not authorize Express FC/ACR handlers. No conditional capability is enabled.

## Alternatives considered
Waiting for unrelated migration prerequisites leaves confirmed bugs on main.
Treating every HTTP error as an unsupported endpoint masks real service failures.

## Dependencies
Current mainad704f41; SDK counterpart uses the same PTY declaration rule.
Refs https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/33
and https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/36.

## Test Strategy
Reproduce eight failures before the fix; test real HTTP denial/no-fallback,
feature/ownership preflight and actual installed provider/CLI/filesystem. Run full
maintained checks and real available Express read/lifecycle/exec/file/server paths.

## Acceptance criteria
Ten scoped regressions and installed-provider probe pass; available Express scenario
passes with no leaks; latest-head ordinary CI and merge gates pass. Pause/snapshot
activation is independent and is not claimed by this fix.

## Evidence
[Verification](../../../evidence/verify/2026-10-18-provider-preflight.md).

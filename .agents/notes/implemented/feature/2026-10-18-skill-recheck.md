# Decision: Close Skill installation and lifecycle verification gaps

Status: implemented

## Problem

A second independent review of #44 reproduced misleading terminal cancellation with a SIGTERM-resistant descendant, reuse of a deleted provider-qualified default, and installation examples pointing to a different repository or copying an incomplete Skill bundle. Additional regressions exposed retention changes transferring borrowed-resource cleanup ownership and loss of retry handles after failed deletion. The previous 21-tool acceptance did not cover these boundaries.

## Decision

Use the canonical repository and install the entrypoint plus its three references together. Keep the task leader waitable with Linux waitid/WNOWAIT until its original process group/session has no live members; preserve identity checks while the leader is a zombie. Refuse retention changes that acquire borrowed-resource cleanup ownership. Use provider-qualified manager keys consistently and remove handles only after successful explicit deletion. Preserve historical evidence and add fresh per-action records and explicit remaining requirements.

## API Design

Existing tool names and successful normal workflows remain compatible. get_task/cancel_task remain cancelling while controlled group members survive; intentional setsid/daemonization escapes this process-group contract. retain_sandbox(retain:false) on a borrowed resource returns an error and never changes ownership; authorized kill_sandbox remains explicit. Qualified default deletion returns its qualified reference. Failed explicit deletion keeps the handle/default retryable.

## Alternatives considered

- Treating shell exit as completion permits work to continue behind terminal status.
- Automatically using SIGKILL would expand the requested cancellation semantics; keep TERM and explicit escalation.
- Universal descendant control needs a stronger cgroup/subreaper contract and is not claimed here.
- Rewriting merged evidence would erase the actual previous result.

## Dependencies

Existing lockfile. Linux /proc and Python os.waitid/WNOWAIT for task supervision. Real Alibaba runtime/template APIs for live acceptance.

## Test Strategy

First reproduce the failures against merged source. Regress resistant descendants, leader-before-child exit, repeated cancellation, borrowed retention, qualified deletion and failed-delete retry. Independently review the Skill and installation examples. Re-run source CLI/real STDIO runtime/template acceptance and repository cloud lifecycle checks, recording sent/returned/observed effects and cleanup. Verify minimal installed bundles and package contents, full CI matrix, links and repository hygiene.

## Acceptance criteria

- No cancelled/succeeded terminal state while the original controlled group still runs.
- Observed output stops after actual group termination.
- Borrowed resources survive disconnect; qualified defaults are cleared; failed explicit deletion can be retried.
- Documented install routes resolve the official complete Skill bundle.
- Fresh evidence distinguishes scoped passes, expected errors, platform effects and remaining original requirement gaps.
- Bilingual docs/changelog and required remote gates pass before merge.

## Evidence

- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/45
- [New verification](../../../evidence/verify/2026-10-18-skill-recheck.md).
- Prior delivery: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/44

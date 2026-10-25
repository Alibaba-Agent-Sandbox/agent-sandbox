# Verification: Total provider command deadline

- Date: 2026-10-25
- Change: [Issue 166](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/166)
- Result: PARTIAL — real cloud and affected regressions pass; remote CI and public distribution pending.
- Candidate: CLI 0.5.1 source on main `60ebe3ed6357e21bd27e24347eb762d6eb16511d`, with the scoped process/HTTP cancellation correction. Not a newly published package.
- Baseline: fresh official npm `@agent-sandbox/cli@0.5.1`; orchestration and independent observation use public PyPI client 0.4.0a1. Linux amd64, Node 22.22.2, Python 3.13.13. Credentials supplied only in the environment, values excluded.

## Real public baseline and candidate

All actual command invocations explicitly select `--native --provider alicloud-express --json exec`, avoiding the separately pinned standard command path.

| Case | Configured timeout | Observed CLI duration | Result |
| --- | --- | --- | --- |
| Public 0.5.1 finite noisy program | 1 second | 5.239 seconds | FAIL: successful exit 0 beyond the command budget |
| Source candidate same noisy program | 1 second | 2.202 seconds | PASS: exit 5/E3001; exact observed PID independently absent |
| Source candidate finite silent program | 1 second | 2.252 seconds | PASS: exit 5/E3001; exact observed PID independently absent |

Durations include CLI startup, sandbox connection and best-effort signal/readback overhead. The remote programs were bounded at four seconds independently of the client, so the old behavior could not create an unbounded task. The owned sandbox was deleted and the independent SDK get-info returned typed NotFound.

## Maintained E2E

`ABX_E2E_TEMPLATE=base ABX_BIN='node dist/bin/abx.js' node e2e/run.mjs --suite cloud-lifecycle --filter 'cloud-lifecycle/(create-json |native-exec-total-deadline-)'`:

- 4 PASS: owned create, native silent timeout, native noisy timeout, independent owned leak check.
- Each timeout reads the command's actual PID and verifies absence in native process inventory.
- 0 leaked sandboxes; 0 unresolved create attempts.

## Local checks

- `npm ci`: PASS.
- `npx vitest run tests/test_protocol/test_process.test.ts tests/test_known_issues/ki003_command_timeout.test.ts tests/test_transport/test_http.test.ts`: 68 PASS, including finite noisy/silent deadline and HTTP response/client/iterator closure.
- `npm run typecheck`, `npm run build`: PASS.
- Initial full suite: 4367 PASS, 13 FAIL, 50 SKIP. Three failures exposed the timer overflow and old negative-command error expectations, now corrected; ten are existing environment transport/proxy interception failures. Final counts follow.
- Negative command budgets now return typed E3001 without a Start request; direct negative HTTP timeouts retain ConnectTimeout.
- `npm run lint`: PASS, 0 errors. Repository health: 106 PASS/0 FAIL. Hygiene: PASS.
- [Affected offline exec capture](../cli/command-deadline-exec-20261025.md) was regenerated; it preserves normal command behavior and is not cloud evidence.
- Final focused boundary rerun: 87 PASS across protocol, HTTP, command and negative-timeout coverage. Final full suite: 4370 PASS, 10 environment transport/proxy FAIL, 50 SKIP. Latest-head remote CI follows before merge.

## Limits

SIGKILL applies only to the actual PID observed for this command; it does not promise process-tree termination. A failed kill remains best effort and cannot mask the typed timeout. This evidence does not claim a public 0.5.2 release; fresh public-package reruns follow publication.

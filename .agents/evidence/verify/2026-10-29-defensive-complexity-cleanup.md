# Verification: Defensive complexity cleanup

- Date: 2026-10-29
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/215
- PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/216
- Base: 84dce3fb4a02590f3ce129c0de786716ac98c1dc
- Result: Source behavior, targeted real-cloud acceptance and the complete remote CI matrix pass. Local environment failures remain recorded below. Final documentation commit and merge still require current-head checks.
- Source and test changes are on an isolated branch; original workspace edits are preserved.

## Checks

| Check | Result |
| --- | --- |
| npm ci with package-lock | PASS |
| make ci hygiene/typecheck/lint/build | PASS |
| make ci full tests | 4564 passed, 53 skipped, 10 failed |
| Clean base repeat | Same 10 failures reproduced at 84dce3f; 9 transport_net/ws and 1 node_transport_integration |
| Proxy/SSL environment removal repeat | Same failures; precise root cause not established |
| parity coverage | Ledger 907/907; 11 moved Python entries verified. Underlying full suite: 4590 passed, 53 skipped, same 10 failed |
| Offline E2E | 81 passed, 1 skipped (no cloud resources requiring leak sweep) |
| make dist-check | PASS |
| Create evidence capture | 12 scenarios passed; new dated golden captures retain old history |
| Built native JSON kill with open stdin pipe | Immediate exit 2, valid error JSON, empty stderr; no cloud request |
| Built api-key.create help | 32 lines versus previously observed 218; full schema discovery works |

The parity script's zero exit status does not convert its underlying full-suite failures into passes.

## Adversarial decisions

Accepted deletions have observable equivalence or a demonstrated defect: duplicate create target selection, dominated timeout validation, equivalent response defaults, full schemas in normal help, redundant background delegation, per-call event loops, and broad lifecycle catches.

The opposing reviewer caught three regressions before delivery: requiring exec.run as well as exec.stream for background-only providers; synchronous callback self-deadlock; and submitted work surviving Ctrl-C. All three received corrections and regressions. Actual SIGINT independently ran the cancelled coroutine's finally block; sequential, notebook and 12-thread probes reused one event loop.

Retained: ServerClient cross-loop compatibility, endpoint/audience authentication, managed-key preparation consent, ownership-aware cleanup, non-idempotent write replay rules and public configuration exports. No management API key was prepared or renewed. Qualified-ID CLI routing remains a separate unresolved design issue; register deployment and keep_alive handle design were documented, not redesigned.

## Real components and cloud

A source-built CLI and editable Python client used an existing authorized Express API key loaded only into child processes. One owned base sandbox with a 180-second TTL passed: three sequential synchronous literal-argument executions, background shell variable expansion, synchronous file write/read, and TypeScript lifecycle/literal/background checks against that same sandbox. Deletion succeeded. The first independent check mistakenly called instance-only standard is_running as a class method and failed locally; corrected standard get_info returned SandboxNotFoundException, independently proving absence. The verification mistake is not a product failure.

The existing declarative cloud suite additionally passed all six tests: sync/async remote functions, remote exception propagation, borrowed-instance survival, automatic owned-instance deletion and local serializer validation.

Three maintained Python cloud regressions also passed (23 collected, 3 selected, 20 deselected): quoted_operator, background_preserves and sync_connection_reuses. Their owned base fixture performed cleanup. This is targeted Express acceptance, not every provider/template or complete cloud suite.

English and Chinese application registration examples were executed locally: @command() registers demo, which returns hello=1. SDK application examples now use application_client and async context cleanup. Public guides omit internal acceptance statistics and audit timelines.

## Repository records and hygiene

Final repository health: 106 passed, 11 historical warnings, 0 failed. git diff --check passed. Python make hygiene passed; CLI hygiene passed as part of make ci. The first CLI health run found a generated ignored parity report containing local paths; the report was moved outside the checkout and health rerun. No tracked source was exempted.

## Remote CI and remaining gates

Complete remote checks passed for source revision `5840d6b9c36fdbd62abb2f761050223cb9b01b39`: Build package, Test (Node 22), Test (Node 20), Installer script, Typecheck (tsc), Markdown links. This independently distinguishes local environment failures from the successful remote matrices. Local failures and prior cancellations remain in history; no network assertions were relaxed.

The final records-only commit must pass its own current-head checks before merge. The ADR describes the implemented change; the PR carries pending merge state. No release is part of this change.

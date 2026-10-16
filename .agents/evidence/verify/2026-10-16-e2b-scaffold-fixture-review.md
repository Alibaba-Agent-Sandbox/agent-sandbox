# Verification: current scaffold ignore fixture

- Date: 2026-10-16
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40
- Result: PASS (targeted correction); latest full remote matrix required

## What was verified

The last full hosted Node 20/22 runs on a8e905b passed all other cases but retained one old generated-comment assertion: .dockerignore still expected the removed template init --adopt entry. Runtime output correctly says template scaffold --adopt. The original Python prompt/generation golden is preserved; current scaffold output now has a separate static fixture. Ignore rules remain byte-identical.

## Commands run

- `vitest run tests/test_agent/test_adopt.test.ts`: 25 passed, 10.70 seconds.
- `git diff --check`: PASS.
- Hosted Node 22 before this correction: 3808 passed / 1 failed / 2 skipped. Node 20: 3807 passed / 1 failed / 3 skipped. Both failed only this generated-header expectation; type/lint/hygiene, installer and Markdown checks passed.

## Results

Only the expected current artifact was corrected; runtime behavior and final standalone binary are unchanged. The full byte comparison remains in place. The complete hosted matrix must verify this test-only correction before acceptance.

## Cleanup

No cloud resources created. Existing real-cloud resource cleanup and conditional backend prerequisites remain as separately recorded.

## Problems found

A stale current-artifact expectation, corrected without rewriting the historical Python capture.

## Not verified

New full remote matrix, conditional enabled-function/MicroVM success paths, dependency/review acceptance, merge and release. Companion: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/47.

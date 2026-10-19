# Verification: provider-owned template launch

Result: PARTIAL

## Scope

Task branch `feat/provider-template-launch-20261019`; owner Issue https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/69. Tested the scoped source, adapter, documentation and catalog changes in this PR, with Node 22 and locked dependencies where applicable.

## Executed checks

Focused integration: 54 passed / 1 conditional skip before the final readiness regression. Strict typecheck and build passed. ESLint passed with existing warnings. Official SDK project parser and host staging passed against a loopback protocol fixture. Full local transport checks are affected by the environment network interception; hosted Node 20/22 CI is mandatory. Real Express launch and native Docker validation are recorded separately once executed.

## Delivery and limits

PR, hosted CI, native OpenSandbox Docker and public deployment receipts are pending at this checkpoint. No loopback result is a native E2B/Cube/cluster result. Those providers remain Beta. Express is the sole Stable provider. A released npm version containing the new command has not been published by this task.

## Cleanup

Local staging fixtures were removed by their tests. No Registry build or visitor webpage receives cloud credentials or creates visitor resources. Cloud and Docker cleanup results will be recorded with their respective real-component runs. No credentials or private resource identifiers are included here.

## Real Express launch receipt

PASS: built CLI `--provider alicloud-express --json template launch LOCAL_SOURCE --yes --timeout 480` against the configured real account. A unique generation-2 fixture used the actual official base image with `build.mode: steps` and a build marker. The launcher waited for registration readiness, passed the returned reference to sandbox creation, and returned one parseable JSON result. A separate SDK connection executed a shell probe that confirmed the build marker.

PASS: the owned sandbox was deleted with `Sandbox.killById` and independent `getInfoById` readback returned absence. The owned template was deleted through the official SDK; a fresh official inventory confirmed the exact unique alias absent. The temporary source/home was removed. No pre-existing sandbox or template was changed.

An initial task-local cleanup harness used a nonexistent static method; the product launch and probe had succeeded. Recovery checked the exact owned template/alias, confirmed sandbox absence and deleted the owned template. The corrected full run then exited 0 with all cleanup/readback checks passing. This receipt covers the new launch path; historical broader Express acceptance remains separate.

## Final local checkpoint

PASS: strict typecheck; build; lint (0 errors, 253 pre-existing warnings); provenance 7/7; repository health 106 passes, 0 failures; hygiene. Launch regressions 10/10, including rejection of a submitted build when readiness polling fails. The full local suite executed 4034 tests: 4012 passed, 21 failed, 1 skipped; one new readiness test fixture lacked an ACR namespace and was corrected, then the 10/10 focused launch suite passed. The remaining 20 failures are the existing intercepted-network transport/engine/Cube cases. Hosted Node 20/22 CI remains the authoritative complete matrix.

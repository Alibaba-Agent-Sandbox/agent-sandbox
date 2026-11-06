# Verification: stable Gateway HTTP revision readiness

- Date: 2026-11-06
- Scope: CLI PR235 seventh unpublished candidate.
- Result: six focused cases, strict types and build passed; new-source/full gates pending.

Independent static review established that an old revision can return401 for a new temporary key.
The final native alias readback therefore did not replace stable HTTP revision verification.
The later real sixth-candidate credential probe recorded HTTP404 on attempt1; its missing body does
not prove a propagation root cause and404 is never treated as successful authentication.

The new health-only gate requires200 plus the frozen revision. It retries only404/502/503/504
within30 seconds/30 attempts/one-second delays, narrows each real fetch to remaining time, and stops
on wrong-revision200,403/500 or transport failure. The v6 authentication policy is unchanged.

Six focused tests passed: stable404 then correct health before credential use; old-revision200
rejection before auth; fatal403 and500; expired health budget; actual fetch remaining timeout.
Strict types/build passed. No old receipt, alias, image or readiness flag was changed by this fix.
A new separately installed package is used for the next source workflow; actual diagnostic metadata
resources and public-consumption validation retain their own independent records.

Full local `make ci` subsequently exited 0 on the reviewed product commit `03feb83f2c473b9e73c29c3a12e73ad6b854a4d0`: 4,730 unit tests and 4,756 parity tests passed, with five existing optional skips in each run. The parity ledger contained 907 passed entries, no missing entries and eleven verified moves to the SDK. Hygiene, strict types, lint, build and package-entry closure passed. Repository health reported 105 passes, eleven warnings and no failures. The separately installed seventh package passed the release-artifact check.

The seventh candidate has not been deployed to a new real cloud application. The current bounded test-resource window stopped new deployments at its recorded deadline; full managed source acceptance and fresh public-package consumption remain blocking. PR235 remains a draft and no CLI release was published. Earlier source afterReady business results and failures belong to their earlier candidates and are not relabeled as seventh-candidate acceptance.

Remote CI on `03feb83f2c473b9e73c29c3a12e73ad6b854a4d0` also completed successfully: [CI 42178427938](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42178427938) covered Node 20/22, type/lint, installer and the installed packed artifact; [Docs links 42178427925](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42178427925) and [Express source workflow 42178427923](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42178427923) passed. These workflow results do not replace the still-pending real managed application gate.

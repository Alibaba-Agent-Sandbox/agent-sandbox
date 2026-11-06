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

# Standard/provider convergence verification — 2026-10-18

Result: PARTIAL; current candidate remains draft.

Ordinary merge of accepted CLI main into original PR40 b957e9a2. Node22.22.2,
locked npm10 install. The current work preserves original standard runtime and notices.

- Reproduced five resume permission/server failures being swallowed and missing
  PTY gate:6 FAIL before;6 PASS after. Non-404/405 failures make one POST/no GET.
- Standard frontend/configuration/executable/provider boundaries:136 PASS.
- Native canonical-key restoration and prompt/scaffold owner migration reduce
  initial256 local failures to the known raw-network baseline plus four identified
  integration mismatches. These intermediate failures remain recorded as failures.
- New dated CLI captures115 PASS; original merged captures remain immutable.
- Scoped ownership/registry/paused-provider/process checks PASS after typed error
  and current fixture corrections. Full final suite, artifact and cloud acceptance
  will be appended as separate results after main convergence.
- The companion standard Python client actually ran against Express:3 scenarios
  PASS (sync/async lifecycle/files/process/interpreter/network enforcement), one
  snapshot SKIP because no enabled MicroVM/allowlist fixture is available.

No native E2B credentials were substituted with Express values. Original draft
pause/snapshot and whole-artifact attribution prerequisites remain outstanding.
No package publication or new hosted cloud/model acceptance workflow is introduced.

Accepted-main convergence ad704f41 (MCP31, provider metadata61) is retained.
Typecheck/build PASS; final full local3940 PASS/10 preserved raw-network FAIL/56
SKIP. No new behavior failure remains. Eslintzero errors; hygienePASS; health105
PASS/11 immutable-history WARN/zero FAIL. New dated115 captures PASS.

Actual built CLI Express standard scenario PASS: detached create, stdout and
exit7 propagation, template list, real stateful PTY, borrowed connect retention,
interactive create's shortened lease and eventual404, exact owned kill and list
absence. Tracked resources cleaned in finally; zero residuals. This is separate
from installed fixture coverage, and does not prove native E2B or enabled snapshots.

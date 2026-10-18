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

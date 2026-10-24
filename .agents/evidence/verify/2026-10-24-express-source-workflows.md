# Express source workflow verification

Result: PARTIAL — implementation under verification; no cloud success claimed yet.

Baseline: CLI v0.4.13, commit ddf84a164315e87c9a73b0b2e1636e465f76c09b.
Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/134

- PASS: typecheck; focused launch/preparation regressions, 38 tests.
- PASS: public catalog investigation: 46 source templates rejected; only python-hello has a portable profile.
- Pending: complete CI and real Docker/Express source acceptance.
- Local environment has no Docker executable/daemon. Real Docker acceptance uses the opt-in Actions job.
- Existing issue #131 numerical steps timeout remains outside scope.

## Subsequent verification

- PASS: 60 focused regressions after adding journal-aware Docker/profile and configuration coverage.
- PASS: 118 CLI evidence snapshots after recording version 0.4.14 in a new directory; older captures preserved.
- PASS: ESLint (zero errors; existing warnings retained).
- PASS: remote Node 20/22 CI at edfa221, run 40090690400, including packaging and parity.
- PARTIAL local full suite: 4,309 passes, 21 failures, 2 skips. One old preparation fixture lacked
  the newly required journal and was corrected/retested. The remaining loopback/engine/wire failures
  show environment proxy/audit interference (HTTP 501 or rewritten TCP/TLS/WebSocket behavior);
  assertions were not relaxed. The corresponding remote CI matrix passed.
- PASS: actual native steps source launch from an explicit adaptation of current python-hello;
  command discovery, hello invocation and exec produced the expected results. Independent
  sandbox/template inventory checks confirmed both absent after cleanup. Initial CLI kill lacked
  consent and returned 1; template deletion succeeded, followed by independent absence checks.
  This does not replace unchanged Registry Docker source acceptance.
- FAIL: first Docker acceptance run 40090408602; startup did not complete. Sandbox/template cleanup
  confirmed. A subsequent run is in progress; no Docker success is claimed here.

PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/135
Consumer: https://github.com/Alibaba-Agent-Sandbox/registry/pull/45

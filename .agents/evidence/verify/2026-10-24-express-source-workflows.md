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

- PASS: subsequent native-steps launch and broader CLI E2E: 176 passed, 8 skipped;
  two tracked sandboxes, zero unconfirmed or unresolved creations; final leak check passed.
  Both native kill and template delete returned zero for the launcher-owned resources.
  Docker-specific opt-in cases were skipped here and remain separately required.
- PASS: remote Node 20/22 CI at 45060db, run 40091593693.
- FAIL: Docker acceptance run 40091593664: image build/push and template creation receipts
  exist, but preparation failed before sandbox creation. Template cleanup confirmed.
  Added sanitized platform status capture before deleting failed templates; root cause pending.
- FAIL with confirmed cause: run 40092070928 reached platform template creation, then
  the platform reported `pull image: image digest mismatch` for digest-based image input.
  Sandbox/template cleanup confirmed. Keep the observed digest in the journal, but submit
  the unique build tag through the existing native API contract. Added regression assertions
  for tagged API input and separate digest evidence. Focused 60 tests and typecheck pass;
  real cloud rerun remains required.
- Run 40092372924: tagged Docker template reached Ready; an independent application healthcheck
  on its owned sandbox returned zero. Full report pending. Review found the asynchronous test
  wrapper left child stdin open, which can block `exec` waiting for EOF; close that pipe before
  rerunning. Also align the acceptance sandbox lifetime with the optional full suite deadline
  (30 minutes rather than 10); the current owned sandbox lifetime was extended explicitly.
- Correction after isolated stdin probe: native `exec` completes with either open or closed
  stdin; it was not the blocked operation. Run 40092372924 was cancelled for diagnosis.
  Its retained job log confirms Registry launch, image/template receipts, info/list, exec,
  command discovery, hello and POST all passed. The file-delete test omitted `--yes` and
  waited at its confirmation prompt. Add explicit consent and keep stdin closed so future
  unexpected prompts fail rather than hang. Independent cleanup confirmed zero owned
  sandboxes and templates after cancellation. No full-suite pass is claimed for that run.

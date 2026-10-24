# Verification: Existing application HTTP timeout

- Date: 2026-10-24
- Change: [Issue 147](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/147)
- Result: PASS for the implementation and real-cloud comparison; the final evidence-only commit must pass the same remote gates.
- Candidate: CLI 0.4.17, built with Node 22.22.2 on Linux. Public baseline: CLI 0.4.16. Real cloud: Express base, published Python client/server 0.3.1a5, credentials supplied through environment and never included here.

## What was verified

Existing `http_timeout` now reaches application discovery, command listing, health and command POST requests. It remains a per-request deadline and does not replay or cancel remote commands. Cross-agent review found the fractional-second conversion edge case; `Math.ceil` and 1.001/1.0001-second regressions address it.

## Commands run

```bash
npm ci
npx vitest run tests/test_api/test_application_timeout.test.ts tests/test_api/test_application_protocol.test.ts tests/test_transport/test_application_http.test.ts
npm run typecheck
npm run build
make ci
bash scripts/check-repo-health.sh --quiet
```

Reproduce the real comparison with independent installed CLI paths, an environment configured for Express, and Python client 0.3.1a5:

```bash
python -m pip install 'agent-sandbox-client==0.3.1a5'
npm run build
python .agents/evidence/verify/2026-10-24-application-http-timeout/reproduce.py --baseline '<public-0.4.16-abx>' --candidate 'node dist/bin/abx.js'
```

The script downloads and verifies the immutable public server wheel, creates one owned base sandbox, starts a protected commands-only server on 9100 and always deletes its sandbox. Raw command output, IDs, endpoints and credentials are not emitted.

## Results

- Before the fix: two timeout tests failed and two passed. After forwarding: all 32 selected protocol/transport/timeout tests passed. After fractional deadline vectors were added, all 34 selected tests passed.
- First real cloud comparison passed: published 0.4.16 with timeout 40 failed after 31.1 seconds on a 35-second task; candidate returned 42 after 36.51 seconds. Configured one-second wait failed after 2.1 seconds, including CLI startup, for a three-second task. Server counters confirmed exactly three command POSTs.
- Initial cloud harness attempts failed because the harness used `close` instead of `aclose`, then an invalid policy endpoint name. Both owned sandboxes were independently confirmed absent. Those attempts are failures, not product passes.
- Initial unpinned local suite: 4,302 passed, 12 failed, 57 skipped. Two provider-fixture failures used a catalog requiring a newer synthetic test host. Rerunning with workflow-pinned provider/Python fixtures: 4,351 passed, 20 failed, 2 skipped. Local transport/engine fixtures received unexpected proxy/HTTP 501 responses; these results are not reported as green. All 20 failing test names also fail on unchanged main `83fa7d0a228dcd00bbc5018618eef321083bb996` in the same environment. That baseline run had four additional missing-build failures; it is not a clean acceptance run. Clean GitHub [CI 40122271297](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40122271297) passed on exact implementation `5b872c9ec3273494039121bca9c116f21c2b0a88`: Node 20/22 full tests and parity, typecheck, installer and package build. [Docs links 40122271273](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40122271273) also passed. No product change was made to accommodate the local network environment.

The reusable cloud harness also passed the same three cases (31.72 / 36.82 / 2.19 seconds), including exact NotFound and inventory absence. See [sanitized receipt](2026-10-24-application-http-timeout/cloud-candidate.json) and [reproduction script](2026-10-24-application-http-timeout/reproduce.py).

Local lint passed (274 pre-existing warnings), package entry/Skill closure passed, and final repository health passed (105 PASS, 11 historical WARN, 0 FAIL). Local parity without the server fixture had six skipped checks and is not claimed as passing; the pinned remote parity checks passed.

## Cleanup

The successful cloud comparison and both failed harness attempts independently checked the exact owned sandbox and received NotFound after deletion. No template or image resources were created. The committed replay script also checks inventory absence.

## Review

Independent review checked timeout propagation, fractional seconds, unchanged gateway headers/authentication, redirect rejection and no replay. Final exact-head CI remains a merge gate.

## Not verified

This checks application HTTP deadlines on one Express instance; it is not a claim that all templates execute real model tasks or that client timeout cancels remote execution. The 46-template matrix is separate evidence using CLI 0.4.16.

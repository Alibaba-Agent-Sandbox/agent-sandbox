# Provider/main integration verification — 2026-10-18

Result: PARTIAL pending real Express acceptance and exact-head CI.

Source: provider isolation ce0e1b1858e and accepted main5df3d594, ordinary merge
plus the scoped reconciliation in this PR. Node22.22.2, locked npm10.9.4 install.

- Typecheck/build: PASS. Fresh focused provider, API-key/custom auth, template CLI,
  wizard, MCP handler discovery, error oracle and historical evidence:549 PASS.
- Full local tests after integration repairs:3835 PASS,12 FAIL,56 SKIP. One failure
  was the restored custom-auth error wording and passes in the later focused run.
  Eleven remaining failures are local raw TCP/TLS/WebSocket/proxy behavior or
  archive directory permissions; their prior baseline failures are preserved.
- Lint: zero errors,247 warnings. Health:105 PASS,11 WARN,zero FAIL. Hygiene:PASS.
- Initial offline launch lacked ABX_BIN and was not runnable. Corrected built-entry
  run:59 PASS,2 FAIL,1 SKIP,zero resources/leaks. Both failures expose stale
  pre-Commander choice-message assertions; final rerun is recorded below.

Integration repairs retain provider-owned native UI, use one envd token class and
structural data-plane types, keep helper/transport dependency direction, and retain
dynamic provider discovery for both tool schemas and exported handler lookup.
Template mocks now patch the canonical provider implementation. The oracle's
changed credential suggestion matches the documented provider-neutral contract;
historical engineering evidence was not changed. Existing MCP output order stays.
Native Express cloud acceptance and final remote CI are pending, not implied.

Final built-entry offline E2E:61 PASS,1 SKIP (no cloud resource created),zero
leaks. The two choice regressions now require exact current Commander messages,
including the complete allowed-choice lists and exit2; invalid input is not
accepted and no checks were removed. Focused549 PASS includes the final AK/SK
rejection wording. Current remote source must pass all normal CI jobs.

Final convergence includes remote e46e0db/12f0d69 through ordinary merges. Provider
port/file addressing and lazy exports remain, and lower configuration continues
to consume pure data. The active native template factory retains supported
v3/v2 image operations; the retired metadata-only create method remains absent.

Initial real CLI Express run:71 PASS/6 SKIP/2 FAIL, created2/leaked0. Minimal
images lacked ps/uptime. Retaining the remote portable /proc/Python fallback
repairs these without manufacturing metrics; actual real Express create/process
info/metrics/leak-check rerun:4 PASS, created1/leaked0. Native local fallback
regressions use actual kernel/filesystem data. Fresh provider/port/file suite33
PASS. The earlier configuration log expectation was updated to layered loading.

PR37's production wheel image change is integrated at the active provider-owned
DockerBuilder. Initial merge regression detected credentials being checked after
Docker side effects; preserving accepted preflight while applying only the RUN
parser change fixes it. Fresh wheel/auth-preflight/isolation suite59 PASS,
typecheck PASS, lintzero errors/253 warnings, health105 PASS/11 WARN/zero FAIL,
hygienePASS. PR37's separately recorded real production-image cloud acceptance
and cleanup remain historical evidence; no new local Docker run is claimed.

Final full local CLI:3854 PASS,10 FAIL,56 SKIP. All ten remaining failures are
the disclosed platform raw TCP/TLS/WebSocket/proxy cases; provider, API, archive,
CLI and wheel regressions pass. The actual Docker workflow watches both the
historical alias and the active provider implementation path, so future native
builder changes cannot evade the production-image regression.

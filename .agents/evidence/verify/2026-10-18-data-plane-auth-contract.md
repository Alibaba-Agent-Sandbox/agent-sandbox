# Verification: CLI runtime API-key contract

- Date: 2026-10-18
- Result: PARTIAL; configured component acceptance passes, hosted gates pending.
- Scope: auth factory/custom token validation, credential guidance and legacy
  Docker registration preflight; official control-plane clients unchanged.

## Checks

- Auth / official FC template / DockerBuilder regressions:117 PASS.
- Full normal locked Vitest run:3781 PASS /26 FAIL /2 SKIP.
  Twenty-three failed identities match the same-runtime baseline. Three extra
  adversarial CLI cases timed out under the full run; isolated repeat:3 PASS.
  The baseline also has a FORCE_COLOR warning failure absent in this run.
  Remaining failures involve loopback/proxy/PTY or workspace permissions;
  latest-head hosted full tests remain required, not replaced by this comparison.
- Typecheck and emitted build:PASS. Full ESLint:zero errors,222 existing warnings.
- Health:105 PASS /11 WARN /0 FAIL. Hygiene and staged scan run before commit.
- Actual built entry, isolated HOME, AK/SK-only runtime list:exit3/E1001 before
  network; capture under `../cli/2026-10-18-data-plane-auth/`.
- Official built CLI control-plane template list, real AK/SK and no sandbox
  API key:exit0, JSON list. No credential resource was minted.
- Configured Python SDK full-cloud suite used this built CLI for its real
  Express CLI lifecycle:115 PASS /4 SKIP /1 XFAIL /2 DESELECTED overall.
  Source auth logic was stable for that run. Janitor:zero candidates/total.

## Cleanup and limits

No keys or raw cloud responses are recorded. Unconfigured native providers
are skips. Full hosted CI and final review are pending. This change depends on
https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/56; land shared contract
before this consumer. Existing standard full CLI runner timeout is separately
recorded in cleanup PR53 and is not presented as an E2E pass here.

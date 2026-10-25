# Verification: Generated whole-template launch

- Date: 2026-10-25
- Result: PARTIAL (source-candidate E2E passed; full release gates pending)
- Environment: Linux, Node 24, Python 3.13, public Python client/server 0.4.0a1, real Express account and real coding model. Credentials were injected only at runtime and are excluded from evidence.

## Verified behavior

The final source candidate generated a fresh integer-addition application through the real coding model, prepared its native cloud recipe, created one sandbox, and used the shared controlled service startup. All 53 usage assertions passed: CLI files/system/process/PTY, SDK/POST calls, four arithmetic cases, application input errors, missing/wrong application credentials, non-root directory write/read/delete, and exact cloud/local source SHA256 equality. The owned sandbox was deleted and independently returned typed SandboxNotFoundError; the exact template deletion was independently confirmed.

A missing runtime token failed a separate real CLI command in 0.595 seconds before model progress or cloud submission. Unit spies separately confirm no generation, build or create call. Existing anonymous user templates remain supported by their explicit existing declarations; this change concerns the default for newly generated applications.

## Commands run

- `npm ci --ignore-scripts`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm run lint`: PASS, 0 errors / 274 warnings.
- Nine focused codegen, guide, create, template launch/plan, evidence and environment suites: 357 PASS before removing the unused generated-deploy extension.
- Final candidate after merging the Docker preflight fix and removing the unused extension: ten affected suites, 368 PASS / 1 skipped (live OpenSandbox backend unavailable).
- `npm run check:hygiene`: PASS.
- `bash scripts/check-repo-health.sh`: PASS=106, WARN=11, FAIL=0 including the final record/link check.
- Full local unit suite: 4365 PASS / 12 FAIL / 50 skipped. Two failures were the obsolete reference-plugin host-version fixture and now pass using the actual host version. The remaining ten are local loopback, proxy and TLS transport cases under this execution environment; required clean remote CI remains pending. No full-suite pass is claimed.

## Scope

Two real-model native-cloud candidate runs passed all 53 usage assertions each, including an explicit `-e ABX_SERVER_TOKEN=...` runtime override. Source hashes and exact sandbox/template absence were independently checked. The second run used runtime override values without putting them into generated artifacts.

The candidate still reports the existing package version; it is not a claim that the public 0.5.1 package contains this refactor. Required CI/review, new patch publication and fresh public installer/PyPI reruns remain pending.

## Cleanup

Each source-candidate run deleted only its exact owned sandbox and template, with independent absence checks. No global cleanup was used.

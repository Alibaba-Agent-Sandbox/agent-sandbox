# Verification: Template command guidance and diagnostic reporting design

- Date: 2026-10-22
- Scope: `src/cli/config_guidance.ts`, its unit/black-box regression, bilingual current command examples, proposed reporting design and records; base `850a9bb`.
- Result: PARTIAL (local full-suite environment failures; remote gates pending).
- Environment: Linux, Node 22.22.2. Cloud credentials supplied through the ignored workspace environment; values not recorded.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| `npm ci`, `npm run build` | PASS | Locked installation and compiled package |
| `npm test -- --run tests/test_cli/test_guidance_contract.test.ts` | PASS | 22 tests including no-input/no-submission recovery |
| Full `npm test` with paired SDK/provider sources | FAIL | 4100 passed, 20 failed, 2 skipped; all 20 failing cases reproduced identically on untouched base in the same environment |
| Baseline comparison of six failing files | PASS for comparison, failures retained | 20 same failures, 38 passes. Platform proxy returns synthetic HTTP 501 for several loopback tests; protocol/TLS/WebSocket adversarial cases also differ. Clearing shell proxy variables does not resolve the platform behavior |
| `npm run lint` | PASS | 0 errors; 277 existing warnings |
| `npm run typecheck` | PASS | Strict TypeScript |
| `bash scripts/check-repo-health.sh` | PASS before final records | 105 passes, 11 historical warnings, 0 failures; rerun after staging records |
| `npm run check:hygiene` | PASS | No credential/local-path leak |
| `npm run test:standard-provenance` | PASS | Pinned bundle source/attribution unchanged |
| `npm pack --dry-run --json` through package entry checker | PASS | Required executable files present |
| Black-box missing-config + legacy create cases | PASS | 2 pass; no cloud resources created; recovery hint present, no prompt under -y |
| `node e2e/guided-configuration.mjs` against built CLI | PASS, real cloud | Real PTY, hidden input, temporary config, create and exec; owned sandbox killed and HTTP 404 absence readback |

## CLI output capture

Invocation with fresh home and no cloud credentials:

```text
abx template deploy ./codex -y --alias codex
Missing configuration for Build and deploy template:
  - access_key_id: abx config set providers.alicloud-express.access_key_id
  - access_key_secret: abx config set providers.alicloud-express.access_key_secret
  - acr_namespace: abx config set providers.alicloud-express.acr_namespace
--yes/-y skips configuration prompts. To enter missing values interactively, rerun this command without --yes/-y in a terminal.
Run the configuration commands in a terminal, or supply the documented environment variables in automation. No cloud operation was submitted.
```

The existing snapshot suite passed in the full run; this new diagnostic path has no old golden snapshot to rewrite. Historical CLI captures remain immutable.

## Design boundary

The reporting document is a proposal, not deployed telemetry. Reviewed primary FC documentation for stdout/SLS, synchronous/asynchronous admission and HTTP trigger protection. It specifies opt-out, privacy allowlist, no distributed shared secret, key-bound anonymous enrollment, replay/dedup state, anti-Sybil rate/budget controls, bounded worker/queue and real-service release gates. Backend, new settings, performance claims and actual FC/SLS delivery remain unimplemented/unverified.

## Cleanup and limitations

Only the guided real-cloud run created a sandbox; independent cleanup confirmed absence. No template, FC or SLS resources were created. No full Docker/ACR image deployment was necessary for a configuration diagnostic and prose fix. Full local suite remains failing as above; remote CI/review must pass before merge. The untouched base run is failure attribution, not a product test pass.

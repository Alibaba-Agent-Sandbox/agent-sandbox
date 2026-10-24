# Express source workflow verification

Result: PASS for the scoped implementation and representative real-cloud workflows.
Publication and Registry deployment follow the producer merge; static compatibility does not
certify every template workload.

Baseline: CLI v0.4.13, ddf84a164315e87c9a73b0b2e1636e465f76c09b.
Verified product revision: a13b973 (version 0.4.14); final follow-up changes only record evidence.
Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/134
PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/135
Consumer: https://github.com/Alibaba-Agent-Sandbox/registry/pull/45

## Passing checks

- `npx vitest run tests/test_providers/test_express_source_workflow.test.ts tests/test_providers/test_template_launch.test.ts tests/test_cli/test_template_guided_configuration.test.ts`: 60 passes.
- CLI evidence snapshots: 118 passes; version 0.4.14 has a new capture directory, historical captures preserved.
- `npm run typecheck`: pass. ESLint: zero errors, existing warnings retained.
- `bash scripts/check-repo-health.sh`: 105 passes, 11 historical warnings, zero failures.
- `npm run check:hygiene` and `git diff --check`: pass.
- Full remote Node 20/22 CI, typecheck, installer and package validation:
  https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40093847735
- Unchanged Registry `Alibaba-Agent-Sandbox/awesome-templates//python-hello` default Docker launch:
  https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40093847721
  Source build/register/create, exact template handoff, digest receipts, info/list, exec,
  command discovery, hello, POST `/commands/hello`, upload/download/stat/remove all passed.
  The full CLI E2E suite against the resulting template passed: **176 pass, 8 skip**.
  [Sanitized summary](2026-10-24-express-source-workflows/cloud-summary.json).
- An explicit native-steps adaptation of current python-hello also passed unified launch,
  discovery, hello and exec; its broader CLI E2E run independently passed **176 pass, 8 skip**.
  This steps adaptation is separate from the unchanged Docker source acceptance.

## Cleanup and reproducibility

The acceptance job verified sandbox deletion and template inventory absence. Six unique
image tags from the image-producing task runs were reconciled by exact names, digests and
creation times, then deleted separately after sandbox/template cleanup. All six returned
`IMAGE_NOT_EXIST`; shared repositories and unrelated tags were preserved.
The eight task-owned encrypted `EXPRESS_ACCEPTANCE_*` Actions secrets were temporary;
cleanup is recorded before merge. Existing package-publishing secrets were not changed.

Run `npm ci && npm run build`, then `node e2e/express-workflow.mjs` with the configuration
in `e2e/README.md` / `e2e/README.zh-CN.md`; set `ABX_WORKFLOW_FULL_E2E=1` for the full suite.
This uses real Docker, ACR and Express resources. The harness documents manual image cleanup;
this task completed that cleanup separately. Without the opt-in Actions secret the cloud
step is skipped, which is not another cloud acceptance run.

## Earlier failures and resolved test issues

- Digest-based platform image input failed with `pull image: image digest mismatch` in run
  40092070928. Keep the observed digest as evidence and submit the unique native image tag;
  successful run 40093847721 validates that correction. No existing tag is overwritten.
- Run 40090690387 timed out before recording any resource intent; no build success claimed.
- Run 40092372924 passed launch, API and CLI calls but was cancelled to diagnose a blocked
  file-delete prompt. Independent cleanup confirmed zero owned sandboxes/templates.
- Run 40093603793 reproduced the missing `--yes` as an explicit aborted confirmation.
  The harness now supplies consent, closes unused stdin and gives the full suite a sufficient
  sandbox lifetime. A local comparison ruled out native exec itself as the stdin blocker.
- Initial local full unit run: 4,309 pass, 21 fail, 2 skip. One old journal fixture was fixed;
  the remaining loopback/engine/wire failures showed this environment's proxy/audit
  interference (HTTP 501 and rewritten TCP/TLS/WebSocket behavior). Assertions were not
  weakened; the complete remote Node 20/22 CI matrix passed.

## Limits

Only python-hello is live-tested here. The Registry's 46 source plans are statically compatible;
this is not 46 workload certifications. Eight full-suite cases were explicitly skipped for
missing optional prerequisites; the Docker source path has its separate passing acceptance.
Existing numerical-build timeout issue #131 remains outside scope.

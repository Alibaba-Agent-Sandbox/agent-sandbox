# Verification: Whole-template launch candidate

- Date: 2026-10-25
- Result: PASS for remote repository gates and focused real Express acceptance; local full-suite attempt failed and was interrupted as detailed below.
- Candidate package: CLI 0.5.0, source branch `refactor/unified-template-launch`.
- Verified implementation and test commit: `11db70430d25a7fe13a3e4e8961a39286b06efe2`.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/151
- Draft PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/152

## Behavior

Spec v5 launches the complete template, starts its command once, runs declared readiness checks and resolves all service addresses. Known Agent Sandbox Server v2 services receive health/discovery checks; other protocols are not automatically probed. Managed catalog names resolve the catalog manifest directly. Business API operations are not treated as launch types or executed at startup. Removed selectors and v4 manifests fail before resource creation.

## Completed local checks

- `npm ci`, `npm run typecheck`, `npm run build`: PASS.
- Focused model, template, generator, catalog and launch tests: 7 files / 206 tests PASS; subsequent launch/shared-vector run: 2 files / 50 tests PASS.
- Final capability, provider profile, launch and shared-vector regressions: 4 files / 73 tests PASS.
- Shared launch contract synchronization check and 17 cross-language vectors: PASS.
- `ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence/test_evidence_snapshots.test.ts`: 118 tests PASS; new help snapshots preserve historical captures.
- Version/help-only regeneration after 0.5.0 bump: 10 PASS, 108 excluded by filter.
- `node scripts/capture-cli-evidence.mjs --command help-template --out .agents/evidence/cli/template-launch-20261025`: 9 command captures, no skips, PASS.
- `bash scripts/check-repo-health.sh`: 106 PASS, 11 existing warnings, no failures, including the final evidence refresh.
- Packed CLI 0.5.0 with `npm pack`, installed its tarball into an isolated prefix, and ran `node scripts/check-release-artifact.mjs INSTALLED_ABX`: PASS (version, terminal guidance, JSON output, root/standard/native help, notices).
- Installed package launch help omits both retired selectors; launching a local v4 manifest returns the explicit spec v5 migration error: PASS.

## Remote repository gates

All checks passed at the verified commit: Node 20 and Node 22 tests, Typecheck, Build package, Installer script, Markdown links and Express capability checks. See the [CI run](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40177129524).

An earlier candidate run found four stale test expectations (one scaffold assertion and three v4 capability fixtures). Those expectations and the renamed parity mapping were corrected before the passing run.

## Local full-suite limitation

`make ci` passed hygiene, typecheck, lint (0 errors / 274 warnings) and build. Its full unit run did not pass: loopback/mock network tests returned environment HTTP 501 responses (`项目网络审计已关闭`); PTY, stdio, transport and WebSocket adversarial checks also failed or timed out. The remaining stalled run was interrupted, so there is no final local suite total. A focused CubeSandbox/engine rerun reproduced 8 failures / 15 passes. This is not reported as a local pass or a completed local parity gate. The same candidate's clean remote Node 20/22 repository gates passed; the precise cause of each local timeout was not established.

## Real components and scope

The final real Express runner passed managed base launch/remote execution, native platform-steps source preparation, two-service startup/readiness, returned endpoint completeness and marker execution. Every owned sandbox and template was deleted and independently checked absent. See [focused cloud evidence](2026-10-25-unified-template-cloud.md) and the reproducible `e2e/unified-template-launch.mjs` runner.

The managed cloud test uses a local spec v5 manifest. It does not prove the production catalog-name path: that catalog remains v4 until coordinated publication. Catalog-name resolution has a separate fixture regression. No Docker executable is present locally; this native-steps check does not replace the independent Docker/OpenSandbox template matrix or test application business APIs.

## Release coordination

CLI 0.5.0 requires v5 manifests; the previous CLI cannot consume v5. Publish and switch the CLI, template catalog, Registry and website together. This evidence does not claim that the draft PR is merged, the npm package published, or the production catalog already migrated.

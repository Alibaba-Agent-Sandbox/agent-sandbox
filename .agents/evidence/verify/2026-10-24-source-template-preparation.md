# Verification: Public source template preparation

- Date: 2026-10-24
- Change: [Issue 136](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/136)
- Result: PARTIAL
- Binary / package under test: CLI source branch fix/source-template-preparation, initial version 0.4.14 development build, followed by 0.4.15 release candidate
- Environment: Linux; credentials are never included in this record.

## What was verified

Verification is in progress. This file does not establish a real cloud pass or all-template compatibility.

## Commands run

- `npm ci`: PASS, lockfile installation completed.
- `npx vitest run tests/test_providers/test_source_recipe.test.ts tests/test_providers/test_template_launch.test.ts tests/test_providers/test_express_source_workflow.test.ts`: PASS, 50 tests. Follow-up runs including provider-manifest regressions passed 110 tests; the 0.4.15 candidate including alpha/beta/RC compatibility ordering passed 120 tests.
- `npm run typecheck`: PASS after correcting the initial type mismatch.
- `npm run build`: PASS.
- `bash scripts/check-repo-health.sh`: PASS, 106 checks, 11 historical warnings, no failures.
- `node scripts/capture-cli-evidence.mjs --command template --out .agents/evidence/cli/2026-10-24-source-template-preparation`: PASS, 5 cases, 0 skipped.
- `make ci`: hygiene, typecheck and lint passed (274 existing warnings, no errors); full-suite execution has local loopback failures and remains in progress. Assertions were not weakened.
- Initial remote full CI on fae7eddf429b6d4851bd630e0c8cc4f97d553b6d: [run 40104814962](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40104814962) PASS. Latest release-candidate CI remains required.
- Initial production DockerBuilder regression: [run 40104814988](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40104814988) PASS. This verifies the existing Express builder, not the new OpenSandbox wheel stage.

## Results

All 46 source-template directories from awesome-templates commit 565e546a3e1d814e840062cbdd5da4ba295e16a6 and its authoring skeleton passed local staging and snapshot verification. Each received the wheel stage; this checks preparation bytes only, not Docker builds, cloud instances or application behavior. The first staging sweep exposed Python heredoc imports being misidentified as FROM instructions; the fix masks heredoc and continuation bodies and has a regression. The first typecheck caught an ExecFileException code union mismatch, corrected before final validation.

[Local staging receipts](2026-10-24-source-template-preparation/staging.json).

## Cleanup

No cloud resources created by these local checks.

## Problems found

Official source placeholders and wheel preparation were missing from the public path. See the linked Issue.

## Not verified

Real OpenSandbox source build/create/application/cleanup and full 46-template coverage are pending. No claim is inferred from historical receipts.

## Cross-repository metadata review

The optional provider `workflow.source_placeholders` description uses the existing catalog values `<region>` and `<tag>`. Parsing accepts only those unique strings and grants no operations or input kinds. The current OpenSandbox manifest was parsed successfully after adding this compatibility handling; older CLI releases without that handling cannot install this updated manifest. Registry installation guidance must select the matching CLI.

## Release compatibility

CLI 0.4.15 includes the optional metadata parser before the updated provider is published. Compatibility ordering distinguishes dev/alpha/beta/RC ordinals, including a2 versus a3 and a10 versus a3; unrecognized suffixes are rejected rather than considered equivalent. Runtime preparation behavior is unchanged by this version bump.

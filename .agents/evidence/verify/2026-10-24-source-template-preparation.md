# Verification: Public source template preparation

- Date: 2026-10-24
- Change: [Issue 136](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/136)
- Result: PASS for the source-preparation change; coverage limits below
- Binary / package under test: CLI source branch fix/source-template-preparation, initial version 0.4.14 development build, followed by 0.4.15 release candidate
- Environment: Linux; credentials are never included in this record.

## What was verified

Final executable candidate `33c4e890d8017c6c89bb8e105a1f8432537ac3d0` passed remote Node 20/22 CI. Real Express and Docker-backed OpenSandbox public launch checks passed for `python-hello`; this is not all-template runtime certification.

## Commands run

- `npm ci`: PASS, lockfile installation completed.
- `npx vitest run tests/test_providers/test_source_recipe.test.ts tests/test_providers/test_template_launch.test.ts tests/test_providers/test_express_source_workflow.test.ts`: PASS, 50 tests. Follow-up runs including provider-manifest regressions passed 110 tests; the 0.4.15 candidate including alpha/beta/RC compatibility ordering passed 120 tests.
- `npm run typecheck`: PASS after correcting the initial type mismatch.
- `npm run build`: PASS.
- `bash scripts/check-repo-health.sh`: PASS, 106 checks, 11 historical warnings, no failures.
- `node scripts/capture-cli-evidence.mjs --command template --out .agents/evidence/cli/2026-10-24-source-template-preparation`: PASS, 5 cases, 0 skipped.
- Local `make ci`: hygiene, typecheck and lint passed (274 existing warnings, no errors). Two early full-suite attempts were explicitly stopped (exit 130) after overlapping edits invalidated their revision coverage; they are not passes. Separate loopback/PTY subprocess failures were observed without weakening assertions. A frozen-source run is still pending locally; the complete final-candidate Node 20/22 suites passed remotely.
- Initial remote full CI on fae7eddf429b6d4851bd630e0c8cc4f97d553b6d: [run 40104814962](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40104814962) PASS. Final release-candidate CI passed, as recorded below.
- Initial production DockerBuilder regression: [run 40104814988](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40104814988) PASS. This verifies the existing Express builder, not the new OpenSandbox wheel stage.

## Results

All 46 source-template directories from awesome-templates commit 565e546a3e1d814e840062cbdd5da4ba295e16a6 and its authoring skeleton passed local staging and snapshot verification. Each received the wheel stage; this checks preparation bytes only, not Docker builds, cloud instances or application behavior. The first staging sweep exposed Python heredoc imports being misidentified as FROM instructions; the fix masks heredoc and continuation bodies and has a regression. The first typecheck caught an ExecFileException code union mismatch, corrected before final validation.

[Local staging receipts](2026-10-24-source-template-preparation/staging.json).

## Cleanup

Local staging checks created no cloud resources. Real-run cleanup is recorded below.

## Problems found

Official source placeholders and wheel preparation were missing from the public path. See the linked Issue.

## Not verified

The full 46-template runtime matrix, heavy-dependency workloads and model-backed tasks were not run in this CLI change. OpenSandbox production registry retention policy and deployment modes beyond the pinned Docker-backed test server were not verified. No claim is inferred from historical receipts.

## Cross-repository metadata review

The optional provider `workflow.source_placeholders` description uses the existing catalog values `<region>` and `<tag>`. Parsing accepts only those unique strings and grants no operations or input kinds. The current OpenSandbox manifest was parsed successfully after adding this compatibility handling; older CLI releases without that handling cannot install this updated manifest. Registry installation guidance must select the matching CLI.

## Release compatibility

CLI 0.4.15 includes the optional metadata parser before the updated provider is published. Compatibility ordering distinguishes dev/alpha/beta/RC ordinals, including a2 versus a3 and a10 versus a3; unrecognized suffixes are rejected rather than considered equivalent. Runtime preparation behavior is unchanged by this version bump.

## Second review and release snapshot correction

Cross-review aligned source-placeholder metadata prerequisites with Python: an adapter must explicitly declare CLI template.prepare and source input. Metadata still grants no operations. The manifest suite passes 71 tests after this correction.

Remote candidate run [40105561435](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40105561435) failed on both Node versions because the version golden still expected 0.4.14; Node22 reported 4354 passed, 1 failed, 5 skipped. The 0.4.15 version golden was regenerated through ABX_UPDATE_EVIDENCE in a new release directory, preserving the historical 0.4.14 capture. Final candidate CI subsequently passed, as recorded below.

The early long-running local make-ci run overlapped subsequent parser/test edits and therefore cannot establish final revision coverage; its cached old module/new test mismatch is not reported as a product failure or attributed to the environment. Separate local loopback/PTY subprocess failures remain distinguishable. The two early runs were explicitly stopped with exit 130. A frozen-head local full-suite run remains pending; remote final-candidate suites below provide complete revision coverage.


## Final candidate CI and public launch verification

- Executable candidate: `33c4e890d8017c6c89bb8e105a1f8432537ac3d0` (0.4.15). [CI 40106270649](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40106270649) PASS: Node 20/22 full suites, typecheck, installer and package build. [Documentation links 40106270686](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40106270686) PASS. [Docker regression 40106270655](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40106270655) PASS for the existing Express wheel builder.
- Final local snapshot/manifest regressions: 189 PASS. Typecheck, build, package dry run, lint and repository health passed on this executable candidate. The new version capture has one case; existing version history is preserved.
- Actual Express cloud dispatch [40104986058](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40104986058) PASS at CLI `fae7eddf429b6d4851bd630e0c8cc4f97d553b6d`. It exercised Registry `python-hello` source launch, immutable-image/template handoff, info/list/exec, command discovery and invocation, HTTP POST `/commands/hello`, file upload/download/stat/remove and owned sandbox/template cleanup. Its CLI E2E suite reported 176 passed and 8 explicitly skipped. The wheel/staging/runtime launch implementation is unchanged between that source revision and the final candidate; later changes are provider metadata validation, compatibility ordering, versioning and evidence.
- Express cleanup confirmed created sandboxes deleted and templates absent. The workflow initially retained one unique job image tag with a cleanup journal; a separate exact-digest-checked cleanup deleted that owned tag and confirmed GET 404. The shared `python-hello` image repository was preserved. Eight temporary task credentials were removed from workflow secrets. A workflow that succeeds with the opt-in cloud step skipped is not counted as a live cloud test.
- Real OpenSandbox [T4 40105713813](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/40105713813) PASS with provider `f55e061650efb182745d92dcf3f39fb3e1b43f96`, CLI `90d6c3abfbb0b717ad5cc6e3922c6a18f6ecc960`, Python SDK `4bc11a701b8c262aefb27f6e59780749b1d3cb08`, and templates `7afc10cdd90cf01bc6871caae0a7f62aeec471d8`. Server 1.1.1 and pinned release-1.1.1 execd ran on the hosted Docker runner. Both the default native recipe and explicitly selected portable recipe built and pushed, launched through CLI, served CLI application commands, allowed Python connection and independent Python launch from the prepared image. Default source was not pre-converted or silently replaced by portable. Independent cleanup confirmed no sandbox containers remained and removed the job-owned local registry container. [The owning repository receipt](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/blob/feae1f2c/.agents/evidence/verify/2026-10-24-opensandbox-default-and-portable.md) records these inputs and limitations. Its documentation-only follow-up [40106282628](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/40106282628) also passed using the same CLI/SDK/template pins.

The source materializer implementation is identical in the OpenSandbox tested CLI revision and final candidate. Final provider pins containing later metadata/SDK fixes received the independent run below, rather than inferring success from the older run. These results cover one template with two profiles, not the unexecuted 46-template runtime matrix.


## Independent final-input OpenSandbox rerun

[Final T4 40106702699](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/40106702699) PASS with the exact final executable inputs:

- CLI `33c4e890d8017c6c89bb8e105a1f8432537ac3d0`.
- Python SDK `b2b9757be40df340bc8275386f5c23dbb55fa955`.
- Provider `0a5dc608e192055ed61b9e547a48d523a0d43105`.
- Templates `cd1de48216b933da95785412b9e49c75ad9a0676`.

Both `python-hello` default native and explicit portable build/push/CLI launch paths, CLI application invocation, Python connection and independent prepared-image creation passed again. Independent cleanup confirmed no sandbox containers remained and removed the job-owned local registry container. This is final-input runtime evidence for these two paths only. CLI commits after the listed executable input change engineering records only.

# Verification: Native component host and CLI log bridge

- Date: 2026-11-13
- Change: native-component-log-host
- Result: PARTIAL
- Environment: Node.js 22.22.2, Linux; placeholder credentials only

## What was verified

The existing main already contains direct official component loading. Its logger discards
progress. This change extends that host and bridges native logs into the existing CLI logger.

## Commands run

- `npx vitest run tests/test_cli/test_component_host.test.ts tests/test_cli/test_managed_component_runner.test.ts`
- `npx eslint src/application/component_runner.ts src/application/component_host.ts src/application/process.ts tests/test_cli/test_component_host.test.ts`
- `npm run typecheck`
- An isolated Node process loaded the downloaded official fc3 0.1.26 release with the official
  loader and invoked `getSchema` using placeholder credentials and an empty temporary project.

## Results

Six tests passed, including the original official-loader test, real process build/deploy artifact
handoff, copied credential snapshots, logger/console/split-stream redaction and descendant
termination on deadline. Scoped ESLint and TypeScript checks passed at this stage of the change.
The actual fc3 bundle returned its 41 top-level schema fields and one sanitized debug event.
No cloud API call or Docker build was made by that read-only component probe.

## Cleanup

Temporary fixture projects and runners were removed. No cloud resources were created.

## Not verified

This evidence does not establish cloud deployment, native Docker build/push, resource action
ordering, CLI artifact packaging or the complete repository checks. Those belong to the parent
resource-executor verification. The public resource contract is being changed concurrently;
whole-project checks must be rerun after consumer integration.

## Consumer integration checks

After the named-resource contract was vendored, the consumer checks were rerun:

- `npx vitest run tests/test_template/test_project_v1.test.ts tests/test_cli/test_managed_project_v1.test.ts tests/test_cli/test_component_host.test.ts tests/test_cli/test_managed_component_runner.test.ts`: 17 passed.
- `npx vitest run tests/test_providers/test_template_profile.test.ts tests/test_cli/test_template_application_setup.test.ts tests/test_cli/test_template_guided_configuration.test.ts tests/test_template/test_launch_plan.test.ts`: 46 passed.
- `npx vitest run tests/test_providers/test_template_launch.test.ts tests/test_cli/test_template_authoring.test.ts tests/test_providers/test_template_profile.test.ts tests/test_template/test_project_v1.test.ts`: 32 passed.
- `npm run typecheck`: passed after consumer integration.

These sets overlap; the numbers are per invocation, not a count of unique verified behaviors.
Retired automatic-instance tests were replaced with no-instance assertions. Independent native
Provider readiness, subprocess staging, source ownership and token-persistence tests remain.
The native Provider's internal historical step fixtures produce warning messages under the new
public validator; those fixtures do not establish public legacy format support.

## Full-suite consumer failure follow-up

The first whole-suite run exposed two actual consumer defects: generation appended the retired
`instance.envs` block after validating the new schema, and adoption still required retired
`services/ports` fields. Generation now writes the validated resource object unchanged; adoption
checks the actual Dockerfile server port and warns about additional exposed services. Prompts and
fixtures use named resources and Registry `parameters`. Catalog native identities remain intact.

`npx vitest run tests/test_agent/test_adopt.test.ts tests/test_agent/test_codegen.test.ts tests/test_agent/test_template_guide.test.ts tests/test_api/test_capability.test.ts tests/test_cli/test_template_commands.test.ts tests/test_cli/test_template_adopt.test.ts tests/test_cli/test_template_index_commands.test.ts tests/test_utils/test_template_index.test.ts tests/test_providers/test_express_source_workflow.test.ts`: **274 passed, 6 skipped**. The existing guide SDK-import checks require the separate server SDK environment; skips are not passes.

Scoped ESLint reported no errors and existing explicit-any warnings in older tests; the newly
unreferenced port-check exception class was removed. Whole-suite integration and cloud evidence
remain the separate resource executor's responsibility.

## Native release create-only guard and terminal lifecycle verification

The downloaded official fc3 0.1.26 archive SHA-256 is
`6b16e9d84392fde4e10c6982371066ba8d366be52e66c7929307a027d8546893`.
`scripts/verify-native-fc-create-guard.mjs --bundle <unpacked-release>` runs the original
release through the official loader against a local HTTP stub with placeholder credentials:

- Existing function: two reads, zero mutations; deployment rejected.
- Create conflict: two reads and one rejected POST, no fallback update or tag mutation.
- Successful create: three reads and one POST, returned native identity preserved.

These three local scenarios passed. They send no cloud requests. The native SDK default
endpoint is `fcv3.<region>.aliyuncs.com`; the host uses the same selected endpoint, including
explicit props.endpoint. Tests also cover HTTPS admission, proxy absolute paths, an actual
HTTP/2 stream, late SDK body readers, repeated-create rejection and native no-op rejection.

The focused final invocation covering deploy commands, catalog commands, command surface,
Provider isolation, true PTY onboarding and three component host/guard suites passed **80 tests
across 8 files**. The PTY harness independently completed eight checks: editable init,
overwrite decline/accept, hidden credential Ctrl-C restoration without persistence, resource
preview without effects, missing approval before credential requests, noninteractive modes,
and piped stdout with one final JSON document. TypeScript, scoped ESLint and packaged build
passed before this final invocation.

The three opt-in source E2E scripts now consume ResourceDeployment receipts and explicit
instance creation. The business workflow invokes the selected source's run.py and reads its
private session before testing CLI/HTTP hello and wrong-token rejection. Their JavaScript and
embedded Python syntax checks pass; these migrated scripts were not themselves executed
against cloud resources in this subtask. The former initialized-template application switches
report their replacement, rather than silently running an obsolete manifest startup path.

## Dedicated Docker environment preparation

Docker 26.1.5 was installed for the parent task's necessary build acceptance. The preexisting
policy-rc.d was preserved and prevented default service startup. A separate daemon uses a
private socket/data/exec directory and dedicated abx-verify0 bridge, MTU 1450 matching the host.
An actual Alpine Dockerfile download and RUN HTTPS request succeeded. This establishes this
local daemon's build/network path, not ACR push or Sandbox cloud registration. The parent
coordinates daemon teardown after its bounded cloud acceptance; no shared daemon configuration
was overwritten.

## Public command documentation follow-up

The remaining public README, quick-start, Provider authoring, command reference and runtime
configuration pages were aligned in both languages: deploy prepares named resources; explicit
sandbox create/delete operates dynamic instances; template run.py owns business startup.
Retired dynamic deploy flags, old sandbox.template.source and shared-launcher assertions were
removed from these current user entry points. Historical engineering records were not edited.
A focused search of README/docs/current authoring prompts found no remaining retired patterns.
Repository health completed with 105 passes, 11 existing historical warnings and zero failures;
relative links and bilingual page parity passed. git diff --check passed.

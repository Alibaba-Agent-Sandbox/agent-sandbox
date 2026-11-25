# OpenAPI request usability and byte integrity

Result: PARTIAL — focused source checks and local real-process HTTP/IO passed; combined repository CI and cloud deployment acceptance belong to the integration record.

Baseline: `b095ab0001f40f1f148e0552d0bdbc378eae11fd`. Scope: [Issue 276](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/276). No Provider cloud calls, cloud resources, package publication or SDK protocol changes were made by this work item.

## Decisions and adversarial review

The first independent review required a bounded change: keep the existing target-first API command, add qualified and unambiguous scalar options from the contract, preserve full JSON, reject duplicate input, and save binary data only through an explicit new-file output option. Unsupported features must remain explicit rather than turning a partial OpenAPI implementation into an implied universal client.

The second root review identified raw stdin decoding, post-request binary error wording and automatic credential provenance as material boundaries. Corrections read real stdin bytes with fatal UTF-8 decoding, explain that a non-idempotent request may already have taken effect, and restrict automatic credential references to a declared Server SDK v2 service whose health checks completed and whose actual injected token matches the current CLI token source. Only the reference and token fingerprint are saved; public deployment summaries and help do not contain either the token or fingerprint. A changed token fails before application HTTP. Arbitrary imports, other ports, header API keys, ambiguous bearer schemes and temporary distinct deployment overrides do not receive guessed credentials.

The independent workflow review checked its observed-status and JSON execution changes; findings about a remaining journal-based error hint were sent to that owner. The template-contract reviewer received confirmation of the CLI's exact API names, resource syntax, file bound and local-reference rules; its public wording was corrected to distinguish binding metadata from template startup.

## Verification

Executed in the owning repository with lockfile dependencies installed using `npm ci --ignore-scripts --no-audit --no-fund`:

- Six focused Vitest files: **143 passed, zero failed/skipped**. Files: `test_sandbox_api`, `test_sandbox_api_process`, `test_api_contract`, `test_deploy_commands`, `test_openapi_http`, `test_template_launch`.
- `npm run typecheck`: PASS.
- ESLint over all changed TypeScript source and test files: PASS, zero errors/warnings in the final run.
- `git diff --check`: PASS.
- `bash scripts/check-repo-health.sh --quiet`: 105 passed, 11 existing warnings, zero failures.
- `npm run check:hygiene`: PASS.

Regression coverage includes qualified/shorthand parameter mapping, literal `@` strings, explicit false/zero/empty values, ambiguous and reserved option names, duplicate singleton and field inputs, whole-body/field mixing, unsupported operation help, UTF-8/body limits, binary exactness, atomic no-clobber output, failure responses/partial streams without a success file, scoped credential reuse, token rotation refusal and readiness callback provenance.

## Real local components and failures retained

`test_sandbox_api_process` starts actual Node child processes, uses the CLI parser and real process stdin, communicates with an ordinary local HTTP server, and creates/removes output files. It verified `--id`/`--message` request mapping and bearer authentication; rejected invalid UTF-8 inside a JSON string before any application request; accepted Chinese UTF-8 input; and saved arbitrary binary bytes exactly while refusing an existing destination. Provider connection/endpoint resolution is a test seam, so these results are **not real-cloud evidence**. All child processes, listeners and test directories were removed.

Initial setup attempted an unavailable dependency-tree link and executed no tests; the lockfile install corrected that setup. A new readiness test initially expected exit 4, while the existing ProviderConfigError contract returns exit 2; the test expectation was corrected, without a production exit-code change. The first real-process fixture used an unsupported `authentication_audience: sandbox`; all three tests correctly rejected the endpoint. Correcting the fixture to the existing `gateway` contract made all three pass. These failures are not counted as successful runs.

## Remaining boundaries

No SSE, multipart upload, automatic local file upload, arbitrary scripts, implicit defaults, cloud AK/SK signing or full SDK compatibility was added. Complex body shapes use explicit JSON. Response schemas are documentation rather than response validation. Raw byte downloads remain bounded to 8 MiB, JSON input to 1 MiB. Normal calls never follow redirects or retry, including after output-file failure. Deployment authentication tests use service seams; cloud auto-binding still needs the combined release's real-template acceptance. A passing focused/local check does not establish package publication or a complete repository gate.

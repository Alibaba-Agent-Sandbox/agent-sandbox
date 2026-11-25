# Target-first Sandbox API operations

Result: PARTIAL — scoped implementation and real-cloud invocation passed; repository-wide gates are not yet green.

Baseline: main `57c7632706aac739171fcdb7c2849938e58295ef`. Node 22.22.2, Linux. [Issue 265](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/265). No package publication is part of this change.

## Review

Round 1: two independent reviewers inspected command routing/UX and contract/auth implementation boundaries. Both rejected a wrapper-only rename: main lacked fixed OpenAPI bindings; existing SDK command methods required Server SDK discovery routes. Their implementation requirements included offline help, endpoint identity, explicit credential references, strict bounded parsing, and platform command relocation.

Round 2 found concrete defects which were corrected:

- Preserve existing Provider query bytes when adding application query parameters; URLSearchParams normalization could invalidate signatures.
- Bind the deployed source snapshot, not an earlier read of mutable source.
- Preserve deployment association when rebinding its raw ID.
- Refuse multiple configured authentication alternatives.
- Support Provider-qualified IDs using syntax-only offline parsing.
- Use normalized operations to prevent aliases shadowing operations reached through Path Item references.
- Include cached components in operation help and format default help as readable JSON.
- Migrate public guidance, packaged Skill and scaffold instructions, including timeout semantics.

## Verification

Focused parser/platform batches: 191 and 283 tests passed. Contract compiler: 27 passed. Initial local HTTP/CLI batch: 7 passed; later transport, binding/deploy and authoring batch: 41 passed, 6 Server SDK cross-checks skipped because the adjacent SDK import was unavailable. Final aggregate checks are recorded below when complete.

A first full test run was invalidated by concurrent source edits and a rebuild that removed dist while subprocess tests were using it; it is not acceptance evidence. It also identified stale command captures and instruction assertions; their migration is part of this change. A transient full root filesystem interrupted file writes; affected new sources/docs were restored and focused checks rerun. No historic evidence was rewritten.

## Real components

The local HTTP workflow used a real server with no `/commands` or `/capabilities` endpoint. It verified a path/query/JSON-body request, separate traffic/application authentication, a 200 result, a 401 response with one request, and owned listener closure. Provider resolution was substituted in this local test, so this is not real-cloud proof.

The scoped Express cloud workflow passed through the built CLI: list, deploy from existing base, upload an ordinary Python HTTP service, start it, bind its OpenAPI, offline help, authenticated alias invocation, qualified-ID invocation and HTTP 401 with a wrong application token. Totals returned 60 and 3 for the two requests. The service had no Server SDK discovery routes. Normal delete completed; a separate remote list excluded the owned ID and qualified-ID status returned NotFound (exit 4). No resources leaked.

An initial attempt stopped at the existing `exec --background` path (exit 5), before API binding. Its normal delete also completed; the CLI delete implementation independently checks absence before reporting success. The final scoped run used an ordinary foreground shell to start the test service with detached standard streams. This preparatory command difference is not claimed as a background-exec fix. The two attempts used one temporary Sandbox at a time, never RDS, new management keys, images or repositories. The reusable final script is [cloud scenario](../scripts/sandbox-api-cloud-20261125.mjs). Credentials were loaded only in the execution process and are not recorded.

## Aggregate checks and baseline comparison

The complete `make ci` run on the original base passed hygiene, typecheck, lint and build, then reported 4,543 passed, 21 failed and 61 skipped tests (208 passed, 6 failed and 5 skipped files). Ten failures were stale CLI-path/fixture assertions and a packaged Skill path reference introduced by the command migration; the corrected safety and Skill suites passed all 75 tests. The remaining eleven failures concern existing MCP wire header order and HTTP/WebSocket transport behavior.

An independent reviewer ran the unchanged tests against a pristine Git archive of `57c7632706aac739171fcdb7c2849938e58295ef`, with Node 22.22.2 and the same dependencies. Both MCP failures reproduced (13 passed, 2 failed). All nine requested transport failures reproduced (18 passed, 10 failed); that baseline also failed the short Content-Length case which had passed in the feature run. Therefore the failed cases are established baseline observations in this runtime, but their underlying cause and identical failure totals are not claimed. They still prevent declaring the full gate green.

Main's independent option-alias and onboarding corrections were integrated, ending at base `5fc267392424931e2a8923cdfb54f144de895111`. The quiet generated-token diagnostic and both sets of deployment regressions were preserved when resolving overlap. No transport/MCP assertion was weakened or skipped to make this feature pass.

The second complete test run, invoked through `npm run parity:coverage` on base `6150436`, recorded 4,581 passed, 15 failed and 61 skipped assertions. Eleven failures were the previously reproduced MCP/transport cases. Four were integration-only legacy argv/error assertions, subsequently corrected: both integration suites passed all 22 tests. The original ledger reported three missing retired test names; explicit Issue 265 replacement mappings preserve those historical rows, and the seven affected ledger entries pass against the original report. Mappings describe changed contracts, not compatibility with old syntax.

The six template-guide skips were due to an unavailable adjacent SDK path. A pristine archive of the exact CI SDK commit `8e610a3658040d8d6973e7951f9590ea50a4d70a`, selected with `ABX_SERVER_SDK_SRC`, passed all 23 guide tests with zero skips. This does not imply that all other repository skips were eliminated.

## Final integration checks

- Typecheck and build: PASS after integrating base `5fc2673`; final test edits also pass typecheck.
- Final focused set (binding, OpenAPI, HTTP, deploy, option aliases, help, guide and captures): 397 passed with one stale config-init snapshot from the independently merged onboarding change. That snapshot was regenerated from the actual CLI; the entire capture regression then passed 86 tests. No product assertion was removed.
- Both parser-to-service/source-generation integration suites: 22 passed, including exact syntax errors and no-generation side-effect assertions.
- Strict help coverage: 224 passed; ordinary automatic help retains its original Usage-prefix assertion, and the custom Sandbox help has its own exact usage assertion.
- Offline capture: 85 cases, zero skips, 10 Markdown files; historical batches unchanged. A final active-text audit corrected Provider setup help and the non-TTY suggestion to use the current commands. The affected help/session/capture suites passed 254 tests; an exact non-TTY diagnostic probe also passed.
- Package entry/reference closure: PASS. The release artifact verifier passed against the built executable, including root platform tools, target-first help, retired-wrapper rejection, generated OpenAPI assets, isolated configuration, PTY cancellation and notices. This is built-artifact validation, not publication.
- Final ESLint: no errors, 258 warnings. Hygiene passed. Repository health: 105 passed, 11 existing warnings, zero failures. The generated ignored parity report was moved out of the checkout after analysis so local temporary paths do not pollute the health scan. Delivery status is recorded with the PR.

The complete repository test gate remains PARTIAL because of reproduced baseline failures; focused reruns are not described as a fresh all-green full suite. The raw full-run report is kept as local verification output, not committed. This change does not assert complete OpenAPI support, cloud signing, SSE, all Providers, or SDK protocol migration. No npm package, SDK, website, Registry or blog release is part of this PR.

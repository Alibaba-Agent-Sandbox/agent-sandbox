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

Final-head checks, remote CI and delivery status are recorded below after main's independent option-alias correction is incorporated. No transport/MCP assertion was weakened or skipped to make this feature pass.

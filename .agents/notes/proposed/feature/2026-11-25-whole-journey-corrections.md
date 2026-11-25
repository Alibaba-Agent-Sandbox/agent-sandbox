# Decision: Correct the observable Sandbox user journey
Status: proposed

## Problem

At b095ab0001f40f1f148e0552d0bdbc378eae11fd, the individual command paths do not consistently preserve a user's request, application identity or observed state. A successful deployment can leave its API binding without the verified service credential; a missing remote Sandbox can retain a public ready status; plugin streaming output mixes raw text with JSON. Request bodies can be silently replaced and binary responses decoded as text. Provider documentation still describes removed command routing and configuration aliases.

## Decision

Correct those paths using the current command parser, Provider adapters and OpenAPI contract. A verified matching Server SDK service may bind a reference to its actual injected token, guarded by a fingerprint; temporary secrets are not copied into configuration. Arbitrary imported contracts do not acquire default secrets. Describe client support separately from live service readiness and authorization.

Expose unambiguous scalar request flags with explicit location-qualified alternatives. Preserve the JSON body escape hatch, reject duplicate/mixed inputs before invocation, and provide bounded strict UTF-8 stdin and byte-preserving explicit downloads. Do not replay failed or uncertain requests.

Separate recorded deployment state from remote observation. Preserve stdout, stderr and nonzero exits in one JSON result; missing terminal events are not success. Public deployment and recovery results identify resources and actionable commands rather than internal files or correlation records. The private credential file remains available for external HTTP/SDK callers because it is user authentication configuration, not a build handoff.

## API Design

- `abx sandbox TARGET OPERATION --id VALUE` uses the unambiguous declared parameter; `--path-id`, `--query-id` or `--body-id` selects its location explicitly.
- `--body JSON`, `--body @FILE` and `--body -` are mutually exclusive with individual JSON body fields; input is limited to 1 MiB.
- `--output FILE` writes at most 8 MiB of successful response bytes to a new file. Errors do not create a successful download or trigger a retry.
- Named Sandbox status includes `recorded_status` and `observation`; confirmed absence is `status: missing`. Authentication/transport failures propagate.
- JSON streaming captures at most 16 MiB combined output. Overflow continues the existing execution observation until terminal completion, then reports that output was unavailable with the confirmed exit code.
- No style selector, SDK protocol emulation or Server SDK route/decorator rename is introduced.

## Alternatives considered

- **Global E2B style or broader lifecycle aliases:** rejected. Different parameters, return models and deletion scope cannot be corrected by changing command names.
- **Copy the global token to every imported schema:** rejected because a declaration does not establish its authentication audience.
- **Merge old workflow PR261 unchanged:** rejected as superseded. It retains public build files and registration during build. Issue260 now states the corrected contract; its completion is independent of these repairs.
- **Rewrite all deployment functionality in this patch:** rejected as a false completion claim. Native YAML, dynamic creation, Provider support and template migration require their own integrated implementation and verification.

## Dependencies

Existing CLI command parser, Provider application endpoint validation, strict OpenAPI loader, and deployment ownership store. Related: [Issue276](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/276), [workflow Issue260](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/260), [native-resource PR249](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/249), [template PR311](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/311).

## Test Strategy

Use negative and positive request/credential tests, actual child CLI processes with HTTP/stdin/files, native process execution tests and a single owned real Express Sandbox. Test missing/unknown/current remote state, invalid auth and changed token, ambiguous/duplicate parameters, binary equality and no-clobber, nonzero exit, missing terminal events and output limits. Run the repository CI equivalent, documentation and hygiene checks after integration. OpenSandbox service and full Serving deployment are separate acceptance scopes.

## Acceptance criteria

The corrected commands preserve request meaning and actual resource state; current English/Chinese documentation matches their reachable interfaces. Internal receipt paths are absent from affected public projections and recovery instructions. Independent first review and cross-review findings are resolved. Real-component verification and remaining gaps are recorded without substituting local fixtures for cloud acceptance.

## Evidence

- [Request integrity](../../../evidence/verify/2026-11-25-openapi-request-integrity.md).
- [Workflow state and output](../../../evidence/verify/2026-11-25-workflow-status-exec.md).
- [Integrated verification](../../../evidence/verify/2026-11-25-whole-journey-corrections.md).

## Whole-journey disposition

| Reviewed concern | Decision and actual delivery boundary |
| --- | --- |
| First protected API call after deployment | Fixed scoped verified-service credential binding; actual current-v5 Express call passed without manual binding. Native-v1 bootstrap remains separate. |
| Saved ready versus remote absence | Fixed and exercised against real Express after deletion. Transport/auth errors are not converted to absence. |
| Cross-Provider execution JSON | Shared bounded collector and terminal validation implemented. Actual Express and local real-process/plugin checks passed; no fresh OpenSandbox cloud certification. |
| Retired parser/config/command instructions | Corrected bilingual CLI guides and contributor routing instructions. |
| Pure build / static deploy / dynamic create | Separate native-core candidate under Issue260; full deployment migration is not delivered by Issue276. Public recovery file leakage is removed here; existing build handoffs remain assigned to that candidate. |
| Registry/OpenAPI schema and ingestion | Separate producer/consumer PRs318 and108 add the optional API metadata contract, validation and ingestion; this does not activate every native resource-v1 behavior. |
| Global E2B style and full SDK emulation | Not implemented: renaming cannot preserve lifecycle scope, protocols or typed results. Existing independently useful SDK/Provider contracts remain. |
| SDK ID versus URL, ownership and credentials | Python SDK documentation PR180 clarifies actual entry points and cleanup; no new SDK release is required for prose. |
| Offline help versus support/readiness/auth | Help identifies supported invocation shapes and limitations; it makes no authorization or live-readiness claim. |
| Duplicate input and damaged binary output | Fixed with pre-request conflict rejection, strict stdin and bounded byte-preserving downloads; real local HTTP/process/files verification passed. |
| HTTP acceptance, task completion and cancellation | Documentation distinguishes each stage, timeout and lease. This is not a new durable task engine. |
| Restart-safe idempotency | No blanket claim. Historical/local in-memory ledgers are not proven durable; managed revision reliability remains its separate implementation/acceptance work. |
| Local files, uploaded file IDs and model attachments | Existing filesystem operations remain distinct. Generic caller does not guess chained uploads or model attachment consumption; multipart/SSE/signing remain explicitly unsupported. |
| Multiple templates and truthful next steps | Native-core candidate requires explicit selection for ambiguity and exact Provider identity. Serving business URL discovery and API bootstrap are pending integrated acceptance. |

Related cross-repository delivery: [templates318](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/318), [Registry108](https://github.com/Alibaba-Agent-Sandbox/registry/pull/108), [Python180](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/180). These links are review/delivery references; each repository's actual remote status remains authoritative.

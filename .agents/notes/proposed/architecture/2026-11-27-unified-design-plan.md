# Decision: Implement the unified CLI through the shared Node client
Status: proposed

## Problem

The target design changes command routing, template deployment, client selection and Agent access together. Implementing only the command names would leave credentials, helper installation, SDK behavior and resource cleanup inconsistent. Existing commands and historical verification remain evidence of their tested versions; they do not establish that the target workflow is available.

This proposal assigns the CLI repository's implementation work. It does not implement or release the design.

## Decision

The CLI consumes the Node Client SDK for Provider operations, access resolution, data protocols and helper execution. CLI code owns argument parsing, terminal output, user configuration, installation orchestration and deployment records. The shared client must remain usable without CLI state or imports.

| Task | Deliverable | Order and observable completion |
| --- | --- | --- |
| CLI-01 | Canonical command routing, static descriptions, `PATH INSTANCE`, `sandbox help INSTANCE` and TOML shortcuts | After shared operation contracts. Every accepted path reaches its declared operation; unknown paths and conflicting inputs fail before business execution. Static help neither imports helper code nor starts a runtime. |
| CLI-02 | Template initialization, source helper installation and local style selection | After source/descriptor contracts. A template containing an unpublished Node helper installs to CLI-managed dependencies; init records an explicit recommendation, installation does not set a default, and first deployment associates a prepared selection only with a confirmed cloud template identity. |
| CLI-03 | Resource YAML build/deploy/status and explicit resource cleanup | After template and Provider contracts. Build produces artifacts, deploy records actual resources and failures, status remains read-only, and deletion uses an explicitly selected real ID. Updated input cannot silently reuse an incompatible deployment description. |
| CLI-04 | Create/connect and business calls through the Node Client SDK | After the relevant Node/Provider capabilities. A protected instance created in one CLI process is usable from a later process without copying tokens; a new machine explicitly connects. Help and ordinary calls never connect or resume implicitly. |
| CLI-05 | Fixed MCP tool catalogs and the CLI operation Skill | After CLI-01 and CLI-04; helper tools also depend on CLI-02. MCP explicitly creates/connects, retains the returned access handle, invokes the selected operation and distinguishes owned from borrowed cleanup. Skill instructions describe the implemented commands and actual preparation steps. |
| CLI-06 | Installable artifacts, bilingual usage and release evidence | After the relevant preceding tasks. Test the actual npm/standalone artifacts in isolated installations, then update affected user documentation, system Skill material and changelog for the verified release. |

CLI-02 and CLI-03 may proceed independently after their contracts are fixed. A usable existing-instance path through CLI-04 does not wait for unrelated Serving deployment work. There is no compatibility command tree, implicit shell fallback, public engine command, bindings file or replacement for the removed bulk undeploy command.

## API Design

The public surface is the canonical resource tree: `template`, `sandbox`, `volume`, `provider`, `config` and `mcp`. Provider-specific account resources remain under `provider PROVIDER_ID`; a Provider's implementation location alone does not determine public routing.

The CLI projects shared operation inputs and results. Dynamic business operations use `abx sandbox <path...> INSTANCE [options]`; `abx sandbox help INSTANCE` resolves the selected instance catalog. Fixed management operations remain available when a style dependency is absent. `--help` without an instance uses static published metadata and cannot import or execute a helper.

`template style install` prepares a selected Node source and returns its precise package identity. CLI rules can select that identity, but SDK applications use their own dependencies and explicit imports. SDK clients must not read CLI installation directories, template rules, credential records or implicit HOME/CWD defaults.

Human selection hints use stderr. JSON output contains one result with selection metadata; streams retain their actual protocol. Explicit connection stores access information privately with its target and audience. Ordinary output never serializes tokens. Platform ingress authentication and explicitly selected application authentication remain separate.

### Follow-up contract clarification

CLI-02/03 own initialization and explicit private inputs; CLI-01/04/05 own business result projection and service identity; CLI-06 owns release guidance. These refinements stay within the existing tasks; no additional subsystem or completed implementation is implied.

Initialization prepares and validates the complete source in its own staging directory, saves explicitly collected private inputs and preferences for the final path, then publishes into an absent or still-empty destination without overwriting concurrent files. Failure before publication leaves no partial target source; report already-saved private inputs and allow rerunning the original init command. Ordinary unsaved answers are collected again and a changed source version is shown. No cross-store transaction, nonempty-directory takeover or resume command is introduced. After publication the directory is valid; an output failure must not delete it or suggest overwriting it with init.
The CSV Serving example is an explicitly selected custom-Bearer flow, not a default automatic-token flow. A declared sensitive input collects or reuses an existing application-managed value; absent values fail before deployment, and repeat deployment does not generate or rotate it. CLI private configuration does not populate SDK process environments. SDK-only callers explicitly supply the same existing value from their application's own configuration; no CLI dependency, implicit secret retrieval or second random token is allowed. Normal no-manual-token examples use their declared platform or FC-signed ingress. Do not change only the FC trigger and claim the old Bearer service supports signing.
A received upload identity remains observable when a later helper stage fails. Preserve the original exception/HTTP details and recognizable cancellation, with safe progress containing the completed stage, known file ID and actual cleanup state. An unknown submission is not safe to replay or automatically delete. Explicit file deletion affects only the caller's selected upload, never a borrowed instance. MCP cancellation/disconnection cannot guarantee delivery of a final error or identity; do not add a recovery daemon or claim durable recovery from exception fields.

Raw HTTP request/invoke keeps its status, allowed headers and body, including non-2xx. CLI and MCP adapters use actual HTTP executor metadata to report non-2xx as failure, not the presence or absence of an exception or an arbitrary business `error` field. A submission returning 202 is accepted, not completed; a completion-promising helper must observe its actual terminal contract. Successful tool output schemas do not constrain error content. Keep native E2B/OpenSandbox exception and process-result semantics intact.

Default MD5 application authentication requires both sides to know the same real instance and historical cloud-template identity. Native connect may obtain platform traffic credentials without recovering that association. A Provider-verified mapping or an explicit caller assertion based on original creation facts may supply it; current Registry aliases, downloaded source and unverified runtime fields may not. The optional shared service binding `template_id` fills an unknown association only, never overwrites a confirmed identity or changes server-side identity, and is distinct from a platform-verified mapping. Compare only identifiers with the same confirmed semantics. Missing identity disables that authentication branch, with no alias guessing or authentication downgrade. The derived value is not strong authentication.

For instance business/help, optional `--template-id` is a caller identity assertion, not a create request. Existing `--template` requires a confirmed association to this instance. `sb.bind(template_id=...)` and OpenAPI options share the SDK resolver. CLI JSON failures retain safe response/progress; accepted submissions set completion metadata to accepted. Release notes show representative command/parameter/output/lifecycle changes; shortcuts only rewrite paths. Do not restore old command trees or reinterpret old YAML as v1.

### Detailed delivery contract refinement

The detailed review adds finite parameter, response and capability requirements to these existing tasks. The [Python-owned neutral delivery contract](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md#detailed-delivery-contract-refinement) is the shared source for resource inputs/results, Express coverage, native-field preservation and E2B semantics; this owner record assigns its consumer implementation rather than duplicating that specification.

Record implementation, contract tests, real-backend acceptance (exact platform/runtime combination) and release artifact separately. These remain proposed requirements. A documentation or merge result completes none of the runtime states. The common contract requires explicit create/get/connect, positive optional connect TTL only when declared, standard list pagination and the closed ActionResult model. Ordinary result output is redacted; a write with an unknown result is not replayed. SDK runtime configuration never comes from implicit CLI state.

The fixed 2026-11-27 official management metadata contains 41 operations; the earlier 29 already included template cache. Native request/response nested fields matter, not only operation counts. Instance E2B HTTP and envd data capabilities are separate. Instance logs/metrics remain required but cannot be registered as supported until the fixed native parameters and actual platform/follow semantics pass. Do not fabricate since/tail/step mappings or turn placeholder metrics into measured zero.

The built-in E2B helper target is the explicitly declared files/commands/PTY set against separately pinned Python and Node 2.31.0 sources. It is not full E2B cloud compatibility. Legacy-envd regular-file upload needs a genuinely bounded multipart encoder; unknown-length input without verified streaming support fails before consumption/submission. Command capture has a configurable 16 MiB default, including upstream accumulation; overflow preserves known PID/partial output without implicitly killing the process or reporting completion.

#### CLI owner completion checklist

CLI-01 expands the canonical tree to 47 fixed leaves, 15 Express account leaves and 18 additional Express extensions. E2B contributes 23 explicitly selected data leaves. Counts are a finite review inventory, not implemented support. Each leaf must publish its parameter-group expansion, exact required/optional arguments, types/defaults/units/conflicts, response schema, error/exit behavior and an executable usage example. Static host options are not universally accepted by every command.

The 18 additional extensions are template-cache create/info/list/delete; custom-domain create/info/list/update/delete; warm-pool create/info/list/update/delete; Provider-level metrics and usage; sandbox timeout; and sandbox volume-mount append. Warm-pool item targets are TEMPLATE_ID, not a pool name. Provider metrics/usage are context operations, with no second query command alias. Express nested parameters are complete JSON contracts, not arbitrary passthrough objects.

CLI-01/04 own these 23 E2B projections: files read/download/upload/write/write-files/list/info/exists/mkdir/rename/remove/watch; commands run/list/connect/stdin/close-stdin/kill; pty create/connect/input/resize/kill. Use PATH INSTANCE consistently. Native command/request/watch timeouts use distinct explicit options, rather than stealing the host total deadline. PTY bytes and streamed terminal results must not be collected into a fake unary JSON response. A backend process nonzero exit remains visible in the result while CLI uses its stable failure exit category.

CLI-02/03 retain one template.yaml resource entry point, explicit unpublished-source helper installation, no install during init/help and no hidden SDK dependency on the CLI store. Reversible style set/unset does not add another confirmation step. Provider uninstall removes its managed installation, not credentials or configuration; there is no purge flag. Config file input is optional, not a required token/bindings handoff.

CLI-04 must test safe ordinary output versus explicit Key/config secret output, one HTTP failure mapping through SDK/CLI/MCP, and list pagination/status/metadata without old state aliases. CLI-05 must use the same static operation input/output contracts and avoid exposing unverified streaming capabilities as unary tools. CLI-06 must validate actual standalone/npm artifact dependencies and both translated instructions before claiming delivered use.

## Alternatives considered

- Rename the old command tree while retaining old routing and fallback behavior: rejected because it would preserve the wrong lifecycle and discovery semantics.
- Reimplement HTTP, authentication and helpers inside the CLI: rejected because SDK-only applications would continue to behave differently.
- Install or activate helpers during help, init or first business use: rejected because these operations do not authorize code installation or execution.
- Add a cross-machine deployment takeover or bulk deletion mechanism: outside this design; explicit real-resource management already provides the required cleanup path.

## Dependencies

The companion records below target `main`. Each link becomes available when that owner's planning PR merges; publishing a plan does not establish product delivery.

- [Node client, helper and server work](https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).
- [Provider contracts and implementations](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).
- [Template and Registry YAML ownership](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).
- [Registry static distribution and discovery](https://github.com/Alibaba-Agent-Sandbox/registry/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).
- [Python contracts and independent consumer](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).

Land shared contracts before their consumers. Pin and record the actual compatible artifacts when implementing a task; this plan assigns no future version number.

## Test Strategy

For this proposal alone, validate ADR structure and links, repository health and hygiene. Do not create cloud resources to validate prose. Runtime work follows the repository definition of done, required CI/review gates, `make test`, `make lint`, `make typecheck`, build checks and applicable real-component E2E. Update affected command snapshots without rewriting historical captures.

Exercise parsing with reserved words as instance aliases, missing targets, host/business option collisions, shortcuts and unavailable styles. Use a helper import sentinel to prove static help does not execute code. Exercise unpublished local/Git helper sources, conflicting identities, uninstall and deterministic reinstall.

Use one controlled platform setup for the supported end-to-end path: initialize and customize a template, install its helper, deploy, create, run help, perform a file-backed business operation, reconnect in a separate process and delete owned resources. Verify public/protected/unknown authentication outcomes without anonymous retries. Separately inject cleanup failures to verify retryable handles and preserved errors. MCP must demonstrate an actual business result and cancellation/ownership handling, not only a handshake.

## Acceptance criteria

Follow-up acceptance also requires:

- Inject private-store and publication failures; verify a usable rerun without clobbering files, explicit partial-save diagnostics and preferences bound to the final directory.
- Project raw 401/500, 202 submission, missing completion, named errors and helper progress into correct exit status and legal MCP errors. Test actual transport metadata, not business fields.
- Verify explicit template identity assertions, alias/real-ID distinction, missing association errors and custom-token reuse without ambient SDK configuration.


- CLI-01 through CLI-06 have separately recorded implementation, tested artifact and remaining-gap status; approving this ADR completes none of them.
- An ordinary CLI user can complete the supported template-to-result path without parsing internal records, manually exporting an application token or learning engine commands.
- The same Node operation and helper produce equivalent business results through the SDK and CLI; CLI-only preferences do not change SDK behavior.
- Help, status and tool listing cannot create/resume instances, install code or initiate business work. Failure preserves useful static help and identifies the missing information.
- A failed or partial deployment and a failed delete expose actual known targets and retained resources. Independent observation confirms owned test-resource cleanup.
- Required tests, real-component evidence, bilingual usage, applicable changelog, artifact checks and remote gates pass before claiming the corresponding feature delivered. Public examples describe available releases; design-only material stays in engineering records.

Document validation and review disposition: [verification](../../../evidence/verify/2026-11-27-unified-design-plan.md).

Follow-up review and verification: [failure and authentication contracts](../../../evidence/verify/2026-11-27-feedback-contracts.md).

Detailed delivery-contract verification: [parameter and capability review](../../../evidence/verify/2026-11-27-delivery-contracts.md).

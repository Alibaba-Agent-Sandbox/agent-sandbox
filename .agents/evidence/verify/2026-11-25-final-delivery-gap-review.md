# Verification: final delivery and remaining requirement review

- Date: 2026-11-25
- Result: PARTIAL — this is a source and delivery audit, not completion of the entire original request.
- Scope: a new checkpoint after the [40-topic coverage review](2026-11-25-full-request-coverage.md); that historical file is unchanged.
- CLI source checked: native candidate `fe04ef6d288cf5705380f39cb874359056a80d9f`, merged by [PR281](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/281) at `90d7708297b5de17b1f41ed7313ef0d0db1ed2f1`, and publication-record main `c156f9edb2289c7d0101e906008afec0e4027d52`.
- Public CLI remains `0.6.0-alpha.2`, built from `fb4de80458e2c002cc05f70616a0de04f1ab8f03`. It does not contain PR281. No new release is performed by this audit.
- Method: read actual current source, compare the old candidate with the merged implementation, inspect owner evidence and remote PR state, and challenge claims against the executed acceptance scope. No new cloud resources were created.

## Changes since the earlier checkpoint

| Topic | Verified new state | Boundary |
| --- | --- | --- |
| CLI delivery | [PR286](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/286) merged `c156f9edb2289c7d0101e906008afec0e4027d52`; independent public npm and Linux binary consumption passed. | The [release record](2026-11-25-cli-060-alpha2-public-release.md) preserves initial metadata/install/tarball failures and subsequent success. Stable remains 0.5.10. |
| Native resource core | PR281 is merged, with local build, static deployment, named-resource instance selection and observed status. Controlled real Express Template/instance and FC function publication/deletion checks are recorded separately. | This is source delivery. The current public alpha.2 has the earlier behavior. Static FC publication is not a running business API or a successful function invocation. |
| Devs logging | `component_runner.ts` now carries redacted logger/progress/console/stdout/stderr events over a separate bounded channel; `component_host.ts` routes them into the existing CLI logger. Credentials use the existing callback. | The earlier coverage table's description of logs as only counted/suppressed is superseded. This does not prove every third-party component output form or SEA worker path. |
| Python narrow follow-up | [PR189](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/189) merged `96acac6ba5b3b99f60ec81a360c566c27b976e29`; `kill_sandbox` now uses lifecycle error sanitization, and affected bilingual package/CLI reference pages are corrected. Issue169 and superseded PR170 are closed. | Public paired 0.5.0a1 contains the earlier cleanup/protocol fixes from PR185, not this later sanitization change. No second package release was performed for this follow-up. |
| Template conventions and architecture | [PR319](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/319) merged `c647eae`; it delivers bilingual authoring/evaluation guidance and the existing Agents API module/cloud-product diagram. Old PR300/301 are closed as superseded. | The 51-template assessment remains explicitly historical. Rechecking its source hashes is not a new evaluation of the current catalog or new runtime qualification. |
| Website installation/reference corrections | [PR124](https://github.com/Alibaba-Agent-Sandbox/website/pull/124) and [PR125](https://github.com/Alibaba-Agent-Sandbox/website/pull/125) are delivered; independent readback verified bilingual current reference routes and start pages with CLI alpha.2 and Python 0.5.0a1. | Published preview npm, same-version source and stable installation paths retain their separate command families. This is not native-v1 release documentation. |
| Current Agents API topic and article | [Registry111](https://github.com/Alibaba-Agent-Sandbox/registry/pull/111) merged `f243414`; normal deployment45609633304 and independent bilingual topic readback passed; [Registry112](https://github.com/Alibaba-Agent-Sandbox/registry/pull/112) records that publication and Issue110 is closed. [Website127](https://github.com/Alibaba-Agent-Sandbox/website/pull/127) merged `746ca876`; deployment45609947948 and independent nine-URL readback passed. Both sites' bilingual topic pages returned actual content and mutual links. [Blogs45](https://github.com/Alibaba-Agent-Sandbox/blogs/pull/45) merged `5500df45` after CI45610494794; Website article ingestion is pending at this checkpoint. | The topic uses the existing `agents-api` template and its historical real article. It does not list six unpublished managed Harness recipes. The old broader Registry105/Website121/Blogs43 scope is not declared complete. |

## Remaining necessary work: concrete cause, ownership and next step

“Internal” below means work has not been completed; it does not mean the platform prevents it.
“External validation” identifies a specific service/runtime/account prerequisite. An open Draft
or an old date is never itself a technical blocker.

This review does not assert that model credentials or a usable OpenSandbox endpoint are absent
from existing private configuration. Those input sources must be inspected before claiming an
access blocker. Their suitability for the particular native-interface acceptance has not yet been
established here. Tests not executed remain unfinished work. The Express behavior below is the
documented and observed boundary of the inspected path, not proof that the platform can never
offer another supported startup mechanism.

| Requirement | Concrete gap and why delivered work does not replace it | Smallest next step and owner |
| --- | --- | --- |
| Business API startup on a newly created native Sandbox | **Platform contract plus internal integration.** Express generation 2 snapshots template-time start/ready commands; its documented path does not run OCI CMD/ENTRYPOINT at instance creation. Instance environment variables available to a new process do not prove a snapshotted Server SDK has reread its token. The current Server SDK caches authentication configuration. The v5 launcher starts a fresh process through the existing data plane; native static create does not. | CLI/Provider + Python Server + template owners: first select and demonstrate a supported per-instance startup/configuration channel and authenticated readiness. Reuse a verified Provider mechanism if one exists. Otherwise record the missing platform primitive and its owner. Do not replace it with an unauthenticated secret-setting endpoint, a shared snapshot token or a renamed template-time command. |
| “Empty Sandbox” and eventual envd removal | **Internal implementation and the startup dependency above.** OpenAPI registration describes an existing service; it does not install or start it. Existing Express/OpenSandbox native exec/files/readiness paths still use their Provider data planes. OpenSandbox currently waits for execd readiness, so removing its runtime also changes lifecycle success criteria. | Provider owners: separate control-plane creation from optional data-plane readiness, then implement one actual registered-service path. Preserve distinct capability errors. No unknown-operation Shell fallback and no claim that deleting an ineffective envd option removes envd. |
| New YAML consumers and all-template migration | **Internal cross-repository work, with service templates gated by startup.** Current templates still use spec5 and managed `agents-api` spec6. Python workflow launch validates spec5; its separate planner still has its own older workflow contract. Templates311 removes service/start/env declarations that existing `run.py` startup consumes. A resource schema passing does not migrate those consumers. | Templates + Python + Registry + CLI: update one complete minimal recipe across initialization, schema/reader, SDK consumer, build/deploy/create, API binding and cleanup before applying the same validated transform to the catalog. Parser/metadata work can proceed now; do not publish a catalog-wide service migration until startup works. Track SDK164, Registry102 and template Issue309/PR311. |
| Final complete YAML reference and demos | **Internal documentation/contract work.** The new native core implements the confirmed top-level shape, but complete Provider-field/lifecycle coverage is not established by its shape tests. Template creation, dynamic instance options and static/dynamic volume mounts are different APIs. Custom domains belong to a specific network/Serving product. | Template/Provider owners: produce a field-to-native-API coverage table with types, defaults only when documented, mutually exclusive branches and update behavior. Include executable local resource/Registry examples and separate optional branches. Keep `template.region`, arbitrary `vars` names and resource-owned actions; do not require every optional native field. Sync the final actual consumer schema and bilingual manual. |
| Image and `buildConfig` semantics | **Resolved in PR281 source and guides; unsupported OCI export is not a remaining implementation promise.** Dockerfile/context construction is separate from publication, defaults context to the Dockerfile directory, and treats image as its target; native Steps treat image as their source. No verified Express contract exports the resulting prepared template as an arbitrary OCI image to that repository. | No additional generic build feature is needed. Preserve the implemented distinction and validation in the final template migration. Reconsider Steps export only if an actual native capability is established; do not pretend a Dockerfile installation step performs cross-repository image copy. |
| Pure build across resource kinds | **Resolved for the supported local-build contract in PR281.** Local Docker construction is pure and private cache handoff stays internal. Explicit no-local-build/deferred results for native Steps and Serving component work are deliberate because those operations may have service-side effects. The old managed application migration remains a separate row below. | No new universal build task or second build DSL is proposed. Preserve the explicit behavior and keep cloud publication in deploy. The remaining public-version delivery boundary is that alpha.2 does not contain PR281; no new release is performed by this audit. |
| OpenSandbox named resource deployment | **Internal adapter gap.** PR281's named resource executor handles Express; current OpenSandbox image-backed creation is a different existing Provider route. A fabricated OpenSandbox Template control-plane API would be incorrect. | OpenSandbox Provider + CLI: adapt the existing image preparation/reference contract to named resources and saved ownership, then validate against an actual reachable OpenSandbox backend. Keep an explicit unsupported result until then. |
| Serving targets and one Gateway URL in the new call UX | **Internal feature gap.** Static FC deployment has no verified public business endpoint binding. A function identity, FC API endpoint override or component output object is not automatically a Sandbox identity or authenticated Gateway URL. Current `registry.apis` binding permits `sandbox.NAME` only. | CLI + Registry + application owner: add a distinct Serving target binding using an actual resolved endpoint and its declared authentication/audience. Reuse the request transport; do not route a function ID through Sandbox connect. Then connect the native resource recipe to the existing Gateway application lifecycle. |
| Removing the old managed application recipe without losing behavior | **Internal application migration.** PR281 deliberately preserves the working spec6 deployment path. Native static FC deploy/delete does not supply managed database schema, credential targets, stable Gateway routing, revision admission, draining or existing Session continuation. The discarded PR249 reader simply rejected old recipes. | CLI + managed SDK + templates: port the existing business configuration into application-owned files/runtime, while resource YAML owns only resources. Verify update/retirement and old Session behavior before removing the old reader. This is not a request for a new application framework or an additional public `app` command. |
| OpenAPI file input | **Internal unsupported feature.** Current request content supports JSON; JSON body files/stdin and explicit base64 JSON can be used where the service accepts them. Binary `--output` preserves response bytes but is not multipart/raw upload. | CLI transport + contract owner: implement a bounded explicit file parameter for a concrete OpenAPI multipart or binary request shape, with filename/content type/size/cancellation behavior and real local HTTP tests. Retain `--body` as the whole-JSON escape. No automatic multi-request upload or arbitrary local-file access from a schema default. |
| OpenAPI streaming | **Internal unsupported feature.** Current transport explicitly rejects SSE/multipart responses. JSON invocation and bounded download do not establish streaming event order, cancellation, backpressure or terminal status. | CLI transport + API owner: implement the actual Agents API SSE subset with bounded parsing, clear output mode and cancellation, without replaying a non-idempotent request. Validate real local streaming before a cloud business claim. A generic workflow engine is unnecessary. |
| OpenAPI authentication, generated defaults and local values | **Supported subset plus internal gaps.** HTTP bearer/header API-key references and narrow verified service-token auto-binding exist. OAuth and AK/SK request signing do not. The current Sandbox endpoint path requiring operation signing is explicitly rejected. A security scheme describes authentication, but does not implement canonical signing, session-token handling or credential audience. | CLI/Provider transport owners: reuse the selected Provider's signer for a declared supported scheme and target; require explicit credential source and reject ambiguous choices. Keep auto-binding limited to actual verified same-port Server SDK token provenance. Add defaults only where the operation's declared parameter source is deterministic; never evaluate schema code or read arbitrary secrets. |
| Six managed Harness templates with one protocol | **Internal adapter/recipe work plus external model prerequisites.** Current managed Server SDK admits only Codex and Qwen Code. Local adapters for other agents do not implement the same managed Session/Turn contract. Template312 pins unpublished 0.4.0a8; published 0.5.0a1 does not contain SDK165, so replacing the version string cannot supply the missing code. | Python managed API + template owners: rebase SDK165 adapters and recipe312 on current contracts, preinstall pinned Harness binaries in images and test one common create/input/items/files/cancel/delete contract per adapter. Real native account/model access and a tool/file task are concrete validation inputs; code integration is internal work that can proceed independently. Preserve separate application and standalone-Sandbox template identities. |
| OpenAI alignment and managed reliability | **Internal implementation and explicit compatibility decisions.** Matching URL paths does not make queued input active steering, process-memory idempotency durable across restart, or an attachment metadata endpoint actual Harness file consumption. Local core and the existing managed profile have different guarantees. Earlier Qwen two-turn acceptance cannot certify new adapters or all official API semantics. | Python API owner: finish the concrete typed-input/saved-agent fixes in SDK163, classify each official operation as equivalent, intentionally different or unsupported, and test the implemented contract. For managed execution, verify uncertain submission, event gaps, cancellation/stop confirmation, persistent state and revision transitions. Do not promise strict full compatibility or create an unbounded conformance project. |
| Provider language selection and managed runtime download | **Internal SDK integration/publication plus one specific external validation gap.** SDK167's actual candidate uses explicit trusted locks, prefers a compatible installed native implementation, and can fetch verified Node/EPP artifacts. It does not automatically install native Python packages or transparently replace every existing `ProviderSandbox` loader. Its first runtime target is Linux x86-64 glibc. Real Express passed; OpenSandbox cold/warm/offline checks used a test backend. | Python + Provider owner: finish the bounded explicit-lock API integration and release gates, then run the same contract against a reachable real OpenSandbox backend. Backend availability is an external prerequisite; the remaining loader/public API work is internal. Use existing EPP/cache/lock mechanisms, not a bundled full CLI or new installation framework. Built-in Express Python already exists independently of this work. |
| MCP deployed on FC for a remote Agent | **Topology choice and unexecuted validation.** Local real HTTP-to-Express create/exec/delete is verified. Sessions and failed-cleanup handles are process-local and do not survive restart or migrate across FC replicas. Generated deployment files and installed ASGI tests are not a real FC deployment or a remote Agent workflow. | CLI/Python MCP owner: state the supported single-process/session routing topology, then validate that exact deployment and one remote Agent lifecycle. If replicas are required, design only the missing routing/state behavior. Do not silently claim active calls are fully drained or all optional MCP features are implemented. Existing local stdio/HTTP use remains valid. |
| Current catalog AI evaluation and per-template articles | **Partly delivered documentation, internal review/content work.** PR319 establishes the convention and evaluation method; its 51 entries are a dated assessment. Current source rehashing does not re-evaluate usability, business APIs or performance. Historical real articles do not certify newly migrated/six-Harness recipes. | Template + Registry + blogs owners: evaluate current catalog identities with explicit static versus runtime evidence, publish only honest current results, and write new scenario articles after actual business runs. Existing articles need current installation/quick links, handled by Blogs45. Do not create databases or fake model outputs to fill article coverage. |
| Complete manuals and final demo packages | **Internal synchronization after actual consumer changes.** Detailed CLI/SDK guides exist and current false examples were corrected; this is not every command/parameter combination tested against the final native design. New templates cannot reuse old output captures as fresh acceptance. | Owning repo docs: use actual parser/schema/help outputs to update only affected current guides and examples with matching install versions, credentials, outputs and cleanup. Preserve historical captures. Complete each demo with real code, Dockerfile, Registry metadata, resource YAML and supported HTTP/SDK calls. Do not rename Server SDK decorators or HTTP routes just because the CLI wrapper disappeared. |
| Standalone native resource engine | **Independent candidate not delivered by PR281.** Old PR249 contains SEA parser/component worker assets and dispatch code that PR281 intentionally did not import. Current source explicitly rejects native component workers in SEA. The five-platform alpha.2 artifact check predates PR281 and cannot certify this omitted path. | CLI release/runtime owner: isolate the useful worker packaging change from PR249, rebase on the current bounded runner, and prove extracted real artifacts outside repository dependencies. Keep PR249 open for this distinct remaining scope unless it is explicitly transferred to a replacement; do not revive its cloud-writing build or wholesale removal of working spec5/spec6 consumers. |

## Independent review of PR249 replacement

Compared the old candidate `48a85f2f9151a343306a14c04630808abb90bcd0` with the actual
PR281 candidate `fe04ef6d288cf5705380f39cb874359056a80d9f`, not with a stale local
`origin/main`. Remote PR249 remains open/Draft at this checkpoint.

- Strict v1 contract/parser, resource plan/executor, Express resource API, component creation guard,
  Devs runner and log bridge are carried by PR281. Their current ownership/readiness/build semantics
  also include the subsequent review fixes.
- Old `buildOnly` registration, public build-file handoff and unconditional rejection of the managed
  recipe are deliberately replaced behavior, not features to restore.
- `application/instance.ts` was a managed custom-instance validation helper in an otherwise rejected
  managed-reader path. It is not a solution for instance API startup or token hydration.
- `application/portable_worker.ts`, `scripts/build_binary.mjs` worker assets,
  `scripts/verify-sea-native-engine.mjs` and corresponding artifact tests contain a distinct SEA
  packaging candidate. Current PR281 explicitly requires npm for component execution.
- Therefore PR249 is **not wholly superseded**. Retain its useful packaging scope or transfer that
  scope explicitly before closing. This conclusion does not declare that candidate accepted or
  publishable, and it does not imply bootstrap was implemented there.

## Source anchors and evidence boundaries

- Native CLI: `src/cli/resource_deployment.ts`, `src/template/local_build.ts`,
  `src/providers/alicloud_express/local_build.ts`, `src/providers/alicloud_express/resource_executor.ts`,
  `src/application/component_runner.ts`, `src/application/component_host.ts` and
  `src/application/portable_worker.ts` at the fixed PR281 source above.
- OpenAPI: `src/cli/api_contract.ts`, `src/cli/api_binding.ts`,
  `src/cli/commands/sandbox_api.ts` and `src/transport/openapi_http.ts` in the published alpha.2 source.
- Bootstrap: [CLI native readiness review](2026-11-25-native-migration-readiness.md) and
  [template owner audit](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/.agents/evidence/verify/2026-11-25-native-template-startup-audit.md).
  Official sources are [Express template construction](https://help.aliyun.com/zh/agent-sandbox/build-and-manage-custom-templates-with-code),
  [instance environment variables](https://help.aliyun.com/en/agent-sandbox/environment-variable) and
  [Sandbox API metadata](https://api.aliyun.com/meta/v1/products/Sandbox/versions/2026-08-20/api-docs.json).
  The documented Create/Update generation-description conflict remains a validation boundary.
- Python current managed and startup source: `server-sdk/src/agent_sandbox/server/managed.py`,
  `server-sdk/src/agent_sandbox/server/app.py`, `server-sdk/src/agent_sandbox/server/runtime.py`,
  `server-sdk/src/agent_sandbox/server/agents/runtime.py`, and
  `client-sdk/src/agent_sandbox/workflows/launch.py`; source follow-up is PR189, public pair is 0.5.0a1.
- Provider-runtime candidate: SDK167 `0f229aa`, its `docs/en/guide/provider-runtime.md` and
  [owner verification](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/0f229aa/.agents/evidence/verify/2026-11-24-bound-provider-runtime.md); neither candidate nor backend-double
  evidence is silently promoted into current public SDK behavior.

## Decisions that do not require new implementation

- No global E2B/OpenSandbox `style`: aliases cannot translate parameters, authentication,
  resource scope or lifecycle. Preserve only actual protocol compatibility, verified as such.
- No additional `registry-command`/`command run` wrapper: the target-first operation interface is
  delivered; platform operations retain unambiguous root commands.
- No per-request Harness installation and no invented universal installer: prepare pinned binaries
  in the image, verify versions, and report a missing runtime clearly.
- No mechanical new release for every repository: only changed executable/public contracts need
  artifacts. Node HTTP SDK has no confirmed defect from this review. Registry, docs, diagrams and
  this audit do not independently require CLI/Python releases.
- No revision of historical cloud/model outputs. Blog layout changes already present are not
  reclassified as pending simply because this round's browser checks cover different pages.

## Validation and next ordering

Read-only source comparisons and remote state reads establish the findings above. No new model,
cloud, provider-runtime, application upgrade or performance run is claimed. Existing real tests
remain owned by their linked evidence. This record creates no cloud resources and therefore has
no new cloud cleanup operation.

The current main-path corrections discovered in this round have landed or are in the ordered
topic/article publication path. This review found no additional confirmed one-line runtime fix
that can replace the remaining substantive features. Work can proceed in parallel on schema/SDK
consumers, bounded OpenAPI features and Harness adapters. Service-template rollout must wait for
the actual startup/authentication contract; real model/backend prerequisites apply only to their
specific acceptance steps. Keep CLI Issue260 and template Issue309 open until their full consumer
requirements are met.

Local record checks passed:

- `bash scripts/check-repo-health.sh`: 105 pass, 11 existing advisory warnings, 0 failures.
- `npm run check:hygiene`: pass.
- `git diff --check`: pass.

An independent cross-repository reviewer inspected this final disposition and confirmed the
source/publication distinction, bootstrap boundary, Steps image limitation, pending managed
adapters and runtime-backend validation scope. No additional product implementation was proposed
by that review.

The first record-health run detected a cross-repository evidence filename written as a local
reference; it was changed to its absolute owner URL before the passing run. No product test or
cloud test was added for this record-only change. Normal PR CI and the later topic publication
checkpoint remain separately reported. The earlier merged audit remains unchanged.

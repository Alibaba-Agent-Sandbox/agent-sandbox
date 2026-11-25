# Native resource migration readiness

Result: **REVIEW ONLY — migration is not ready for full template rollout.**

Scope: [Issue 276](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/276), the native-resource candidate [PR 249](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/249), and their integration with the target-first OpenAPI caller. This review inspected source and public official documentation. It did not create cloud resources, start an application, test a model, modify a Provider, or certify the candidate deployment path. The request-usability implementation has its separate [local verification record](2026-11-25-openapi-request-integrity.md).

## Fixed sources

- CLI baseline: `b095ab0001f40f1f148e0552d0bdbc378eae11fd`; API request implementation: `be1cc37`.
- CLI native-resource candidate: `48a85f2f9151a343306a14c04630808abb90bcd0`.
- Providers: `ec6226e3294e29d1188855913a1e45548a674602`.
- Server SDK source inspected: `fbe506349693f9bb26c1755aa3d13ce855e1ab69`; the inspected `app.py` and `runtime.py` had no local modifications.
- Template main used for historical evidence: `55efccb6d72b18a9360f0599621b207e97a82396`. Historical results below retain their original versions and scope; they are not fresh cloud tests.

## Express startup is the blocking lifecycle distinction

The official [custom-template guide](https://help.aliyun.com/zh/agent-sandbox/build-and-manage-custom-templates-with-code), checked on 2026-11-25, states in its startup/readiness section that startup runs during template construction, readiness is checked there, and the resulting running service is snapshotted. Creating an instance does not rerun either command. For Linux templates, the image's `ENTRYPOINT` and `CMD` do not execute; enabled systemd services run under systemd. OCI/platform environment values available to startup commands do not automatically become systemd service environment. These are platform semantics, not command aliases the CLI can change.

The official [environment guide](https://help.aliyun.com/en/agent-sandbox/environment-variable) demonstrates creation environment in subsequently executed commands. It does not promise to reinitialize an already-running application's cached configuration after snapshot restoration.

The current [2026-08-20 API metadata](https://api.aliyun.com/meta/v1/products/Sandbox/versions/2026-08-20/api-docs.json) was fetched and parsed read-only. `InnerCreateSandboxInput` exposes `envVars`, but no per-instance `startCommand` or `entrypoint`. The `CreateTemplateBuildConfig.envdInject` description concerns an optional image-packaging action for generation 1; it is not a documented switch disabling generation 2's platform data plane. The metadata still contains an upstream inconsistency: Create/PublicTemplate start and ready descriptions say generation 1, while Update says generation 2. The current guide gives an explicit generation 2 example. Do not invent a new runtime guarantee from this inconsistent description.

The [Server SDK constructor](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/fbe506349693f9bb26c1755aa3d13ce855e1ab69/server-sdk/src/agent_sandbox/server/app.py#L610) reads `ABX_SERVER_TOKEN` when constructing `SandboxServer`. [PolicyEngine](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/fbe506349693f9bb26c1755aa3d13ce855e1ab69/server-sdk/src/agent_sandbox/server/runtime.py#L234) then caches token digests during authentication setup. No post-resume configuration hydration mechanism was identified in those paths. Reading a fresh environment in a later child command is not equivalent to changing this server's authentication or already-created model client.

Existing template [prewarmed-server evidence](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/55efccb6d72b18a9360f0599621b207e97a82396/.agents/evidence/verify/2026-10-16-prewarmed-server-configuration.md) records a failure of creation settings to configure the expected application, followed by a successful fresh process started through the native process API. The later [prepared startup evidence](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/55efccb6d72b18a9360f0599621b207e97a82396/.agents/evidence/verify/2026-10-25-native-prepared-startup-environment.md) also distinguishes explicit post-create process environment from the unchanged original application. Neither record proves a universal no-data-plane bootstrap mechanism.

Consequently, deleting template service/start/environment metadata and retaining only Dockerfiles does not preserve the existing application behavior. Adding `CMD` alone cannot repair Express generation 2. A public or per-template shared secret must not be baked into the snapshot to avoid this problem. A new unauthenticated configuration endpoint would be a separate protocol/security change, not a harmless YAML migration.

## Candidate source findings

| Finding | Fixed source and implication |
| --- | --- |
| `buildOnly` still deploys native resources | [resource_executor.ts](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/48a85f2f9151a343306a14c04630808abb90bcd0/src/providers/alicloud_express/resource_executor.ts#L179) executes pre-deploy actions, volume create/update, and `CreateTemplate`; only Serving deployment is skipped. Existing tests intentionally expect a registered template from this path. Pure-build implementation and these assertions need changing together. |
| Native Steps are not an exported OCI image | The same executor sends steps to template preparation. No result-image export/push API was established. Local build must not secretly call native template deployment merely to manufacture a build artifact. |
| Named-resource execution is Express-specific | The executor rejects non-Express Sandbox providers before effects. `src/template/resource_executor.ts` re-exports this adapter; it is not an implemented OpenSandbox resource engine. `src/cli/resource_deployment.ts` also labels the deployment Provider as Express. |
| Deploy and instance identity differ | [candidate deploy](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/48a85f2f9151a343306a14c04630808abb90bcd0/src/cli/commands/deploy.ts#L58) routes source deployment through resource preparation, replacing the current instance-launch path. A returned template ID is not a Sandbox ID. The public result contains resource identities, not an instance or a ready business endpoint. |
| OpenAPI integration is missing from the new path | `src/cli/resource_deployment.ts` does not load/copy an API contract to a newly created instance and does not run the existing verified-service callback. Its string search for `ABX_SERVER_TOKEN` is not credential provenance or actual service readiness. |
| Serving URLs need a separate binding | [Serving result handling](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/48a85f2f9151a343306a14c04630808abb90bcd0/src/providers/alicloud_express/resource_executor.ts#L286) stores a function identity. Its `endpoint` field is the FC control API override, not the application's HTTP trigger/domain URL. Component output is transient and the public resource summary does not retain a verified business URL. |
| Source merge would regress current CLI fixes | Candidate command files retain public `--build` artifact handoff and old output/error patterns. Selectively port parser/executor functionality while retaining current target-first dispatch, byte-safe API calls, status observations, and private build/recovery records. |
| Generic FC deployment does not establish managed Agents lifecycle | The candidate `src/application/config.ts` rejects the old managed recipe. Native function creation alone does not prove revision routing, old-session continuation, drain, credentials, database setup or the business hooks of that recipe. Those responsibilities need an explicit migration or an honest unsupported boundary. |

## OpenSandbox has a distinct lifecycle contract

The [Provider project manager](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/blob/ec6226e3294e29d1188855913a1e45548a674602/opensandbox/src/project.mjs) already prepares an OCI image reference through the host build helper. This can be reused for an image-backed resource adapter; a fake cloud template-registration API is unnecessary.

However, [OpenSandbox creation](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/blob/ec6226e3294e29d1188855913a1e45548a674602/opensandbox/src/sandbox.mjs#L129) always waits for both lifecycle `Running` and execd `/ping`. A running image without that data plane currently fails creation and is cleaned up. Its create body supplies an explicit configured entrypoint, defaulting to a keepalive process, so a Dockerfile's `CMD` cannot simply be assumed to own application startup on this path either.

A lifecycle-only capability must therefore be deliberately supported and tested by the Provider. Skipping an execd check without changing advertised exec/files capabilities and subsequent routing is insufficient. Express and OpenSandbox do not have interchangeable startup mechanisms.

## Smallest viable integration and acceptance gates

1. Reuse the candidate's strict YAML normalization, official Serverless Devs parser/component bridge, dependency ordering and ownership checks. Keep the public command cleanup already reviewed. Do not introduce another orchestration framework.
2. Make build produce build results only, with no volume/template/function deployment or deploy hooks. Deployment performs native Steps preparation and resource registration. Any Steps-only local-build limitation must be explicit. Keep handoff state private and reuse it internally when valid.
3. Resolve instance creation from a selected deployed Sandbox template, preserving its exact Provider/account/region. Require an explicit resource selection when a deployment has several templates. Save the copied selected API contract against the actual new Sandbox identity, never against the template ID or an unrelated existing instance.
4. Keep generic instance creation independent of application bootstrap. Preserve existing optional application startup internally until a supported per-Provider mechanism is demonstrated; do not reinterpret native template `startCommand` as an after-create hook. Complete replacement requires a verified bootstrap/configuration contract before bulk template migration.
5. For Serving, observe and retain the actual business endpoint separately from FC control endpoints. The existing Sandbox caller must continue to reject application deployments instead of coercing them to Sandbox IDs. Direct URL/HTTP clients remain a valid explicit path until a separately designed generic service-target caller is implemented.
6. Add regressions that prove zero native deployment calls during build; no deploy hooks during build; explicit multi-template selection; Provider/region preservation; binding only the new actual instance; wrong/missing auth rejection; and unchanged instances across template updates. Mocked component outputs must not count as a verified business URL.
7. Before native application rollout, run one owned template through actual deploy, create with a fresh application token and model configuration, first protected API call, wrong-token rejection, cleanup and independent deletion confirmation. Record which startup process received the configuration. Each Provider needs its own mechanism-specific evidence. No RDS or broad model matrix is necessary to establish this narrow prerequisite.

The current API change's automatic auth applies only to a declared service on the verified same port whose actual injected token matches the configured private source. It stores a reference and fingerprint, not a secret. This callback can validate the current supported launcher, but **cannot substitute for the missing native-create bootstrap contract**.

A current-v5 recipe using an existing prepared base reference can separately validate Issue 276's first protected cloud call through the existing launcher and copied OpenAPI metadata. Such a result would validate that current path only; it must not be presented as native-v1 migration, empty-Sandbox behavior, Serving integration, or proof that snapshotted processes receive fresh secrets.

## Review and record checks

The root reviewer independently identified the removed application-startup prerequisite in the template candidate. This source/official-document review confirmed the failure mechanism and sent it to the template-contract reviewer and build-workflow owner. The resulting decision was to hold the native template rollout until the prerequisite is resolved. This is a bounded integration blocker, not an instruction to add public instance lifecycle fields or create a new platform.

This evidence file is the only change in its recording commit. No source test result or cloud result is attributed to the review. `git diff --check` and `npm run check:hygiene` passed. `bash scripts/check-repo-health.sh --quiet` completed with 105 passes, 11 existing warnings and zero failures. The relative local evidence link resolves. Integration/release evidence belongs to the parent change.

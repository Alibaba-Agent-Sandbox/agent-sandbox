# Provider template deploy

> Status: design, not implemented. This document does not change EPP/1, the engine, the 18 feature ids, or any provider plugin. Approve it before those edits.
>
> 中文版: [`../zh/design/provider-template-deploy.md`](../../zh/design/provider-template-deploy.md)
>
> Code read on 2026-10-15: `agent-sandbox` `a20f497`, `awesome-providers` `873f033`. Upstream pages fetched the same day are cited inline. Anything not read in those trees or pages is marked unverified.

## 1. What the install table is describing

The phrases "installable/buildable directly", "needs an existing template id", and "push an image first" are not in this repository or in `awesome-providers` at the commits above, and a search of the public registry site did not return a page that uses them. The CLI page that does exist is [What you can run after installing](../guide/providers.md). It maps each of the 18 feature ids to commands. `alicloud-express` appears to support every command because `src/providers/builtin.ts` sets `this.features` to the full `FEATURES` list. The four catalog plugins omit `templates.read` and `templates.build`.

`abx template deploy` calls `requireTemplateFeature("templates.build")` in `src/cli/template_provider.ts` before Docker, ACR, or `CreateTemplate` (`src/cli/commands/template.ts`, deploy callback). A catalog provider therefore answers `E8004` and does not run the Express registry flow. The 2026-10-13 note in [provider-wiring-plan.md](../../design/provider-wiring-plan.md) that template commands ignore `--provider` and fail with "ACR credentials missing" is stale on current `main`.

The labels the table should show, once the feature below exists:

| Provider declares `template.deploy` | What `sandbox.create` already accepts | Label |
|---|---|---|
| yes | the id or ref that deploy returns | can build directly |
| no | an id that already exists on that backend | needs an existing template id |
| no | a container image URI | push an image first |

Express is in the first row today only because the CLI, not the Express API, builds an image, pushes it, registers a template, and waits until it is READY. The platform call still takes a template id.

Callers that should share that path:

- `abx template deploy <dir>` and `abx deploy <dir>` (`src/cli/commands/template.ts`, `src/cli/commands/deploy.ts`).
- The Python SDK does not deploy. Its guide tells the caller to run the CLI (`python-sdk` `docs/en/guide/authoring-templates.md`). A later SDK deploy goes through the engine routes in section 5, not a second pipeline.
- `awesome-templates/scripts/express_e2e.py` shells out to `abx template deploy`, then `abx create` / `abx run`. It unsets `ABX_PROVIDER` and always targets Express. After a provider implements `template.deploy`, the harness can pass `--provider` and keep the same smoke steps.

## 2. The seven steps, and who owns them

| Step | What it does today | Owner after this design |
|---|---|---|
| 1. Resolve a build plan | `resolveBuildPlan` in `src/template/build_plan.ts` reads `template.yaml` and the Dockerfile. `auto` prefers a Dockerfile. `steps` expands `build:` into `{type, args}`. | CLI. Providers never parse `template.yaml`. |
| 2. Build an image | Local `docker build` in `_buildImage`, including the server-sdk wheel or archive pin. Express `steps` mode skips Docker and sends steps to `CreateTemplate`. | CLI for `build: local`. Provider for `build: remote` (E2B runs the steps). |
| 3. Push to a registry the provider can pull | `_pushImage` to ACR (`registry.cn-hangzhou.aliyuncs.com` by default). | CLI push helper when the provider says `push: registry` and names the registry. Skipped when the provider builds remotely or when the image is already a public ref the provider can pull. |
| 4. Register or create the template | `fc_template.createOfficialTemplate` (`src/api/fc_template.ts`), official FCSandbox `CreateTemplate`. | Provider method `template.deploy`. |
| 5. Wait until READY | `waitForTemplateReady` in the same module. Steps mode returns `submitted` and does not wait. | Provider. It emits progress and returns only when `status` is terminal or `submitted`. |
| 6. Return an id or ref | `TemplateID`. `_rememberTemplate` caches `template.yaml` under that id, the alias, and the yaml name. | Provider result `template_id` (the string `sandbox.create` accepts) plus optional `ref`. CLI keeps the cache. |
| 7. Delete, list, inspect | Express list/get/delete in `fc_template.ts`, gated by `templates.read` / `templates.build`. | Provider methods `template.list`, `template.get`, `template.delete`. |

`[template]` in `abx-provider.toml` is the authoring profile (`src/providers/template_profile.ts`: base image, `server_start`, Dockerfile `CMD`). It is not the runtime meaning of `abx create TEMPLATE`. OpenSandbox has no `[template]` table and uses the generic profile (`FROM python:3.12-slim`, `CMD ["python3", "commands.py"]`).

## 3. Providers

### 3.1 `alicloud-express` (built in)

Native template: an Express template id produced by `CreateTemplate`. The API takes an image reference (and, in steps mode, `sandboxConfig.steps`), CPU, memory, disk, generation, `startCommand`, and `readyCommand`. It does not accept a local directory. Generation 2 is required for start and ready commands. A generation-1 template of the same name cannot be updated into generation 2 (`GEN1_START_COMMAND` in `fc_template.ts`).

There is no `CMD` or `ENTRYPOINT` on this platform. The profile `server_start` is `platform_start_cmd`. With `commands.py` present and no explicit generation, `resolveDeployRuntime` publishes generation 2 and:

- start: `agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py`
- ready: `agent-sandbox-server healthcheck --port 9000`

| `template.yaml` field | Express |
|---|---|
| `base` / `base.image` | Dockerfile `FROM`, or the image for steps mode. Placeholders `<region>` and `<tag>` are rewritten to the FC base image. |
| `generation` | Sent. Default 2 when the profile starts the server and `commands.py` exists, otherwise 1. |
| `start_cmd`, `ready_cmd` | Sent on generation 2. |
| `resources.cpu`, `resources.memory` | Sent. CLI defaults 2 CPU and 2048 MB when the file omits them. |
| `ports` | Not sent to `CreateTemplate`. Cached in `template.yaml` for capability lookup. |
| `env` | Not a `CreateTemplate` field on this path. |

Credentials: `ALICLOUD_ACCESS_KEY_ID`, `ALICLOUD_ACCESS_KEY_SECRET` (also the default ACR username and password), `ACR_NAMESPACE`, `ALIBABA_CLOUD_REGION_ID`, plus `ABX_SANDBOX_API_KEY`, `ABX_SANDBOX_BASE_URL`, `ABX_SANDBOX_DOMAIN` for create and run. The plugin must not read `E2B_*`.

Verified: the pipeline in `template.ts` / `fc_template.ts` / `build_plan.ts`, and the feature gate. Live Express deploys of this CLI are recorded on earlier changes; this design did not run a new one.

### 3.2 `e2b`

Plugin: `awesome-providers/e2b/provider.mjs`. `buildInfra` builds the host's E2B protocol against `https://api.e2b.app` with `X-API-Key`. Create is `POST /sandboxes` with `templateID`. The manifest does not declare template features, so deploy is `E8004`. README: unit tests use a local fake API; this environment has no `ABX_E2B_API_KEY`, so no live create was run.

Native template: an E2B template id (and alias) that `Sandbox.create(template=...)` passes as `templateID`. A finished build is a snapshot: `startCmd` runs during the build, `readyCmd` must exit 0, and the snapshot includes the running process. Later `create` does not re-run the start command ([Start & ready commands](https://docs.e2b.dev/template/start-ready-command)).

The V1 "send a Dockerfile" API is retired. [V1 build system deprecation](https://docs.e2b.dev/migration/v1-build-deprecation) says V1 builds stopped on 2026-08-01 and `e2b template build` is a stub. `POST /templates` with a `dockerfile` string and `POST /v2/templates` are both marked deprecated in the public OpenAPI. The supported build is:

1. `POST /v2/templates` with `alias`, `cpuCount`, `memoryMB`. Response `202` carries `templateID` and `buildID` ([Create template (v2)](https://docs.e2b.dev/api-reference/templates/create-template-v2)).
2. `POST /v2/templates/{templateID}/builds/{buildID}` with exactly one of `fromImage` or `fromTemplate`, plus `steps`, `startCmd`, `readyCmd`, and optional `fromImageRegistry` (`aws`, `gcp`, or `registry`) ([Start build (v2)](https://docs.e2b.dev/api-reference/templates/start-build-v2)).
3. `GET /templates/{templateID}/builds/{buildID}/status`. Status values include `building`, `waiting`, `ready`, `error`, `uploaded` ([Get build status](https://docs.e2b.dev/api-reference/templates/get-build-status)).

A Dockerfile is parsed on the client by `Template.fromDockerfile` into those steps. Supported instructions: `FROM`, `RUN`, `COPY`, `ADD`, `WORKDIR`, `USER`, `ENV`, `ARG`, `CMD`, `ENTRYPOINT`. `EXPOSE` and `VOLUME` are skipped ([Base image](https://e2b.dev/docs/template/base-image)). `fromImage` is the other path: build locally, push, and pass the tag plus registry credentials. E2B's servers run the steps. Local Docker is unnecessary for a step build from a public base image.

| Field | E2B |
|---|---|
| `base` | `fromImage`, or `FROM` of a parsed Dockerfile. |
| `generation` | No field. Unsupported. |
| `start_cmd`, `ready_cmd` | `startCmd`, `readyCmd`. They run at build time, then the process is snapshotted. |
| `cpu`, `memory` | `cpuCount`, `memoryMB` on create-template. |
| `ports` | `EXPOSE` is skipped. Ports are not part of the build request. |
| `env` | `ENV` becomes a step. Create-time env vars are not visible to `startCmd`, because that process already ran. |
| `build.steps` / `build.run` | The CLI already emits `{type, args}` steps. The provider maps `RUN`/`ENV` onto E2B `TemplateStep`. The exact step JSON was not copied into this doc; confirm against the live OpenAPI when implementing. |

Credentials: `ABX_E2B_API_KEY` only for a public base image. A private `fromImage` also needs registry credentials in `fromImageRegistry`. The plugin does not read `ABX_SANDBOX_API_KEY` or `E2B_API_KEY`.

Verified: plugin source, manifest, and the E2B doc pages linked above. Unverified: a live build, the `TemplateStep` schema, and how `COPY`/`ADD` upload file bytes (the start-build page shows `steps` but not a file-upload body).

### 3.3 `cubesandbox`

Plugin: `awesome-providers/cubesandbox/provider.mjs`. It speaks the E2B-shaped CubeAPI (`POST /sandboxes` with a template id) plus Cube-specific resume, ports, and Jupyter on port 49999. The manifest has no template features. README: use a template id that exists on the cluster; do not assume `base`. Unit tests hit a fake API. No live create was run (nothing on port 3000).

Native template: a server-generated id (`tpl-` prefix). CubeAPI `POST /templates` accepts `CreateTemplateRequest` and returns `202` with `jobID`, `templateID`, `status`, `phase`, `progress` (CubeSandbox `openapi.yml`, `operationId: create_template`). Required field: `image`. Also present: `name`, `alias`, `cpu` (millicores), `memory` (MiB), `command`, `args`, `env` (`KEY=VALUE` strings), `exposedPorts`, `probePort`, `probePath` (default `/health` when a probe port is set), `registryUsername`, `registryPassword`, `writableLayerSize`, `allowInternetAccess`. `templateID` in the request is ignored. Status is `GET /templates/{templateID}/builds/{buildID}/status`.

`cubemastercli tpl create-from-image` is the documented operator path ([Creating Templates from OCI Images](https://cubesandbox.com/guide/tutorials/template-from-image)). The image must be pullable by CubeMaster nodes. A public registry needs no credentials. A private registry needs `--registry-username` and `--registry-password`. Plain HTTP registries need an `http://` prefix. A single-node cluster can use a local image name with no push ([Local and Remote Image Template Practice](https://cubesandbox.com/guide/tutorials/template-build-practice)). `--enable-inject-envd` uploads an `envd` binary in the CLI multipart request ([Custom Template Images](https://cubesandbox.com/guide/tutorials/bring-your-own-image)). That flag is not a field of `CreateTemplateRequest` in the OpenAPI excerpt read here.

| Field | CubeSandbox |
|---|---|
| `base` | Not a template base. The pushed image is `image`. |
| `generation` | Unsupported. |
| `start_cmd` | `command` plus `args` (entrypoint override), not an Express-style platform start command. |
| `ready_cmd` | `probePort` and `probePath`. A shell ready command has no field. |
| `cpu`, `memory` | `cpu` in millicores (`2` cores → `2000`), `memory` in MiB. |
| `ports` | `exposedPorts`. Probe port should be one of them. |
| `env` | `env` as `KEY=VALUE`. |

Credentials: `ABX_CUBESANDBOX_BASE_URL` (default `http://127.0.0.1:3000`), optional `ABX_CUBESANDBOX_API_KEY`, `ABX_CUBESANDBOX_DOMAIN`, `ABX_CUBESANDBOX_PROXY`. Registry username and password are request fields, not manifest fields today. Add them as config fields when implementing, the same way OpenSandbox already has `registry_username` / `registry_password`.

Verified: plugin, manifest, README, and the OpenAPI plus the three tutorial pages. Unverified: a live job against a Cube cluster, and whether `POST /templates` can inject `envd` or only `cubemastercli` can.

### 3.4 `alicloud-container`

Plugin: `awesome-providers/alicloud-container/provider.mjs`. ACS/ACK sandbox-manager, E2B-shaped HTTP, not Express. `native` API is `https://api.{domain}`; `private` is `https://{domain}/kruise/api`. Create is `POST /sandboxes` with a template id. The example in the provider README is `code-interpreter`. The manifest has no template features. Unit tests use a fake API. No ACS/ACK cluster was available, so no live create was run.

Native template: the name of a `SandboxSet` (`agents.kruise.io/v1alpha1`). `ack-sandbox-manager` watches that object and exposes its name as the E2B template id. The image is a field of the `SandboxSet` pod template, for example `registry-<region>-vpc.ack.aliyuncs.com/acs/code-interpreter:v1.6` ([Create an Agent Sandbox in an ACS cluster](https://www.alibabacloud.com/help/en/cs/user-guide/create-an-agent-sandbox)). A per-sandbox image swap is metadata `e2b.agents.kruise.io/image` on `Sandbox.create`, and it still requires an existing template name. The manager's changelog says it supports template `list` and `get`. This plugin does not call those routes.

There is no `CreateTemplate` in the E2B-compatible HTTP this plugin speaks. Registering a new template means applying a `SandboxSet` to the cluster. That is a Kubernetes write, not an HTTP call the plugin has credentials for.

| Field | Container edition |
|---|---|
| `base` | The container `image` inside a `SandboxSet` the operator applies, or the metadata image override on create. |
| `generation`, `start_cmd`, `ready_cmd` | No fields on `POST /sandboxes`. The pod command is in the `SandboxSet`. |
| `cpu`, `memory` | Pod `resources` in the `SandboxSet`, not the create body this plugin sends. |
| `ports`, `env` | Pod spec. Not mapped by the plugin. |

Credentials for create: `ABX_ALICLOUD_CONTAINER_DOMAIN`, `ABX_ALICLOUD_CONTAINER_API_KEY`, optional `ABX_ALICLOUD_CONTAINER_BASE_URL` and `ABX_ALICLOUD_CONTAINER_PROTOCOL`. An image push uses ACR credentials the cluster's nodes can pull (VPC registry address). The plugin has no ACR or Kubernetes config today.

Verified: plugin, manifest, README, and the ACS doc page. Unverified: live `list`/`get` template responses, and any HTTP that creates a `SandboxSet`. Treat "deploy creates a template id" as unsupported until that API is confirmed.

### 3.5 `opensandbox`

Plugin: `awesome-providers/opensandbox/provider.mjs` and `src/sandbox.mjs`. `sandbox.create` resolves the template string to an image URI (`resolveImage`): empty or `base` → `default_image` (`python:3.12-slim`); a configured alias (`code` → `opensandbox/code-interpreter:v1.1.0`); anything else is used as the URI. The body is `image.uri`, `entrypoint`, `resourceLimits` (`cpu` as millicores, `memory` as `512Mi`), optional `image.auth`, `env`, `timeout`, `metadata`, `networkPolicy`, `platform`, `secureAccess`. The plugin then waits until state `Running` and execd answers `/ping`. `templates.list`, `templates.get`, `templates.delete`, `templates.build`, and `templates.build_status` are hard-coded to the unsupported error because the manifest does not declare those features.

Upstream lifecycle spec (`specs/sandbox-lifecycle.yml` on `alibaba/OpenSandbox` `main`, fetched 2026-10-15): create takes one of `image`, `snapshotId`, or a pool ref. `image` requires `entrypoint`. Resource limits are required outside pool mode. Docker is the runtime the provider README exercised (local 1.1.1 on 2026-10-14: create, exec, files, PTY, port URL).

`POST /v1/templates` creates an fsb golden-image template. The spec says it is available on the `kubernetes` and `fsb` runtimes and returns 501 on Docker. The body (`CreateFsbTemplateRequest`) requires `image` and `publish` (an S3-style target). Optional: `resourceLimits`, `entrypoint` (default `["tail", "-f", "/dev/null"]`), `env`, `metadata`, `readiness`, `format` (`native` or `overlaybd`). Poll `GET /v1/templates/{templateId}` until `status.phase` is `Succeeded` or `Failed`. Template ids look like `tpl_…`. Kernel, execd, and guest init come from server config, not the client. Sandboxes already created from a template keep their own artifacts after delete.

| Field | OpenSandbox |
|---|---|
| `base` | The image that is built and pushed. `sandbox.create` receives that ref as `template`. |
| `generation` | Unsupported. |
| `start_cmd` | `entrypoint` argv. The provider's `entrypoint` config overrides the image. Stock images stay up with `tail -f /dev/null` so execd can serve exec and files. A generated image that serves port 9000 sets `entrypoint` to `python3 commands.py`. |
| `ready_cmd` | No create field. The plugin waits for `Running` and execd `/ping`. Fsb `readiness` exists only on `POST /templates`. |
| `cpu`, `memory` | `resourceLimits.cpu` (`2` → `2000m`), `resourceLimits.memory` (`2048` → `2048Mi`). The plugin defaults `500m` and `512Mi` when create omits them. |
| `ports` | Not a create field. `ports.url` calls `GET /v1/sandboxes/{id}/endpoints/{port}`. |
| `env` | `env` object on create. Fsb templates bake env into the golden image. |

Credentials: `ABX_OPENSANDBOX_BASE_URL` (default `http://127.0.0.1:8080`), optional `ABX_OPENSANDBOX_API_KEY` (`OPEN-SANDBOX-API-KEY`). Private images use `registry_username` and `registry_password` (`image.auth`). The server must be able to pull the ref. Fsb builds also need an S3 `publish` target, which is not a config field today.

Verified: plugin source, manifest, provider README, and the lifecycle spec. Unverified: a live `POST /templates` against a Kubernetes runtime, and a live pull of an image this CLI pushed.

## 4. Can every provider do this inside the plugin?

Yes, for the register/wait/delete half. No, if "the same work" means "the plugin runs Docker and ACR".

- The CLI keeps steps 1, the local build, the push helper, and the yaml cache. Those are identical for every provider and already live in `build_plan.ts`, `docker_builder.ts`, and `template.ts`.
- The plugin implements steps 4–7 against its own API, and step 2 when it can build remotely.
- `e2b` can take a normalized step list and return a template id with no local Docker, for Dockerfiles whose instructions are in the supported set and whose `COPY` sources the implementer can upload.
- `opensandbox` on Docker has nothing to register. Deploy pushes an image and returns that ref. `sandbox.create` already accepts it. The fsb template API is a second, Kubernetes-only implementation of the same method.
- `cubesandbox` registers an image and waits for the job. The plugin needs registry credentials and a probe.
- `alicloud-container` cannot mint a template id over the HTTP API this plugin uses. Deploy can push an image and document the `SandboxSet` the operator must apply, and it can list or get templates once those routes are wired. It should not advertise `template.deploy` until a create API exists. The image-override metadata still needs an existing template id, so the table stays "needs an existing template id".

`express_e2e.py` and the SDK then work per provider because they call `abx template deploy` (or the engine), and the provider id selects the plugin. The harness still needs that provider's credentials and a reachable registry. It should keep refusing to record a provider as verified when those are absent.

## 5. Protocol change (do not implement until approved)

### 5.1 Feature ids

Add four optional ids. Do not remove or rename the existing 18 in `src/providers/base.ts`:

| Id | EPP method | Engine | CLI |
|---|---|---|---|
| `template.deploy` | `template.deploy` | `POST /v1/templates` | `template deploy`, `template build`, `template push`, `template create`, `template install` (except `--download-only`), `deploy` |
| `template.list` | `template.list` | `GET /v1/templates` | `template list` |
| `template.get` | `template.get` | `GET /v1/templates/:id` | `template info` |
| `template.delete` | `template.delete` | `DELETE /v1/templates/:id` | `template delete` |

`src/providers/manifest.ts` rejects any id outside `FEATURES` at install (`unknown feature(s): …`). `awesome-providers/docs/authoring.md` and `docs/en/create.md` document the same closed list of 18. Shipping a plugin that declares `template.deploy` before the host allowlist grows makes `abx provider install` fail. Order: host allowlist, `docs/design/fixtures/epp-methods.json`, engine, and the Python SDK copy of the same list in one release; plugins in a later release.

Old plugins omit the new ids, install as they do now, and get `E8004` on deploy. The engine answers `501` for the same gap ([engine-api.md](../reference/engine-api.md)).

`templates.read` and `templates.build` stay in the 18. For one release the host treats them as aliases: `templates.read` satisfies `template.list` and `template.get`; `templates.build` satisfies `template.deploy` and `template.delete`. The builtin keeps declaring the old ids so current manifests and docs remain valid. Catalog plugins declare only the new ids they implement. A later release drops the alias after the builtin itself uses the new ids and the providers guide table is updated. `orderedFeatures` already appends unknown ids; install rejection means a manifest never relies on that.

Initialize may include an optional `template` object. Hosts that only read `features` ignore it.

```json
{
  "build": "remote",
  "accepts": ["image", "steps", "dockerfile"],
  "push": "none"
}
```

`build` is `local`, `remote`, or `none`. `accepts` lists which request forms the method handles. `push` is `none` or `registry`. Missing object means the CLI does not guess: it sends `image` only after a local build and push, which matches Express.

### 5.2 Request and response

`template.deploy` params:

```json
{
  "name": "my-template",
  "alias": null,
  "source": {
    "kind": "image",
    "image": "registry.example.com/ns/my-template:latest"
  },
  "spec": {
    "cpu": 2,
    "memory_mb": 2048,
    "disk_mb": null,
    "ports": [9000],
    "env": {"LOG_LEVEL": "info"},
    "start_cmd": null,
    "ready_cmd": null,
    "entrypoint": ["python3", "commands.py"],
    "generation": null
  },
  "registry": {"username": null, "password": null},
  "force": false
}
```

`source.kind` is one of:

| kind | Fields | When the CLI sends it |
|---|---|---|
| `image` | `image` (string ref) | After the push helper, or when the plan is already an image the provider can pull. |
| `steps` | `image` (base) and `steps` (`[{ "type": "RUN", "args": ["…"] }]`, the `build_plan.ts` shape) | Provider `build` is `remote` and `accepts` contains `steps`. |
| `dockerfile` | `dockerfile` (file text) and `files` (`[{ "path", "sha256", "bytes_b64" }]`) | Provider `accepts` contains `dockerfile`. Omit `files` when the Dockerfile has no `COPY` or `ADD`. |

The CLI normalizes `template.yaml` into `spec` before the call. Providers ignore fields they do not support and report each ignored field in a progress event so the command output shows it. They refuse the call when a required mapping is impossible (Cube without an image, container edition without a `SandboxSet` API).

Result:

```json
{
  "template_id": "tpl_or_platform_id",
  "ref": "registry.example.com/ns/my-template:latest",
  "status": "ready",
  "build_id": "bld_123"
}
```

`template_id` is the string passed to `sandbox.create` as `template`. For OpenSandbox on Docker that string is the image ref, and `ref` repeats it. `status` is `ready`, `submitted`, or `error`. `build_id` is null when the provider has no build object.

`template.list` params: `cursor`, `limit`. Result: `{ "templates": [{ "template_id", "name", "status", "ref" }], "next": null }`.

`template.get` params: `template_id`. Result: one object with the same fields plus `spec` when the backend returns it.

`template.delete` params: `template_id`. Result: `{}`. Missing templates are success, matching `sandbox.kill`.

### 5.3 Progress

EPP already has two streaming mechanisms in `src/providers/epp.ts`: a notification with method `log` is a debug line, and a notification that carries `process_id` is queued for exec streaming. Template deploy reuses notifications. The plugin emits lines with no `id`:

```json
{
  "jsonrpc": "2.0",
  "method": "template.progress",
  "params": {
    "build_id": "bld_123",
    "phase": "register",
    "message": "pulling image",
    "progress": 40
  }
}
```

`phase` is `build`, `push`, `register`, or `wait`. `progress` is 0–100 or null. The host queues them by `build_id` the same way it queues exec events by `process_id`.

The engine already streams SSE for `commands/stream` and `files/watch`. `POST /v1/templates` with `Accept: text/event-stream` writes `progress` events and a final `result` event. A JSON caller blocks until the result record. `501` when `template.deploy` is absent. Error bodies stay the engine error object.

The CLI step reporter (`_StepReporter` in `template.ts`) prints these events. It keeps printing local docker and push output itself, because those steps run before the provider call.

### 5.4 CLI split

1. Resolve the provider. Require `template.deploy`.
2. `resolveBuildPlan` and `resolveDeployRuntime` (generation and start/ready only for providers that accept them; Express does).
3. Read `template` from the provider description. Remote build: send `steps` or `dockerfile` and skip Docker. Otherwise `_buildImage` and, when `push` is `registry`, `_pushImage` to the registry the provider config names.
4. Call `template.deploy`. Cache `template.yaml` under `template_id`, alias, and yaml name (`cacheDeployedTemplate`, already implemented).
5. `template list|info|delete` call the matching methods. They no longer import `fc_template.ts` directly.

Express moves behind the same call. `AlicloudExpressProvider` implements the four methods by calling the existing `fc_template.ts` functions. ACR push stays in the CLI because the provider says `build: local`, `accepts: ["image", "steps"]`, `push: registry`. Steps mode still skips Docker. The builtin stops being a special case in `template.ts`.

### 5.5 UI

The install table reads `template.deploy` and the create-argument kind from provider info:

- `template.deploy` present → "can build directly".
- Absent, and create takes an opaque id (`e2b`, `cubesandbox`, `alicloud-container`) → "needs an existing template id".
- Absent, and create takes an image URI (`opensandbox`) → "push an image first".

`abx provider info` already prints feature ids. No new command is required. Hand-written labels drift; the flag is the source.

## 6. Implementation plan

Nothing in this section is approved to code yet.

| Repo | Work | Effort | Risk |
|---|---|---|---|
| `agent-sandbox` | Add the four ids to `FEATURES`, manifest validation, `epp-methods.json`, engine routes, and the providers guide (en+zh). Alias the old template ids for one release. Move Express register/wait/list/delete behind the methods. Keep build plan, local Docker, and the push helper in the CLI. | Medium. The behavior change is the dispatch, not a new Express API. | Low if existing Express deploy tests keep passing and a mock plugin covers the schema. High if the Python fixture list is not updated in the same change: the side-by-side fixture test fails. |
| `python-sdk` | Same four ids in the SDK allowlist and engine client (`POST/GET/DELETE /v1/templates`). No second build pipeline. | Small, must land with the CLI change. | Low. An SDK-only change cannot deploy. |
| `awesome-providers` | One plugin per PR, after the host release. Declare only the ids that plugin implements. Mock-server tests beside the existing `cli/tests/test_providers/test_node_plugins.test.ts` fakes. | See the order below. | A plugin that declares an id the host does not know yet fails install. |
| `awesome-templates` | `scripts/express_e2e.py` gains a provider argument and records that provider in the evidence file. It stays Express-only until that provider's deploy works. | Small, after at least one plugin. | Low. The harness must not write evidence for a provider it did not actually deploy. |

Provider order:

1. **E2B, first.** Remote steps from `template.yaml` `build:` or a parsed Dockerfile, public base image, `ABX_E2B_API_KEY` only. No local Docker and no registry for that path. Effort: medium-low for `RUN`/`ENV` steps. Risk: medium, because `COPY` upload is unverified and `POST /v2/templates` is marked deprecated even though the docs still tell callers to use it. A Dockerfile outside the supported instruction set must fail with the unsupported instruction named, not a partial build.
2. **OpenSandbox, Docker runtime, second.** Local build, push, return the image ref. The create path already accepts it. Effort: low. Risk: low on a local server that can pull the registry. Private registries need the existing `registry_username` / `registry_password` fields. Fsb `POST /templates` is a later slice (Kubernetes plus an S3 `publish` target). Effort for that slice: high. Risk: high. Leave it undeclared until a cluster is available.
3. **CubeSandbox, third.** `POST /templates` plus status polling. Effort: medium. Risk: medium-high. Nodes must pull the image, the probe must match the process, and `envd` injection may exist only on `cubemastercli`. A template whose image has no `envd` and no inject path will create and then fail exec.
4. **`alicloud-container`, last.** Do not declare `template.deploy`. Optional `template.list` and `template.get` if the manager routes answer. Effort to wrap `SandboxSet` creation: high, and it needs Kubernetes credentials the plugin does not have. Risk: high. The honest table label remains "needs an existing template id".

Express is the reference implementation inside the CLI change, before the catalog plugins, so the schema is fixed against the pipeline that already works.

## 7. What can be tested without accounts

Mock HTTP, no credentials:

- E2B: `POST /v2/templates`, `POST /v2/templates/{id}/builds/{buildID}`, `GET …/status` returning `ready`. Assert the step body and that local Docker is not invoked for `build: remote`.
- Cube: `POST /templates` → `202`, then status `READY`. Assert `image`, millicores, probe, and registry fields.
- OpenSandbox: `POST /v1/sandboxes` is not the deploy method. Deploy returns the image ref. `POST /v1/templates` on a Docker mock returns `501`, and the plugin does not declare fsb deploy in that case.
- Container edition: mock `GET` template list. Deploy is `E8004` while the feature is absent.
- Installer: a manifest with `template.deploy` is rejected by today's allowlist and accepted after the allowlist grows. A manifest with `template.nope` stays rejected.
- Engine: `POST /v1/templates` `501` without the feature; SSE `progress` then `result` with a fake plugin.
- CLI: `abx --provider e2b template deploy` is `E8004` before Docker on today's binary. That test can land with the docs and does not change the protocol. It is not included in this change because the current gate already does this and a new test would be a code change.

Needs real credentials, and must not be claimed from mocks:

- An E2B build that reaches `ready` and a sandbox created from that id.
- A Cube job that reaches `READY` and exec through envd.
- An OpenSandbox server pulling an image this CLI pushed.
- An ACS `SandboxSet` and a create against its name.
- Express, already covered by the existing deploy path, re-run after the builtin moves behind `template.deploy`.

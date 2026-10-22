# Launch a template without copying a cloud ID

`template launch` is a native project extension. It downloads a catalog source (or accepts a local directory), checks the selected provider's declared capabilities, asks that adapter to prepare the project, and creates a sandbox using the exact returned reference. It never converts one cloud's ID into another cloud's ID.
Image-based adapters share the remaining preparation deadline across build, push and registration; fractional remaining seconds do not prevent local tools from starting.


```sh
abx --provider e2b template launch alibaba-agent-sandbox/awesome-templates//python-hello --yes
abx --provider opensandbox template launch ./my-project --yes
```

Use `--alias NAME` to select the build name, `--timeout SECONDS` for preparation (default 600, maximum 3600), and `--sandbox-timeout SECONDS` for sandbox lifetime (default 300). `--yes` explicitly permits build/registration and a billable sandbox. A successful JSON result has `sandbox_id`, `provider`, and `template_reference`; no secret or raw build output is emitted.

## Install a CLI that includes this extension

Check `abx template launch --help`. The existing 0.4.0 npm release predates this extension; do not assume that a version number proves its availability. Until a release containing it is published, build the reviewed main source:

```sh
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
npm ci
npm run build
node dist/bin/abx.js template launch --help
```

Use `node /absolute/path/to/agent-sandbox/dist/bin/abx.js` in place of `abx` for that source build. Existing standard template commands keep their meanings.

## Configure the provider once

Install/update the catalog plugin using its documented Git source; pinned installs remain pinned. The new project adapters need a host build exposing the generic project primitives. The CLI reports an actionable prerequisite error on older hosts. All third-party providers remain **Beta**, with formal native acceptance deferred by the maintainer. A callable workflow is not a native acceptance receipt.

| Provider path | One-time preparation requirements | Returned reference |
| --- | --- | --- |
| Bundled Express | Its existing AK/SK, sandbox key, region and deployment configuration | Ready platform template ID |
| E2B | Independent `ABX_E2B_API_KEY`; Node 22+ with optional e2b SDK; `ABX_E2B_BUILD_BASE_IMAGE` when the source has an unresolved FROM | Official SDK build's template ID |
| CubeSandbox | Docker, writable `ABX_CUBESANDBOX_IMAGE_REPOSITORY`, Docker registry login, native `ABX_CUBESANDBOX_BUILD_BASE_IMAGE`, Cube API configuration | Native ready template ID |
| OpenSandbox | Docker, writable `ABX_OPENSANDBOX_IMAGE_REPOSITORY`, registry login and reachable OpenSandbox server; `ABX_OPENSANDBOX_BUILD_BASE_IMAGE` for unresolved FROM | Immutable image reference |
| Container edition | Docker/registry, `ABX_ALICLOUD_CONTAINER_IMAGE_REPOSITORY`, kubectl access, `ABX_ALICLOUD_CONTAINER_KUBE_NAMESPACE` matching the API-key namespace; base SandboxSet name (`build_template`, default `code-interpreter`) and main container name when ambiguous | Adapter-owned SandboxSet name |

The base image must retain that backend's required runtime (including envd/Jupyter when declared). The host does not guess a vendor image or silently substitute a generic base. Container preparation obtains the base image from the base SandboxSet and preserves its runtime injection, init containers, volumes and probes. It never edits that base resource; an existing generated resource is reused only when ownership/image match. Its zero-sized pool is claimed with the backend's documented create-on-no-stock option.

Project builds stage an isolated copy and leave the source unchanged. Providers explicitly allow the template spec's optional wheel-copy input to be absent, retaining the Dockerfile's pinned installation fallback. Local OCI builds use existing Docker registry authentication and immutable content-based tags. They do not log tool output or use Express keys for another backend. Configure private image pull credentials separately in that provider's namespace.

## Capability checks, readiness and cleanup

A template requiring PTY is rejected before preparation when the provider does not declare `pty`. The same applies to code/files/ports. Reference handling does not add missing capabilities. OpenSandbox's current absence of `code.interpret` therefore still blocks templates requiring that feature.

E2B waits for the official SDK build; Cube waits for its exact native build job. Express polls an asynchronous registration before reporting ready. The adapter may ask the launcher to start the project service and run its readiness command. If that new sandbox fails startup/readiness, the launcher attempts to kill only the sandbox it just created, reports whether cleanup was confirmed, and closes the client.

Successful sandboxes remain running until their configured timeout or explicit deletion. Build artifacts/registered templates remain available and may incur backend costs; they are not deleted automatically. Preparation timeout may leave a submitted remote artifact. The launcher prints the returned reference on success, and backend dashboards/owned resource names support reconciliation on failure. No Registry build or webpage creates visitor cloud resources or receives visitor cloud keys.

## Adapter contract

`ProviderTemplateManager.prepareProject(directory, options)` is optional and guarded by `templates.build`. It returns `{reference,status:"ready",metadata?,provider_options?,startup_command?,ready_command?}`. The host rejects invalid ready references and credential overrides. The reference may be an ID, native name or image. Express uses its provider-owned CLI composition extension; node/1 plugins implement their own manager. `kit.project.stage`, `buildImage` and `runTool` are generic filesystem/process/OCI primitives with no vendor IDs, API endpoints or credential policy. Authentication, native SDK/API mapping, registry pull fields and Kubernetes resources stay in each adapter.

# Launch a template without copying a cloud ID

`template launch` is a native project extension. It downloads a catalog source (or accepts a local directory), checks the selected provider's declared capabilities, asks that adapter to prepare the project, and creates a sandbox using the exact returned reference. It never converts one cloud's ID into another cloud's ID.
Image-based adapters share the remaining preparation deadline across build, push and registration; fractional remaining seconds do not prevent local tools from starting.


```sh
abx --provider e2b template launch alibaba-agent-sandbox/awesome-templates//python-hello --yes
abx --provider opensandbox template launch ./my-project --yes
```

Use `--alias NAME` to select the build name, `--timeout SECONDS` for preparation (default 600, maximum 3600), and `--sandbox-timeout SECONDS` for sandbox lifetime (default 300). `--yes` explicitly permits build/registration and a billable sandbox. A successful JSON result has `sandbox_id`, `provider`, and `template_reference`; no secret or raw build output is emitted.

## Install a CLI that includes this extension

Run `abx template launch --help` to check the installed entry. Update with the official installer or `npm install -g @agent-sandbox/cli@0.4.9`; 0.4.9 also includes arrow-key configuration menus. The official site's [mirror manifest](https://www.agent-sandbox.cn/releases/latest.json) identifies the binary release currently delivered.

```sh
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
abx template launch --help
```

A source checkout can also be built with `npm ci && npm run build`, then run as `node dist/bin/abx.js`. Standard template commands keep their existing meanings.

## Configure the provider once

Install/update the catalog plugin using its documented Git source; pinned installs remain pinned. The new project adapters need a host build exposing the generic project primitives. The CLI reports an actionable prerequisite error on older hosts. OpenSandbox’s Docker path has native CLI/SDK and project-launch acceptance. E2B, CubeSandbox and container-cluster paths remain **Beta**; see the [provider acceptance scope](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/blob/main/docs/acceptance.md). Per-template test coverage is independent.

| Provider path | One-time preparation requirements | Returned reference |
| --- | --- | --- |
| Bundled Express | Its existing AK/SK, sandbox key, region and deployment configuration | Ready platform template ID |
| E2B | Independent `ABX_E2B_API_KEY`; Node 22+ with optional e2b SDK; `ABX_E2B_BUILD_BASE_IMAGE` when the source has an unresolved FROM | Official SDK build's template ID |
| CubeSandbox | Docker, writable `ABX_CUBESANDBOX_IMAGE_REPOSITORY`, Docker registry login, native `ABX_CUBESANDBOX_BUILD_BASE_IMAGE`, Cube API configuration | Native ready template ID |
| OpenSandbox | Docker, writable `ABX_OPENSANDBOX_IMAGE_REPOSITORY`, registry login and reachable OpenSandbox server; `ABX_OPENSANDBOX_BUILD_BASE_IMAGE` for unresolved FROM | Immutable image reference |
| Container edition | Docker/registry, `ABX_ALICLOUD_CONTAINER_IMAGE_REPOSITORY`, kubectl access, `ABX_ALICLOUD_CONTAINER_KUBE_NAMESPACE` matching the API-key namespace; base SandboxSet name (`build_template`, default `code-interpreter`) and main container name when ambiguous | Adapter-owned SandboxSet name |

The base image must retain that backend's required runtime (including envd/Jupyter when declared). The host does not guess a vendor image or silently substitute a generic base. Container preparation obtains the base image from the base SandboxSet and preserves its runtime injection, init containers, volumes and probes. It never edits that base resource; an existing generated resource is reused only when ownership/image match. Its zero-sized pool is claimed with the backend's documented create-on-no-stock option.

Project builds stage an isolated copy and leave the source unchanged. Providers explicitly allow the template spec's optional wheel-copy input to be absent, retaining the Dockerfile's pinned installation fallback. Local OCI builds use existing Docker registry authentication and immutable content-based tags. They do not log tool output or use Express keys for another backend. Configure private image pull credentials separately in that provider's namespace.

## Templates, preparation and PTY

A catalog template is a project recipe. A backend template ID identifies an already registered runtime; an image reference identifies a container image. These are different inputs. `template launch` asks the selected provider to build/register as required and passes its returned reference to create. Direct creation from an existing template still requires that backend's ID/name (or image URI where supported).

PTY means a pseudo-terminal for interactive programs, terminal resizing and terminal input/output. Template preparation and PTY are independent. A template requiring `terminal` can launch only when the selected provider declares and implements `pty` and the runtime supports it. The project Provider `connect` line REPL executes separate commands and does not establish a persistent PTY session. Enabling `terminal` in YAML alone cannot implement a missing server protocol or provider adapter.

Custom implementations belong in the provider's project preparation and terminal adapters, with matching runtime support and real-backend validation. Catalog capability declarations describe the adapter; Beta and per-template test status describe verification separately. “Automatic preparation” still requires the documented credentials, tools and permissions.

## Capability checks, readiness and cleanup

A template requiring PTY is rejected before preparation when the provider does not declare `pty`. The same applies to code/files/ports. Reference handling does not add missing capabilities. OpenSandbox's current absence of `code.interpret` therefore still blocks templates requiring that feature.

E2B waits for the official SDK build; Cube waits for its exact native build job. Express polls an asynchronous registration before reporting ready. The adapter may ask the launcher to start the project service and run its readiness command. If that new sandbox fails startup/readiness, the launcher attempts to kill only the sandbox it just created, reports whether cleanup was confirmed, and closes the client.

Successful sandboxes remain running until their configured timeout or explicit deletion. Build artifacts/registered templates remain available and may incur backend costs; they are not deleted automatically. Preparation timeout may leave a submitted remote artifact. The launcher prints the returned reference on success, and backend dashboards/owned resource names support reconciliation on failure. No Registry build or webpage creates visitor cloud resources or receives visitor cloud keys.

## Adapter contract

`ProviderTemplateManager.prepareProject(directory, options)` is optional and guarded by `templates.build`. It returns `{reference,status:"ready",metadata?,provider_options?,startup_command?,ready_command?}`. The host rejects invalid ready references and credential overrides. The reference may be an ID, native name or image. Express uses its provider-owned CLI composition extension; node/1 plugins implement their own manager. `kit.project.stage`, `buildImage` and `runTool` are generic filesystem/process/OCI primitives with no vendor IDs, API endpoints or credential policy. Authentication, native SDK/API mapping, registry pull fields and Kubernetes resources stay in each adapter.

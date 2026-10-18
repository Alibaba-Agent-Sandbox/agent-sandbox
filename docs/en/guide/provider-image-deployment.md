# Provider templates from a pushed image

`abx template from-image` converts an already pushed OCI image through the selected provider's optional `templates.deploy` factory. It does not run Docker or use Express's ACR/template APIs. Existing `template build`, `push`, `create`, `deploy`, `install`, `list`, `info` and `delete` routes retain their separate legacy capability gates.

```sh
abx --provider PROVIDER template from-image docker.io/example/runtime:v1 --name runtime:v1 --cpu 2 --memory 1024 --timeout 600 -y
```

`PROVIDER` must declare `templates.deploy` and implement `buildTemplates(ctx)`. The shipped E2B catalog manifest currently does not declare it. The adapter in [provider PR 5](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/5) remains experimental until host/schema delivery and native cloud acceptance. Installing today's unmodified catalog does not enable this command. Express does not declare the new capability.

| Parameter | Contract |
| --- | --- |
| `IMAGE` | Required pullable OCI reference; no URL scheme, embedded credentials, query or fragment |
| `--name` | Required provider name, optionally with a tag |
| `--cpu`, `--memory` | Optional positive integers, cores and MiB |
| `--start-cmd`, `--ready-cmd` | Optional nonblank build-time commands; start requires readiness |
| `--timeout` | Default 600 seconds; finite, greater than zero, at most 3600 |
| `-y`, `--yes` | Skip the build/cost confirmation |

Configure provider credentials in their own namespace, for example `ABX_E2B_API_KEY`; Express and native SDK fallback keys are not borrowed. Private image pulls use `ABX_IMAGE_REGISTRY_USERNAME` and `ABX_IMAGE_REGISTRY_PASSWORD` together, supplied through the environment. Do not put secrets in image references or command arguments.

A successful `--json` result contains only `template_id`, `build_id`, `status: "ready"` and `ref`. Invalid requests fail before factory creation. Unsupported providers return E8004 before Docker, registry or cloud work. Remote error bodies and cancellation reasons are omitted. Timeout/cancellation ends waiting; a submitted remote build may still exist, so inspect the provider dashboard. Factory closure releases local HTTP resources and does not delete a remote template.

E2B image builds require Node.js 22+ and the optional pinned `e2b@2.55.0` package; ordinary sandbox operations keep their existing Node.js support and do not load that SDK. Install the CLI with optional dependencies enabled. Node 20 receives a host prerequisite error for this path.

## Plugin contract and verification

`Provider.buildTemplates(config)` and optional node/1 `buildTemplates(ctx)` return `{deploy(input), close?()}`. Input is image-only: `{source:{kind:"image",image},name,spec?,registry?,timeout?,signal?}`. `spec` accepts only `cpu`, `memory`, `start_cmd`, `ready_cmd`; registry accepts `username` and `password`. The factory must honor cancellation/deadlines and close owned resources on failure. `templates.build` does not imply this factory. The Python SDK's matching schema accepts the declaration but exposes no Python deployment API.

Run `npm run build`, then `ABX_E2B_PROVIDER_SOURCE=/path/to/reviewed/e2b node e2e/providers/template-image.mjs`. This installs a temporary locally opted-in manifest, drives the built CLI through the actual adapter and pinned official SDK against loopback, checks provider-only/private-registry authentication and exact ready output, then removes its store and server. It does not prove a native E2B build or sandbox execution. Native build/create/execute/kill requires an authorized E2B account and remains an unfulfilled release gate.

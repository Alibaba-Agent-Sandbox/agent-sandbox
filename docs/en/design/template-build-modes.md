# Template build modes

Status: current source behavior for Sandbox template preparation. The mode rules below describe the Express adapter; other Providers expose their own supported preparation capabilities. Managed application builds follow the [managed application guide](../guide/managed-applications.md).

## Commands and outputs

```bash
abx template build ./project --out ./.abx/build.json --timeout 600 --yes
abx deploy --build ./.abx/build.json --name my-app --yes
# Or prepare and deploy directly:
abx deploy ./project --name my-app --build-timeout 600 --yes
```

`template build` prepares a reusable artifact without creating an instance. `deploy --build FILE` consumes that artifact; `--build` does not select a mode. Direct `deploy SOURCE` prepares source and creates a named deployment. Source publication is a separate `template publish SOURCE --tag VERSION` operation.

## Choosing the preparation path

For Express, set `build.mode` in `template.yaml` to `auto`, `dockerfile` or `steps`. Without an explicit Dockerfile profile, the adapter uses that value, or `auto` when omitted.

| Manifest mode | Preparation |
|---|---|
| `dockerfile` | Build the local Dockerfile, push the image to the configured repository, then register it. |
| `steps` | Register `base.image` and the expanded platform steps without a local Docker build or ACR push. |
| `auto` | Prefer an existing Dockerfile; otherwise use the declared platform steps. |

When both recipes exist, `auto` selects the Dockerfile and reports that the platform steps were not sent. Explicit `steps` ignores a Dockerfile and an ambient ACR namespace. Configure build credentials through `abx config init --build` or supported configuration inputs; the public authoring commands do not expose the former adapter-specific build flags.

`--build-profile NAME` on `template build` or `deploy` selects a named Dockerfile recipe declared in the source:

```yaml
build_profiles:
  portable:
    dockerfile: Dockerfile.portable
    context: .
```

The selected Dockerfile must be a root-level filename and the context must be `.`. Explicit profile selection uses that Dockerfile; it does not fall back to another recipe when preparation fails.

## Platform steps

A Sandbox template uses `spec_version: 5`. Alongside its service, resource and startup declarations, an Express platform-step recipe can contain:

```yaml
base:
  image: python:3.12-slim
build:
  mode: steps
  apt_install: [build-essential]
  pip_install: ["pandas>=2.0"]
  npm_install: []
  env:
    PYTHONUNBUFFERED: "1"
  run:
    - python -c "import pandas"
  steps:
    - type: RUN
      args: ["echo done"]
```

The adapter expands declarations in this order, then appends raw `build.steps`:

| Declaration | Platform step |
|---|---|
| `apt_install` | `RUN` with apt update/install and package-list cleanup |
| `pip_install` | `RUN` with `pip install --no-cache-dir` |
| `npm_install` | `RUN` with `npm install -g` |
| `env` | One `ENV` step with separate key and value arguments per variable |
| `run` | One `RUN` step per command |
| `steps` | Explicit `{ type, args }` entries; `args` is a string array |

Platform steps require a base image and at least one step. `base: IMAGE` is equivalent to `base.image`. Dockerfile mode instead uses the Dockerfile's `FROM`. Missing recipes, invalid modes or a missing selected Dockerfile fail preparation.

No local file context is uploaded for platform steps and no `COPY` step is generated. Use a Dockerfile recipe when the build needs local application files. Dependency commands execute as supplied; review generated source before building.

Express native `ENV` is not a guarantee that a value reaches later `RUN` commands or runtime processes. For explicit startup/readiness commands, the adapter supplies the final step environment through a quoted `/usr/bin/env` wrapper; later declarations replace earlier values. Keep runtime inputs in the template's `env` declarations or explicit deployment inputs. Named application commands belong in application code and are not build steps.

## Readiness, deadlines and cleanup

Both reusable builds and direct source deployments wait for template preparation to become ready. A successful native registration submission alone is not proof of readiness. Inspect native state with `abx --provider alicloud-express provider run template.get --input-file template-get.json`, where the file contains `template_id` and optionally `team_id`.

For Sandbox preparation, `template build --timeout SECONDS` and `deploy --build-timeout SECONDS` set the preparation budget: 600 seconds by default, greater than zero and at most 3600. `deploy --sandbox-timeout` separately sets instance lifetime; `--request-timeout` configures request timing. A local deadline does not prove remote work stopped or that an uncertain create can be replayed safely.

Use `status` and `recover` for a failed named deployment, then `delete` for resources it owns. A separately prepared build remains independent: remove its consumers before `template build --clean BUILD_FILE --yes`, and inspect reported images requiring manual cleanup. See [authoring templates](../guide/authoring-templates.md) and [deployment boundaries](../guide/template-launch.md).

Model-assisted authoring uses `template init --prompt` or `--adopt` and stops at source files. SDK sandbox creation does not invoke this build pipeline.

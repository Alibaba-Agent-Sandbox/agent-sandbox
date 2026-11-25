# Template build modes

Status: current source behavior for Sandbox template preparation. The mode rules below describe the Express adapter; other Providers expose their own supported preparation capabilities. Managed application builds follow the [managed application guide](../guide/managed-applications.md).

## Commands and outputs

```bash
abx template build ./project --timeout 600
abx deploy ./project --name my-app --build-timeout 600 --yes
```

Local build creates Docker images only. Native Steps and Serving actions are deployment work. Source publication remains `template publish SOURCE --tag VERSION`. Resource v1 separates static deploy from `abx create`; existing v5 source deploy retains its instance startup behavior. See [resource projects](../guide/native-resources.md).

## Choosing the preparation path

For the existing v5 Express source deployment path, set `build.mode` in `template.yaml` to `auto`, `dockerfile` or `steps`. Without an explicit Dockerfile profile, the adapter uses that value, or `auto` when omitted.

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

Deploy waits for cloud template preparation to become ready; local build only waits for Docker. A successful native registration submission alone is not proof of readiness. Inspect native state with `abx --provider alicloud-express provider run template.get --input-file template-get.json`, where the file contains `template_id` and optionally `team_id`.

For Sandbox preparation, `deploy --build-timeout SECONDS` sets the cloud preparation budget: 600 seconds by default, greater than zero and at most 3600. `deploy --sandbox-timeout` separately sets instance lifetime; `--request-timeout` configures request timing. A local deadline does not prove remote work stopped or that an uncertain create can be replayed safely.

Use `status` and `recover` after a failed deployment, then `delete` for confirmed owned resources. Manage local build images with Docker and retained remote images with their registry.

Model-assisted authoring uses `template init --prompt` or `--adopt` and stops at source files. SDK sandbox creation does not invoke this build pipeline.

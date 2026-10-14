# Template build modes

Status: current specification for how a template directory becomes a registered sandbox template.

A template is published in exactly one way per invocation. The user chooses. The default looks at the directory and picks.

## Modes

`--build` on `abx template build`, `abx template deploy`, and `abx deploy` accepts `auto` (default), `dockerfile`, or `steps`. `template.yaml` may set `build.mode` to the same three values. The command flag wins. When the flag is `auto` and the file sets a mode, the file mode is used.

| Mode | What runs | `CreateTemplate` body |
|---|---|---|
| `dockerfile` | Local `docker build`, push to ACR, then register | `sandboxConfig.image` is the pushed image. `steps` is omitted. |
| `steps` | No local Docker and no ACR push | `sandboxConfig.image` is `base.image`. `sandboxConfig.steps` is the expanded step list. |
| `auto` | `Dockerfile` present → `dockerfile`. Otherwise, if the file has any build declaration → `steps`. | As the chosen mode. |

When `auto` finds both a `Dockerfile` and build declarations, the Dockerfile path is used and the CLI prints that the platform steps were not sent.

`steps` does not read a `Dockerfile` even if one is present. An `ACR_NAMESPACE` value that comes from the environment is ignored. Passing `--acr-namespace` together with `--build steps` is a usage error (exit 2). `--legacy-api` with `steps` is a usage error: platform steps are sent only on the official `CreateTemplate` API.

## template.yaml

Fields that already take effect stay as they are (`name`, `capabilities`, `ports`, `resources`, `server`, `env`). Named commands stay in `commands.py`. They are not build steps.

```yaml
name: python-data
base:
  image: python:3.12-slim
build:
  mode: auto
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

Declarations expand in this order, then raw `build.steps` are appended unchanged:

| Declaration | Platform step |
|---|---|
| `apt_install` | `{ "type": "RUN", "args": ["apt-get update && apt-get install -y <pkgs> && rm -rf /var/lib/apt/lists/*"] }` |
| `pip_install` | `{ "type": "RUN", "args": ["pip install --no-cache-dir <pkgs>"] }` |
| `npm_install` | `{ "type": "RUN", "args": ["npm install -g <pkgs>"] }` |
| `env` | one `{ "type": "ENV", "args": ["KEY=VAL"] }` per variable |
| `run` | one `{ "type": "RUN", "args": ["<command>"] }` per command |
| `steps` | copied as `{ type, args }` |

The official model documents `type` with the example `RUN` and `args` as a list of strings. `ENV` is sent in that same shape. If the platform rejects a type, the CLI exits 1 and includes the platform message. `COPY` is not generated: local files are not part of the cloud build context. Copying files requires `dockerfile` mode.

`steps` mode requires `base.image`. That value is `sandboxConfig.image`. In `dockerfile` mode the `FROM` line in the Dockerfile is the base image; `base.image` is not sent.

## Errors

| Situation | Exit |
|---|---|
| `auto`, no Dockerfile and no build declarations | 2 |
| `dockerfile`, no Dockerfile | 2 |
| `steps`, missing `base.image` or no steps | 2 |
| `steps` with `--acr-namespace` or `--legacy-api` | 2 |
| `build.mode` is not `auto`, `dockerfile`, or `steps` | 2 |
| Platform rejects a step | 1 |

## SDK

The CLI implements these rules. The Python client does not deploy templates. Creating a sandbox (`Sandbox.create`) does not select a build mode.

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

`steps` does not read a `Dockerfile` even if one is present. An `ACR_NAMESPACE` value that comes from the environment is ignored. Passing `--acr-namespace` together with `--build steps` is a usage error (exit 2). Platform steps use the official `CreateTemplate` API.

## template.yaml

Fields that already take effect stay as they are (`name`, `capabilities`, `ports`, `resources`, `server`, `env`). Named commands stay in `commands.py`. They are not build steps.

`base` is either a mapping or a string. A string is the image reference (`base: python:3.12-slim` is the same as `base.image`). `generation`, `start_cmd`, and `ready_cmd` are optional. `abx template deploy` sends them on `CreateTemplate`. A flag (`--generation`, `--start-cmd`, `--ready-cmd`) overrides the file. When the selected provider starts the server with a platform command and the directory contains `commands.py`, a missing `generation` defaults to `2` and a missing `start_cmd` / `ready_cmd` defaults to that provider profile. Other templates default to generation 1 and no start command. Generation 1 rejects a start command. If a generation-1 template of the same name already exists, deploy stops and prints `abx template delete <id> -y` followed by a redeploy. `--force` deletes that template and creates it again. `-y` does not.

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
| `env` | one `{ "type": "ENV", "args": ["KEY", "VAL"] }` per variable |
| `run` | one `{ "type": "RUN", "args": ["<command>"] }` per command |
| `steps` | copied as `{ type, args }` |

The official model documents `type` with the example `RUN` and `args` as a list of strings. Express `ENV` requires separate key/value arguments; values containing spaces or equals signs remain one argument. If the platform rejects a type, the CLI exits 1 and includes the platform message. The provider does not reliably propagate native `ENV` into later build `RUN` or runtime processes. For explicit generation-2 start/readiness commands, the CLI supplies the final declared ENV values with a quoted `/usr/bin/env` shell wrapper. Literal values remain literal and later ENV declarations override earlier ones. With no explicit runtime command (for example generation1), runtime environment behavior remains provider-defined. `COPY` is not generated: local files are not part of the cloud build context. Copying files requires `dockerfile` mode.

`steps` mode requires `base.image`. That value is `sandboxConfig.image`. In `dockerfile` mode the `FROM` line in the Dockerfile is the base image; `base.image` is not sent.

## Errors

| Situation | Exit |
|---|---|
| `auto`, no Dockerfile and no build declarations | 2 |
| `dockerfile`, no Dockerfile | 2 |
| `steps`, missing `base.image` or no steps | 2 |
| `steps` with `--acr-namespace` | 2 |
| `build.mode` is not `auto`, `dockerfile`, or `steps` | 2 |
| Platform rejects a step | 1 |

## SDK

The CLI implements these rules. The Python client does not deploy templates. Creating a sandbox (`Sandbox.create`) does not select a build mode.

## Natural-language creation

Express `abx create --prompt "Python data analysis" --yes --detach --build steps` forwards the
explicit mode to generation and deployment. The provider supplies its resolved base image;
the CLI assembles file-transfer steps from final local bytes because no COPY context is
uploaded. Files and WORKDIR precede dependency commands so relative requirements files work.
The model supplies business code and existing build.run dependencies; ordered native steps
repair ownership after WORKDIR and restore the provider runtime user. Generation uses the published `agent-sandbox-server==0.4.0a3` alpha from the official
PyPI index. The prompt pipeline waits for Ready before creating a sandbox; direct
`template deploy --build steps` still reports submission, so poll `template info` separately.
The default Docker route is unchanged. Model-generated code is an artifact to review and test.

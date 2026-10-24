# Authoring Templates

This document explains how to create custom Agent Sandbox templates, including the directory structure, adapting an existing project, and publishing with the CLI.

Three ways to start, all of them local files only (publish later with `abx deploy`):

| Starting point | Command |
|----------------|---------|
| Built-in scaffold | `abx template scaffold -t python ./my-template` |
| A sentence (Qwen Code writes a new directory) | `abx template scaffold --prompt "a Python data analysis environment"` |
| A project that already has source code | `abx template scaffold --adopt ./app` — see [Adapt an existing project](#adapt-an-existing-project) |

---

## Template Directory Structure

A complete template directory structure is as follows:

```text
my-template/
├── template.yaml      # Required — template definition
├── Dockerfile         # Optional — custom Docker build (takes priority over build steps in template.yaml)
├── commands.py        # Optional — register custom commands via @command
└── README.md          # Optional — template description
```

`template.yaml` is the only required file.

Publish with `abx deploy`. `--build auto` (the default) uses the Dockerfile when that file exists. Otherwise it sends `base.image` and the `build:` block (`apt_install`, `pip_install`, `npm_install`, `env`, `run`, `steps`) as platform build steps, with no local Docker build and no ACR push. `--build dockerfile` and `--build steps` force one path. See [Template build modes](../design/template-build-modes.md).

---

## template.yaml Basic Example

```yaml
name: my-python-template
version: "1.0.0"
spec_version: 4
workflow_contract_version: 1
description: "Python data analysis application"
provides:
  app:
    protocol: agent-sandbox-server
    version: 2
    port: 9000
    operations: [commands.list, commands.run]
default_workflow: application
workflows:
  application:
    kind: application
    input: source
    service: app
    startup: entrypoint
    binding: {transport: http, endpoint: provider-port, caller: host, authentication: none}
    operation: commands.run
    required_operations: []
generation: 2
start_cmd: agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py
ready_cmd: agent-sandbox-server healthcheck --port 9000
ports: [9000]
resources: {cpu: 2, memory: 2048}
env:
  PYTHONUNBUFFERED: "1"
```

---

## Workflow contracts and named commands

The example above describes an Express application HTTP service implemented by `commands.py`; it also needs a Dockerfile or self-contained platform build steps. Project templates require the explicit spec v4 workflow contract. Retired `capabilities`, `tested_on` and `providers` fields are rejected, and there is no default capability grant. Named commands belong in `commands.py` with `@command`, not in the YAML. Call `start()` only under `if __name__ == "__main__"`.

Use `abx sandbox command list <id>` and `abx sandbox command run <id> <name> --arg k=v`. Application authorization is independent of envd: when the service requires a token, configure `ABX_SERVER_TOKEN`; the client does not retry an unauthorized request without its credential. The service must advertise the exact endpoint operation before the CLI sends the command payload. See the [Template YAML Spec](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md).

`base` can be an image string or `{ image: ... }`. On Express, generation 2 and platform `start_cmd` / `ready_cmd` start the application; the base image entrypoint is preserved. Deploy caches the manifest by returned template ID and any explicit alias. A cache is a project manifest, not proof that the cloud template is Ready.

## Dockerfile Customization

The `Dockerfile` in the template directory is the image when one is present. `template.yaml` does not install packages. Extra packages are `RUN` lines on the provider profile in the next section. The default provider is `alicloud-express`: the FC base image, no `CMD` or `ENTRYPOINT`, workdir `/home/user/app`. `FROM python:3.11-slim` is not that image.

## Provider template profile

The HTTP server inside the image does not depend on a sandbox provider. `commands.py` imports only `agent_sandbox.server` and calls `start(port)` under `if __name__ == "__main__"`. A `start()` or `serve()` call at import time breaks the platform `--commands` import. Port 9000 is the server default.

Which `FROM`, whether `ENTRYPOINT` may be replaced, `CMD` versus a platform `start_cmd` / `ready_cmd`, architecture, workdir, reserved ports, and registry notes come from the **selected provider's template profile**. `abx` resolves that provider the same way as every other command: `--provider`, then `ABX_PROVIDER`, then the configured default (`alicloud-express`). The template guide, the codegen prompt, and `abx template scaffold` describe that one profile.

- `alicloud-express` uses `FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>`, does not set `CMD` or `ENTRYPOINT`, and starts the server with the platform `start_cmd` / `ready_cmd`. Workdir is `/home/user/app`. Ports 49983, 5000, and 49999 are reserved by that profile.
- Any other provider uses the generic profile (`FROM python:3.12-slim`, `CMD ["python3", "commands.py"]`, `WORKDIR /app`) unless its `abx-provider.toml` declares a `[template]` table. A missing profile is not the FC image; the generator names the provider id that had none.
- The image installs `agent-sandbox-server`, not the client package. `abx template scaffold` writes `RUN pip install --no-cache-dir "agent-sandbox-server @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/61c43e0be65a1f57aa09186d578e7b399e48429b.tar.gz#subdirectory=server-sdk"`. The built-in scaffold retains this source pin. Natural-language generation uses the published alpha `agent-sandbox-server==0.3.1a1` with `python3 -m pip install --index-url https://pypi.org/simple`; this is not a stable SDK release. A Dockerfile that already pins `python-sdk/archive/<40-hex>.tar.gz#subdirectory=server-sdk` is used as written, and deploy does not query PyPI. `ABX_SERVER_SDK_SOURCE` replaces that pin with a local wheel, whatever SHA it names.

---

## Adapt an existing project

`abx template scaffold --adopt` is for a directory that already has application code and is missing the sandbox template files. Qwen Code reads a copy of that project and abx writes the template files back into the same directory. Nothing is built, pushed, or launched; publish with `abx deploy` afterwards.

```bash
abx template scaffold --adopt . --hint "the API listens on 8080"
abx template scaffold --adopt ./app --dry-run          # list the files; send nothing
abx template scaffold --adopt ./app --name my-api -y   # non-interactive
abx deploy ./app --acr-namespace my-ns
```

`--hint` is free text for facts the code does not show (the listen port, a sidecar, a private constraint). `--name` sets the template name: it must match `^[a-z0-9][a-z0-9-]*$`. When `--name` is omitted, abx slugs the directory name. A name that cannot be slugged (a Chinese-only directory, for example) needs `--name`.

### Files written back

Only these files are written, and only after you confirm the preview (or pass `-y`):

| File | When |
|------|------|
| `Dockerfile` | Always |
| `commands.py` | The `SandboxServer` HTTP entry point, port 9000 |
| `template.yaml` | Name, resources, ports, workflow contracts |
| `.dockerignore` | Only when the project does not already have one |

Application source stays as it is. A file the agent creates or edits outside that list is reported and discarded. A replaced file is kept as `*.abx-bak`; an existing backup is never overwritten (the next one is `.abx-bak.1`).

### What is sent to the model

abx copies candidate files into a temporary directory (`abx-adopt-…` under the system temp dir, never `~/.abx`) and asks before sending them. The agent runs only in that copy.

Left out of the copy: `.git`, `node_modules`, virtualenvs, and similar heavy directories; `.env` and other secret-named files (keys, `credentials*`, `kubeconfig`, …); files whose contents look like a secret; symlinks; binaries; files larger than 1 MiB. The copy stops above 2 000 files or 20 MiB and tells you to point `--adopt` at a subdirectory.

`--dry-run` prints that file list and deletes the copy. It does not call the model and does not write the project. A non-interactive shell (CI, piped input, `--json`) must pass `-y`; otherwise the command stops before any copy is made.

The agent process does not inherit cloud or registry credentials (`ALICLOUD_*`, `E2B_*`, `ACR_*`, `AWS_*`, `GITHUB_TOKEN`). It does receive the Qwen Code key from `abx config`.

This sends your project source to the model. `abx template scaffold --prompt "DESCRIPTION"` sends only the sentence you typed.

### Checks before anything is written

abx rejects the result, leaves the project unchanged, and prints the staging path when:

- the Dockerfile has no `FROM`, or `commands.py` does not start `agent_sandbox.server`
- port 9000 is missing from `template.yaml` `ports` or from `EXPOSE`
- a `COPY` / `ADD` names a file that is missing or ignored (`COPY *.whl` is still allowed: `abx template deploy` injects a wheel only when `ABX_SERVER_SDK_SOURCE` or a PyPI release supplies one, and otherwise drops that line before `docker build`)
- a secret-named file would still be in the Docker build context after `.dockerignore` and `Dockerfile.dockerignore`
- an ignore file excludes `*.whl`, which would block the SDK wheel

An existing `.dockerignore` that does not exclude `.env` (including one re-included with `!`) fails before the model is called, with the lines to add. An existing `.dockerignore` is never rewritten.

### Replacing files that are already there

| Already in the project | What happens |
|------------------------|--------------|
| `template.yaml` | Refused: the directory is already a template. Run `abx deploy`, or pass `--force` to regenerate (the original is kept as `template.yaml.abx-bak`) |
| `commands.py` that does not import `agent_sandbox.server` | Needs `--force` |
| `Dockerfile`, or an Agent Sandbox `commands.py` | An interactive preview can replace it. `-y`, `--json`, and CI need `--force` because there is no preview |

`abx template scaffold --from <local directory>` requires a `template.yaml` in that directory. A source tree without one is refused and the message points at `--adopt`, so `.env` and `.git` are not copied as template source.

If generation fails, the project is unchanged and the error includes the staging directory. Delete that `abx-adopt-…` directory after you have inspected it.

`--adopt` cannot be combined with `-t`, `--from`, or `--list`. `--hint` and `--dry-run` require `--adopt`.

---

## Publishing Templates

### Publish to GitHub

Push the template directory to a GitHub repository, and other users can install it with:

```bash
abx template install your-org/your-template
```

### Local Installation

```bash
abx template install ./my-template --registry-type local
```

Installed templates are saved in the `~/.abx/templates/` directory.

### Building and Registering Templates Locally (template deploy)

When you need to register a custom Docker image as a sandbox template, use the `template deploy` subcommand. It automatically performs: local Docker build → ACR push → CreateTemplate API call.

> **Prerequisites**:
> - Docker daemon is running
> - Alibaba Cloud AK/SK credentials (configured in `.env` or environment variables)
> - The official Alibaba Cloud template API client (`@alicloud/fcsandbox20260509`) is bundled with `@agent-sandbox/cli` — no extra install is needed

```bash
# Default: official CreateTemplate API
abx template deploy ./my-template \
  --acr-namespace my-ns --acr-repo my-template

# Specify resource parameters
abx template deploy ./my-template \
  --acr-namespace my-ns --cpu 4 --memory 4096 --disk-size 10240 --internet-access

```

**Template API**:

| API | Authentication | Dependency |
|-----|----------------|------------|
| Official CreateTemplate API | AK/SK | `@alicloud/fcsandbox20260509` (bundled) |

> **Region note**: The official API uses the region configured via `abx config set region` (else `cn-hangzhou`). A single deployment can override it with the command-level `--region`/`-r` option on `template deploy`/`build`/`create`/`push`/`list`/`info`/`install`/`delete`. Cross-region ACR access may require VPC-related parameters.

### Creating Templates from Existing Images

If the image is already pushed to ACR, you can create a template directly without local building:

```bash
abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag --name my-template
```

---

## Next Steps

- [Using Templates](using-templates.md) — Install and use templates

---

## Related SDK documentation

The `template.yaml` contract and the Python-side authoring guides live in the [`python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk):

- [Template YAML Spec](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md) — precise definitions for all fields
- [Authoring Templates (SDK)](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/authoring-templates.md) — field reference, workflow declarations, custom commands, `@command`
- [Template System](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/template-system.md) — tiers, name resolution, versioning
- [Declarative Usage](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/declarative-usage.md) — the `@sandbox` decorator

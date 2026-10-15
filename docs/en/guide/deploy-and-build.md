# Deploy and Build

This guide covers the CLI's build-and-publish workflow: the **template lifecycle** (`abx template init` → `abx deploy` → `abx create`). The Python SDK does not build or deploy anything; it launches the result (see [Related SDK documentation](#related-sdk-documentation)).

---

## The template lifecycle

A sandbox template goes through three steps. Each has one job, and **what a template is lives in `template.yaml`** — not in command-line flags.

| Step | Command | Input | AI? |
|------|---------|-------|-----|
| 1. Author | `abx template init` / `abx template init "DESCRIPTION"` / `abx template init --adopt [DIR]` | a scaffold case, a description, or an existing project | optional |
| 2. Publish | `abx deploy [PATH]` | the template directory (`Dockerfile`, `template.yaml`, ...) | never |
| 3. Launch | `abx create --template <TEMPLATE_ID>` | the template ID | never |

`abx create "DESCRIPTION"` is steps 1 + 2 + 3 in one command (with a confirmation before anything is pushed).

```bash
# 1a. An existing project: files are written into that same directory
abx template init --adopt ./app --hint "listens on 8080"
abx deploy ./app --acr-namespace my-ns

# 1b. A new project from a sentence: files land in ./<name>/
abx template init "a python data science env"
abx deploy ./<name> --acr-namespace my-ns

abx create --template <TEMPLATE_ID>               # 3. launch a sandbox
```

`--adopt` sends a copy of the project source to the model (secrets excluded) and writes back only the template files. The rules, the preview, and `--dry-run` are in [Authoring Templates — Adapt an existing project](authoring-templates.md#adapt-an-existing-project).

Everything you would otherwise describe to the AI at deploy time — what the service is, its ports, resources, capabilities, environment, custom commands — is written into `template.yaml` (and `Dockerfile` / `commands.py`) during step 1, where you can review and version it. Describe it once, at authoring time.

### abx deploy — the publish step

`abx deploy` is a **fixed, deterministic publish** and needs **no LLM and no LLM key**. `--build` chooses the path (`auto` by default):

| `--build` | What happens |
|-----------|----------------|
| `dockerfile` | `docker build`, push to ACR, `CreateTemplate` with the pushed image, wait until ready |
| `steps` | no local Docker and no ACR push. `CreateTemplate` gets `base.image` and `sandboxConfig.steps` |
| `auto` | Dockerfile present → `dockerfile`. Otherwise a `build:` block → `steps` |

`steps` reads `template.yaml` `build.apt_install`, `pip_install`, `npm_install`, `env`, `run`, and raw `build.steps`. It requires `base.image` and the official API. `--acr-namespace` together with `--build steps` is a usage error. An `ACR_NAMESPACE` value that is only in the environment is ignored. The spec is [Template build modes](../design/template-build-modes.md).

It is the same pipeline as `abx template deploy DIR`, with `PATH` defaulting to `.`, and it accepts every option of that command (`--acr-namespace`, `--alias`, `--yes`, `-v/--verbose`, `--region`, ...). From `template.yaml` it reads the template `name` (used as the ACR repository unless `--acr-repo` is given), `resources.cpu`, `resources.memory`, `generation`, `start_cmd`, and `ready_cmd`. `base` may be `base.image` or a string image reference. Command-line options override the file. On Alibaba Cloud Express, a directory with `commands.py` and no `generation` is published as generation 2 with the provider start and ready commands, so `abx template deploy . -y` starts `agent-sandbox-server` without extra flags. `abx template init` installs that server with `RUN pip install --no-cache-dir "agent-sandbox-server @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/b6e71fa4b6127e94a0da0aa96642ee96f69ad87a.tar.gz#subdirectory=server-sdk"`. `agent-sandbox-server` is not on PyPI (the PyPI name `agent-sandbox` is a different project). `ABX_SERVER_SDK_SOURCE` still injects a wheel built from a local `server-sdk` tree and replaces that line for the build. A leftover `COPY *.whl` with no wheel is removed before `docker build`, so the legacy builder (no buildx) can run. `--provenance=false` is added, and the auto-added notice is printed, only when `docker buildx version` succeeds. `--force` replaces an existing generation-1 template of the same name; without it, the error prints `abx template delete <id> -y`.

On an interactive terminal the build, the push, and the wait for READY each show a `message... 12s` header with the latest six log lines in grey underneath, so a long `docker build` is not a frozen spinner. The elapsed time keeps moving once a second while a step is silent. `--verbose` prints every line instead. `--json`, `--quiet`, CI, and non-TTY keep a single progress line. Creating a sandbox, upload, download, template fetch, image registration, the coding-agent install, and `abx kill --all` use that same moving header on a terminal. Grey rows include a short redacted tool detail (command, url, query, or path) when an agent is working, and otherwise paths, milestones, and build output. File bytes, thinking, and credentials stay hidden. Those commands print nothing for the header when stdout is not a terminal.

```bash
abx deploy --acr-namespace my-ns          # publish ./ from ./Dockerfile
abx deploy ./my-template --build steps --yes
abx deploy ./my-template --yes -v         # non-interactive, with debug logs
```

If the directory has neither a `Dockerfile` nor `build:` steps, the command stops and points you at `abx template init --adopt` (an existing project), `abx template init "DESCRIPTION"`, or `abx template init -t`.


---

## Next Steps

- [Authoring Templates](authoring-templates.md) — Define templates via template.yaml

---

## Related SDK documentation

- [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md) and [API Reference](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/api-reference.md)

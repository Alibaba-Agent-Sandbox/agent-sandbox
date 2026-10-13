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

`abx deploy` is a **fixed, deterministic pipeline** and needs **no LLM and no LLM key**:

1. `docker build` the `Dockerfile`
2. push the image to Alibaba Cloud ACR
3. register it as a template (`CreateTemplate`)
4. wait until the template is ready

It is the same pipeline as `abx template deploy DIR`, with `PATH` defaulting to `.`, and it accepts every option of that command (`--acr-namespace`, `--alias`, `--yes`, `-v/--verbose`, `--region`, ...). From `template.yaml` it reads the template `name` (used as the ACR repository unless `--acr-repo` is given), `resources.cpu`, `resources.memory` and `generation`; command-line options override them.

On an interactive terminal the build, the push, and the wait for READY each show a `message... 12s` header with the latest six log lines in grey underneath, so a long `docker build` is not a frozen spinner. The elapsed time keeps moving once a second while a step is silent. `--verbose` prints every line instead. `--json`, `--quiet`, CI, and non-TTY keep a single progress line. Creating a sandbox, upload, download, template fetch, image registration, the coding-agent install, and `abx kill --all` use that same moving header on a terminal. Grey rows include a short redacted tool detail (command, url, query, or path) when an agent is working, and otherwise paths, milestones, and build output. File bytes, thinking, and credentials stay hidden. Those commands print nothing for the header when stdout is not a terminal.

```bash
abx deploy --acr-namespace my-ns          # publish ./ (needs ./Dockerfile)
abx deploy ./my-template --yes -v         # non-interactive, with debug logs
```

If the directory has no `Dockerfile`, the command stops and points you at `abx template init --adopt` (an existing project), `abx template init "DESCRIPTION"`, or `abx template init -t`.


---

## Next Steps

- [Authoring Templates](authoring-templates.md) — Define templates via template.yaml

---

## Related SDK documentation

- [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md) and [API Reference](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/api-reference.md)

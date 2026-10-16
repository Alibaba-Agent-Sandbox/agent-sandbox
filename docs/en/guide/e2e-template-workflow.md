# From Template to Production Sandbox: End-to-End Guide

This guide walks you through the complete workflow of a custom sandbox template, from authoring to production use.

```mermaid
graph LR
    A[Author template] --> B[Validate locally]
    B --> C[Push & deploy]
    C --> D[Create sandbox]
    D --> E[Run tasks]
    E --> F[Clean up]
```

---

## Prerequisites

- Docker Desktop running (for local image builds)
- Node.js 20+
- Install the CLI:

```bash
npm install -g @agent-sandbox/cli
```

> **No extras to install**: the CLI features used throughout this guide — reading defaults from `template.yaml` (YAML parsing), parsing `.env` files, installing templates from a registry, and the Alibaba Cloud template API — are built into `@agent-sandbox/cli`.

- Alibaba Cloud AK/SK credentials configured in a `.env` file:

```env
ALICLOUD_ACCESS_KEY_ID=your-access-key-id
ALICLOUD_ACCESS_KEY_SECRET=your-access-key-secret
ACR_NAMESPACE=your-acr-namespace
```

- An ACR namespace created in the Alibaba Cloud ACR console (one-time setup). In the console, open **Container Registry (ACR) → Namespaces → Create Namespace**, then use that namespace name as `ACR_NAMESPACE` (or the `--acr-namespace` flag).

> For authentication details, see [Authentication](authentication.md).

---

## Alternative Starting Point: Install a Template from a Registry

If you'd rather not author a template from scratch, use `abx template install` to fetch a ready-made template from a GitHub repo. The source of truth for official & community templates is [awesome-templates](https://github.com/alibaba-agent-sandbox/awesome-templates) — discover templates with `abx template search <query>` against the remote index, then install by name with `abx template install <name>` (full `owner/repo[//subdir][@ref]` references also work).

> **`install` now runs the full pipeline by default.** `abx template install <ref> --acr-namespace <ns>` **downloads → builds the image → pushes to ACR → deploys** the template via the official CreateTemplate API in a single command. To only fetch the sources into the local cache (`~/.abx/templates/`) without building or deploying, add `--download-only`, then run `abx template build` / `abx template deploy` later.

> ⚠️ **Cost & safety**: the default `install` (and `abx template deploy`) push images to your ACR registry and call the official `CreateTemplate` API on your Alibaba Cloud account — these operations may incur charges. Use `--download-only` when you only want to inspect the sources.

### Install options

| Option | Description |
|--------|-------------|
| `--acr-namespace` | ACR namespace for the build + deploy step (env `ACR_NAMESPACE`, or set in `.env`) |
| `--cpu` | CPU cores (default: from `template.yaml` or 2) |
| `--memory` | Memory in MB (default: from `template.yaml` or 2048) |
| `-y`, `--yes` | Skip the confirmation prompt |
| `--download-only` | Only download to the local cache (skip build and deploy) |
| `--dir PATH` | Download template source to a custom directory instead of `~/.abx/templates` |

### Reference syntax

```text
owner/repo                # Whole repository (default branch)
owner/repo//subdir        # Subdirectory of a repository
owner/repo@main           # Specific branch
owner/repo//subdir@v1.0   # Subdirectory + specific tag/branch/commit sha
./my-template             # Local directory
```

Subdirectories are separated by a double slash `//`, and the version reference is an `@` suffix (tag, branch, or commit sha — fetched via the GitHub tarball API, no Release required). Private repositories and higher rate limits: prefer `abx config set github_token` (masked input, stored once in `~/.abx/.env`) over the one-off `--token <github-token>` override, which may leak into shell history or the process list.

### Download only: inspect the sources first

With `--download-only`, `install` just fetches the template into the local cache — it never builds or deploys:

```bash
$ abx template install alibaba-agent-sandbox/awesome-templates//python-hello --download-only
Fetching template from alibaba-agent-sandbox/awesome-templates...
Alias   python-hello
Source  ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/python-hello
Cached  ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/python-hello
Status  installed-locally
Template 'python-hello' installed to the local cache. Build and push the image with 'abx template build'.
```

The template sources are cached at `~/.abx/templates/{owner}/{repo}/{ref}/{name}/` (`ref` is `default` when not specified) and can be inspected directly:

```bash
$ ls ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/python-hello/
Dockerfile      README.md       commands.py     template.yaml

$ cat ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/python-hello/template.yaml
name: python-hello
version: "1.0.0"
description: "A minimal Python hello world template for testing"
author: "alibaba-agent-sandbox"
tags:
  - python
  - hello-world
  - example

base: ubuntu:22.04

system_packages:
  - python3
  - python3-pip

capabilities:
  - shell
  - files
  - code
  - ports

ports:
  - 9000


env:
  LANG: C.UTF-8
```

Install another template, node-web:

```bash
$ abx template install alibaba-agent-sandbox/awesome-templates//node-web --download-only
Fetching template from alibaba-agent-sandbox/awesome-templates...
Alias   node-web
Source  ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/node-web
Cached  ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/node-web
Status  installed-locally
Template 'node-web' installed to the local cache. Build and push the image with 'abx template build'.
```

A local directory works the same way:

```bash
$ abx template install ./my-template --download-only
Using local template from ./my-template...
Alias   my-template
Source  ./my-template
Cached  ~/.abx/templates/my-template
Status  installed-locally
Template 'my-template' installed to the local cache. Build and push the image with 'abx template build'.
```

### Default: download, build, and deploy in one shot

Without `--download-only`, `install` runs the whole pipeline. It needs an ACR namespace for the build + deploy step; if none is provided (via `--acr-namespace`, `ACR_NAMESPACE`, or `.env`), it stops before building and tells you exactly how to fix it:

```bash
$ abx template install ./my-template -y
Using local template from ./my-template...
Cannot build + deploy. Missing prerequisites:
  • Missing ACR namespace. Provide via:
  1. abx config set acr_namespace <ns>   (or re-run 'abx config init')
  2. --acr-namespace flag
  3. export ACR_NAMESPACE=<ns>
  4. ACR_NAMESPACE=<ns> in .env (CWD or ~/.abx/.env)

Run with --download-only to just download the template.
```

Provide the namespace to run the full flow (equivalent to `abx template deploy`):

```bash
abx template install alibaba-agent-sandbox/awesome-templates//python-hello --acr-namespace my-ns
```

### What to do after `--download-only`

- **Deploy it to your own platform account**: run `abx template deploy <cache-path>` on the cached directory (or `abx template build` for a step-by-step build & push) — the workflow is identical to Step 3 below.
- **The template is already deployed on the platform**: skip install entirely and create a sandbox by template name (`abx create python-hello`).
- **Iterate locally**: the cache directory is plain template source — copy it out, modify it, and follow the full workflow in this guide.

---

## Step 1: Author the Template

### Scaffold a new template (recommended)

The fastest way to start is the built-in scaffold. `abx template scaffold` generates a ready-to-edit template directory, so you no longer have to hand-write `template.yaml` / `Dockerfile` / `commands.py` from memory.

When the `DIRECTORY` argument is omitted, the scaffold creates a new subdirectory `./<name>` in the current working directory. The `<name>` is resolved by priority: `--name` > scaffold case name (the `-t` value) > template name from `--from`.

List the available scaffold cases:

```bash
$ abx template scaffold --list
  python       Python 3.11 sandbox with shell, files, and code capabilities
  node         Node.js 20 sandbox with shell, files, and code capabilities
  minimal      Bare-minimum template with only template.yaml + Dockerfile
```

Scaffold a Python template into `./my-template`:

```bash
$ abx template scaffold -t python ./my-template
✅ Template 'my-template' created in ./my-template
Created files:
  Dockerfile
  README.md
  commands.py
  template.yaml

Next steps:
  abx template deploy ./my-template --acr-namespace <ns>
  abx template install ./my-template --acr-namespace <ns>
```

> Scaffolding and credentials setup are separate commands: `abx template scaffold` (this section) writes local files only, while `abx config init` stores credentials and `abx create` launches a cloud sandbox. There is no top-level `abx init`.

### Adapt a project that already has source code

When the directory is an application (Flask, Express, a script) and has no `Dockerfile` / `template.yaml`, use `--adopt`. Qwen Code sees a copy; abx writes `Dockerfile`, `commands.py`, `template.yaml`, and a `.dockerignore` when you don't already have one, into that same directory.

```bash
$ abx template scaffold --adopt ./my-app --hint "listens on 8080"
# review the preview, then:
$ abx deploy ./my-app --acr-namespace my-ns
```

`--dry-run` lists every file that would be sent and contacts no model. `-y` is required outside an interactive terminal. Secrets (`.env`, keys, secret-looking files) stay out of the copy, and the agent process does not inherit cloud credentials. The full rules — backups, `--force`, and what is rejected before a write — are in [Authoring Templates — Adapt an existing project](authoring-templates.md#adapt-an-existing-project).

`abx template scaffold --prompt "DESCRIPTION"` is the other generation path: it creates a **new** directory from a sentence. `--adopt` fills in the project you already have.

### Understand the generated files

The scaffold produces the same file layout you would otherwise write by hand:

```text
my-template/
├── template.yaml    # Template definition (name, capabilities, resources)
├── Dockerfile       # Container build file
├── commands.py      # Server-side command registration (optional)
└── README.md        # Documentation
```

#### template.yaml

The generated `template.yaml` (python case):

```yaml
name: my-template
version: "1.0.0"
description: "Python sandbox template"

base: python:3.11-slim

capabilities:
  - shell
  - files
  - code

resources:
  cpu: 2
  memory: 2048
```

**Key fields:**

| Field | Description |
|-------|-------------|
| `name` | Unique template identifier, used with the `--template` flag |
| `base` | Base Docker image (informational when a Dockerfile is present) |
| `capabilities` | Runtime capability declarations: `shell`, `files`, `code`, `terminal`, `ports` |
| `resources.cpu` | CPU cores (can be overridden via CLI flags at deploy time) |
| `resources.memory` | Memory in MB (can be overridden via CLI flags at deploy time) |

For the full field specification, see [template.yaml Spec](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md).

#### Dockerfile

The generated `Dockerfile` (python case):

```dockerfile
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

# agent-sandbox-server is not on PyPI. This archive is the server-sdk directory
# of a pinned python-sdk commit. ABX_SERVER_SDK_SOURCE replaces it with a local wheel.
RUN pip install --no-cache-dir "agent-sandbox-server @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/61c43e0be65a1f57aa09186d578e7b399e48429b.tar.gz#subdirectory=server-sdk"

WORKDIR /app
COPY commands.py .

EXPOSE 9000
CMD ["python3", "commands.py"]
```

> **Server install**: `agent-sandbox-server` is not published on PyPI. The PyPI project named `agent-sandbox` is a different package. Deploy does not query PyPI when this pin, or any other 40-hex `python-sdk` archive pin of `server-sdk`, is already in the Dockerfile. The line above installs `server-sdk` from a pinned public commit archive, which `docker build` can run without BuildKit and without a local wheel. Set `ABX_SERVER_SDK_SOURCE` to a `server-sdk` tree when you need that checkout instead; `abx template deploy` then copies the built wheel by its exact filename. A Dockerfile that still has `COPY *.whl` is rewritten for that build when no wheel is present, because the legacy builder rejects an empty glob.

### Named commands (optional)

Named commands are not declared in `template.yaml`. Register them in `commands.py`, the `SandboxServer` entry point that runs inside the sandbox, then call them with `abx run <sandbox-id> <command>` (list them with `abx sandbox command list <sandbox-id>`):

```python
from agent_sandbox.server.registry import registry

@registry.command("test")
def test(path: str = ".") -> str:
    ...
```

```bash
abx run <sandbox-id> test --arg path=tests/
```

For more advanced templates (with a `commands.py` server-side command registration), see the [node-web example](https://github.com/alibaba-agent-sandbox/awesome-templates/tree/main/node-web) in the template source-of-truth repository.

---

## Step 2: Validate Locally

Before deploying, verify the Dockerfile builds correctly on your machine:

```bash
# Build the image (must target linux/amd64 — the FC runtime is x86_64)
docker build --platform linux/amd64 --provenance=false -t my-app:test ./my-template

# Quick smoke test
docker run --rm my-app:test python3 -c "print('OK')"
```

> **About `--provenance=false`**: Docker Buildx adds an attestation manifest by default, which makes Alibaba Cloud FC image optimization fail (the template gets stuck in the `error` state). It appears in the manual `docker build` above only because that command bypasses the CLI. `abx template deploy` adds `--provenance=false` only when `docker buildx version` succeeds, and only then prints the auto-added notice. A daemon without the buildx plugin does not get the flag and does not print that notice (the legacy builder does not attach provenance). Set `DOCKER_BUILDKIT=0` to force the legacy builder.

---

## Step 3: Deploy the Template

### One-command deploy (recommended)

```bash
# Make sure ACR_NAMESPACE is set in .env
abx template deploy ./my-template

# Non-interactive. stdout is one JSON object; the id is the TemplateID field.
abx --json template deploy ./my-template -y
```

The `deploy` command performs 5 steps internally:

1. **Docker build** — build the image locally (platform `linux/amd64`, `provenance=false`)
2. **ACR login** — automatically exchange AK/SK for a temporary token and log in to ACR
3. **Docker push** — push the image to your ACR repository
4. **CreateTemplate API** — call the official Alibaba Cloud FCSandbox API to create the template
5. **Poll until READY** — poll the template status until the build completes

> ⚠️ **Cost & safety**: `abx template deploy` (and the default `abx template install`) push images to your ACR registry and call the official `CreateTemplate` API on your Alibaba Cloud account — these operations may incur charges. Only deploy templates you intend to run.

During the build step, when `docker buildx version` succeeds the CLI adds `--provenance=false` and prints a notice. Without buildx it does not add the flag and does not print the notice (set `DOCKER_BUILDKIT=0` to force that path):

```
ℹ 已自动添加 --provenance=false（避免 FC 镜像优化失败；设置 DOCKER_BUILDKIT=0 可跳过）
```

### Custom parameters

```bash
abx template deploy ./my-template \
  --acr-namespace my-ns \
  --tag v1.0 \
  --cpu 4 \
  --memory 4096
```

Common options:

| Option | Description | Default |
|--------|-------------|---------|
| `--acr-namespace` | ACR namespace | Read from env or `.env` |
| `--tag` | Image tag | `latest` |
| `--cpu` | CPU cores | From `template.yaml`, fallback 2 |
| `--memory` | Memory in MB | From `template.yaml`, fallback 2048 |
| `--disk-size` | Disk size in MB | Platform default |
| `--timeout` | Build timeout in seconds | 600 |
| `-v, --verbose` | Stream full Docker build logs | Off |

### Verify the deployment

After deploying, list templates with `--official-api` to see the **real names and statuses** (`ready` / `building` / `error`). Below is real run output (2026-09-28, cn-hangzhou, truncated for brevity):

```bash
$ abx template list --official-api
┏━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━┳━━━━━━━━┓
┃ TemplateID           ┃ Name                        ┃ Alias ┃ Status ┃
┡━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━╇━━━━━━━━┩
│ tpl00000000000000001 │ hermes-agent                │       │ ready  │
│ tpl00000000000000002 │ codex-agent                 │       │ ready  │
│ tpl00000000000000003 │ python-hello-prov           │       │ ready  │
│ tpl00000000000000004 │ python-hello-v2             │       │ error  │
│ tpl00000000000000005 │ e2e-python-hello            │       │ error  │
│ tpl00000000000000006 │ python-hello                │       │ ready  │
│ tpl00000000000000007 │ node-web                    │       │ ready  │
│ tpl00000000000000008 │ base                        │       │ ready  │
│ … (36 templates in this account, truncated here)
└──────────────────────┴─────────────────────────────┴───────┴────────┘
```

> **Status meaning**: only `ready` templates can successfully create sandboxes. Templates in the `error` state above (e.g. `python-hello-v2`, `e2e-python-hello` — usually caused by a failed image build/optimization, see [Troubleshooting](#troubleshooting)) cannot be used with `abx create`.

Without `--official-api`, the E2B-compatible endpoint is used and only template IDs are returned (no name/status):

```bash
$ abx template list
┏━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━┳━━━━━━━━┓
┃ TemplateID           ┃ Alias ┃ Status ┃
┡━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━╇━━━━━━━━┩
│ tpl00000000000000001 │ N/A   │ N/A    │
│ tpl00000000000000009 │ N/A   │ N/A    │
│ … (36 total, truncated here)
└──────────────────────┴───────┴────────┘
```

Inspect a single template:

```bash
$ abx template info <template-id> --official-api
```

### Parameter defaults priority

CLI flags > declarations in `template.yaml` > hardcoded defaults. See the [CLI Reference](../reference/cli-reference.md) for the full priority chain.

---

## Step 4: Use the Sandbox

### CLI workflow (real run transcript)

> **About the output below**: all of it was captured from **real `abx` commands executed on 2026-09-28 in the cn-hangzhou region** — nothing is fabricated. To keep the key results focused, the capability-fallback warning that each command prints **once** on stderr (expected when `base` has no locally cached `template.yaml`) is omitted. Since task 167 that warning is a single `WARNING:` line on the diagnostic channel — results stay on stdout and never mix with it — so the formerly duplicated timestamped log line is gone. The sandbox ID `sbx-00000000-0000-4000-8000-000000000000` was really generated by this run and has the format `sbx-<UUID>`; replace `<SANDBOX_ID>` in the commands below with your own ID.

**① Create a sandbox**

```bash
$ abx create base
ID           sbx-00000000-0000-4000-8000-000000000000
Status       running
Template     base
URL          https://49983-sbx-00000000-0000-4000-8000-000000000000.cn-hangzhou.e2b.fc.aliyuncs.com
EnvdVersion  0.5.2
Sandbox sbx-00000000-0000-4000-8000-000000000000 created successfully.
```

**② Inspect the sandbox**

```bash
$ abx info <SANDBOX_ID>
ID           sbx-00000000-0000-4000-8000-000000000000
Template     base
Status       running
Region       cn-hangzhou
Timeout      300s
URL          https://49983-sbx-00000000-0000-4000-8000-000000000000.cn-hangzhou.e2b.fc.aliyuncs.com
EnvdVersion  0.5.2
Started      2026-09-28 04:03:13.302944+00:00
Metadata     {'fcSessionDetails': '{"containerId":"c-6ab9e700-…","sessionIdleTimeoutInSeconds":300,"sessionStatus":"Active"}', 'fcSessionID': 'd60cf963-…', …}   # truncated
```

**③ Execute shell commands**

```bash
$ abx exec <SANDBOX_ID> 'echo "Hello from sandbox"'
Hello from sandbox

$ abx exec <SANDBOX_ID> 'node --version'
v20.20.2

$ abx exec <SANDBOX_ID> 'python3 -c "print(2+2)"'
4
```

**④ List a directory**

```bash
$ abx exec <SANDBOX_ID> 'ls -la /home/user'
total 40
drwxr-xr-x 1 user user 4096 Jul 19 08:08 .
drwxr-xr-x 1 root root 4096 Jul  9 07:32 ..
-rw-r--r-- 1 user user  220 Mar  8  2026 .bash_logout
-rw-r--r-- 1 user user 3526 Mar  8  2026 .bashrc
drwxr-xr-x 3 user user 4096 Jul 19 08:08 .config
-rw-r--r-- 1 user user   40 Jul 19 08:08 .npmrc
-rw-r--r-- 1 user user  807 Mar  8  2026 .profile
drwxr-xr-x 2 user user 4096 Jul 16 13:58 log
drwxr-xr-x 2 user user 4096 Jul 16 13:58 workspace
```

**⑤ Write and read a file**

```bash
$ abx exec <SANDBOX_ID> 'sh -c "echo hello > /home/user/test.txt"'
# (no stdout, exit code 0)

$ abx exec <SANDBOX_ID> 'cat /home/user/test.txt'
hello
```

**⑥ Upload / download files**

```bash
$ echo "uploaded from local" > /tmp/abx_e2e_test.txt

$ abx upload <SANDBOX_ID> /tmp/abx_e2e_test.txt /home/user/uploaded.txt
Uploaded /tmp/abx_e2e_test.txt -> /home/user/uploaded.txt

$ abx download <SANDBOX_ID> /home/user/uploaded.txt /tmp/abx_e2e_download.txt
Downloaded /home/user/uploaded.txt -> /tmp/abx_e2e_download.txt

$ cat /tmp/abx_e2e_download.txt
uploaded from local
```

**⑦ Show sandbox system info**

```bash
$ abx sandbox system info <SANDBOX_ID>
OS             Linux
Arch           x86_64
Hostname       c-6ab9e700-1550f19f-ec5ff9d3d0af
CPU_Count      2
Python         3.13.13
Disk_Total_GB  9.81
Disk_Free_GB   9.29
```

**⑧ List running sandboxes**

```bash
$ abx list
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━━━━━┓
┃ ID                                       ┃ Template ┃ Status  ┃ Region      ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━━━━━┩
│ sbx-00000000-0000-4000-8000-000000000000 │ base     │ running │ cn-hangzhou │
└──────────────────────────────────────────┴──────────┴─────────┴─────────────┘
```

> **Tip**: right after a sandbox is created, the server-side list may lag briefly (eventual consistency). If `abx list` is momentarily empty, wait a few seconds and retry.

**⑨ Kill the sandbox and verify**

```bash
$ abx kill <SANDBOX_ID> -y
Sandbox sbx-00000000-0000-4000-8000-000000000000 killed.

$ abx info <SANDBOX_ID>          # verify: destroyed, returns 404
[E5000] Resource not found (HTTP 404).
  Suggestion: Verify the sandbox ID, template ID, or endpoint URL.

$ abx list
No sandboxes found.
```

### Template name resolution (real failure case)

`--template` accepts either a template **name** or an **ID**, but only a template that is `ready` and whose image starts successfully can be created. Below is the real output when creating `python-hello` — even though `abx template list --official-api` shows a `ready` `python-hello`, this create attempt had its connection reset by the platform during cold start:

```bash
$ abx create python-hello
[E5003] Connection reset by remote: <StreamReset stream_id:1, error_code:2, remote_reset:True>
  Suggestion: The platform closed the connection before responding. This usually means the operation took too long (e.g., sandbox cold start). Try:
  1. Increase HTTP timeout: abx config set http_timeout 120
  2. Retry the command
  3. Disable HTTP/2: abx config set http2 false
```

Retrying multiple times under `http_timeout=120` and `http2=false` still failed, eventually reporting a request timeout:

```bash
$ abx create python-hello
[E3001] Request timed out: 
  Suggestion: The HTTP request timed out. Try:
  1. Increase HTTP timeout: abx config set http_timeout 120
  2. Or set env: export ABX_HTTP_TIMEOUT=120
  3. Check network connectivity
```

> **Takeaway**: before creating, confirm the target template is `ready` via `abx template list --official-api`; when several same-prefix names exist (e.g. `python-hello` / `python-hello-v2` / `python-hello-prov`), prefer the **template ID** to avoid ambiguity. If a `ready` template still times out, it is usually a slow image cold start — increase `http_timeout` or retry (see [Troubleshooting](#troubleshooting)).

### Use the sandbox from code

To drive the sandbox from Python (create, run commands, read and write files, the agent workflow pattern), see the [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md).

---

## Step 5: Clean Up & Iterate

### Kill sandboxes

```bash
# Kill a specific sandbox
abx kill <sandbox-id>

# Kill all running sandboxes
abx kill --all
```

> ⚠️ **Data loss warning**: `abx kill --all` destroys **every** running sandbox in your account, and their in-memory/ephemeral data is lost permanently. Without `--yes` the CLI asks for confirmation first — only add `-y/--yes` in automation where you're certain no sandbox needs to survive.

### Update the template

Edit the template files and re-deploy (use a new tag to avoid caching):

```bash
# Edit the template
vim ./my-template/Dockerfile

# Re-deploy with a new version tag
abx template deploy ./my-template --tag v1.1
```

### Delete the template

```bash
abx template delete <template-id>
```

---

## Troubleshooting

| Symptom | Possible cause | Solution |
|---------|---------------|----------|
| No Dockerfile | The directory is application source, not a template yet | `abx template scaffold --adopt .`, then `abx deploy` |
| Confirmation required before project files are sent | Non-interactive `--adopt` without `-y` | Pass `-y`, or `--dry-run` to list the files without sending them |
| Docker build failed | Dockerfile syntax / network issue | Add `-v` to see detailed logs |
| ACR login failed | AK/SK expired or insufficient permissions | Verify credentials in `.env` |
| Template stuck in "building" | Platform-side image optimization in progress | Wait, or check with `abx template info <id> --official-api` |
| Template in error state | Docker attestation not disabled | Ensure the build uses `--provenance=false` (handled by the SDK by default) |
| `E3001` Request timed out | HTTP timeout too short | `abx config set http_timeout 120` |
| StreamReset / `E5003` | Slow platform cold start | Retry, or disable HTTP/2: `abx config set http2 false` |
| Sandbox creation fails | Template image pull error | Check ACR image accessibility and permissions |
| Command returns 500 | Shell operators not wrapped | The SDK auto-wraps with `sh -c`; check the envd version |

For more, see [Troubleshooting](troubleshooting.md) and the [Error Codes Reference](../reference/error-codes.md).

---

## Further Reading

- [Authoring Templates](authoring-templates.md) — Full template development tutorial
- [CLI Reference](../reference/cli-reference.md) — Full command cheat sheet
- [Authentication](authentication.md) — API Key / AK-SK dual authentication modes
- [Environment Variables](environment-variables.md) — Sandbox env var injection and scoping
- [awesome-templates source of truth](https://github.com/alibaba-agent-sandbox/awesome-templates) — the single source of truth for official & community template content, the index, and publishing (`abx template search` / `abx template install`)

## Related SDK documentation

- [template.yaml Spec](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md) — Complete field definitions
- [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md) — Complete Python SDK usage

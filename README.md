# Easy Sandbox

**English** | [中文](README.zh-CN.md)

<!-- badges -->
[![CI](https://github.com/Easy-Sandbox/easy-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/Easy-Sandbox/easy-sandbox/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@easy-sandbox/cli)](https://www.npmjs.com/package/@easy-sandbox/cli)
[![Node 20+](https://img.shields.io/node/v/@easy-sandbox/cli)](https://www.npmjs.com/package/@easy-sandbox/cli)
[![License](https://img.shields.io/github/license/easy-sandbox/easy-sandbox)](LICENSE)

> Cloud sandboxes for AI agents — create, execute, and manage isolated environments in seconds.

**Easy Sandbox** is the command-line interface (`ebx`) for the Alibaba Cloud FC Agent Sandbox service.
The Python SDK lives in [the `python-sdk` repository](https://github.com/Easy-Sandbox/python-sdk) (see [Python SDK](#python-sdk)).
It is **E2B-protocol compatible** with extensions for the Alibaba Cloud ecosystem (OSS, VPC, custom domains).

---

## Features

- **CLI (`ebx`)** — create, inspect, exec, upload/download, deploy, and manage sandboxes from the terminal.
- **Template system** — reusable sandbox images (Python, Node, browser automation, AI agent harnesses, …).
- **MCP server** — expose sandbox operations as MCP tools for LLM agents.
- **Agent skill** — a static Agent Skills guide ([`SKILL.md`](SKILL.md)) for Qoder, Claude Code, Cursor, Qwen Code, and Codex.
- **Runs anywhere Node runs** — Node.js >= 20 (npm / `npx`), or a standalone binary with no runtime required.

The SDK-side features (async-first `Sandbox` API, the `run` / `run_code` / `custom` execution primitives, the `@sandbox` declarative decorator, session persistence, and the E2B compatibility layer) are documented in the [Python SDK](#python-sdk) section.

## Installation

Requires **Node.js >= 20**.

```bash
# Install globally from npm
npm install -g @easy-sandbox/cli

# Or run without installing
npx @easy-sandbox/cli --help
```

### Standalone binary (no Node.js required)

`ebx` also ships as a **precompiled standalone binary** for macOS (Apple Silicon / Intel),
Linux (x64 and arm64), and Windows (x64, `.exe`) — no Node.js installation required. Binaries are
published for every release on
[GitHub Releases](https://github.com/Easy-Sandbox/easy-sandbox/releases).

macOS / Linux (replace `0.3.0` with the release you want; `OS` and `ARCH` are
auto-detected):

```bash
VERSION=0.3.0
OS=$(uname -s | tr '[:upper:]' '[:lower:]')   # darwin or linux
ARCH=$(uname -m); case "$ARCH" in
  x86_64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
esac

# Download somewhere the current user can write, then install onto PATH.
curl -fsSL -o "$HOME/ebx" \
  "https://github.com/Easy-Sandbox/easy-sandbox/releases/download/v${VERSION}/ebx-${VERSION}-${OS}-${ARCH}"
chmod +x "$HOME/ebx"
sudo mv "$HOME/ebx" /usr/local/bin/ebx
```

Windows (PowerShell):

```powershell
$VERSION = "0.3.0"
$asset = "ebx-$VERSION-windows-x64.exe"

# Download the release asset
Invoke-WebRequest `
  -Uri "https://github.com/Easy-Sandbox/easy-sandbox/releases/download/v$VERSION/$asset" `
  -OutFile $asset

# Move it to a directory on your PATH (create it first if needed)
$installDir = "$env:LOCALAPPDATA\Programs\ebx"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Move-Item $asset "$installDir\ebx.exe"
```

Checksums, the full platform matrix, and binary vs. npm trade-offs:
[Binary Installation](docs/en/guide/binary-installation.md) ([中文](docs/zh/guide/binary-installation.md)).

## Using with AI coding tools

The repository ships a static Agent Skills guide ([`SKILL.md`](SKILL.md)) that teaches Qoder, Claude Code, Cursor, Qwen Code, and Codex how to operate Easy Sandbox. Install it **before (or without) the `ebx` CLI**:

```bash
# Fast path (requires Node.js); swap qoder for claude-code / cursor / qwen-code / codex,
# add -g for user-level scope, --list to preview
npx skills add easy-sandbox/easy-sandbox --skill easy-sandbox -a qoder -y
```

No Node.js? Copy `SKILL.md` into your tool's skills directory (for example `~/.qoder/skills/easy-sandbox/SKILL.md`). Full tool matrix, version pinning, upgrades, uninstall, and security notes: [Agent Skill Installation & Distribution](docs/en/guide/agent-skill-installation.md) ([中文](docs/zh/guide/agent-skill-installation.md)).

## CLI (`ebx`)

```bash
# Configure credentials
ebx config set sandbox_api_key <YOUR_API_KEY>

# Sandbox lifecycle
ebx create --template python-base       # create a sandbox
ebx list                                 # list running sandboxes
ebx info <sandbox-id>                    # inspect a sandbox
ebx exec <sandbox-id> "echo hello"       # run a shell command
ebx connect <sandbox-id>                 # line-based command REPL

# File transfer
ebx upload <sandbox-id> ./local.txt /remote/path.txt
ebx download <sandbox-id> /remote/path.txt ./local.txt

# Template management
ebx template list                        # list templates
ebx template info python-base            # template details
ebx install owner/repo                   # install from GitHub

# Template deployment (Alibaba Cloud template API, bundled with the CLI)
ebx template create registry.cn-hangzhou.aliyuncs.com/ns/repo:tag --name my-tpl
ebx template deploy ./examples/templates/python-hello \
    --acr-namespace my-ns --acr-repo python-hello

# Template lifecycle: author -> publish -> launch
ebx template init --adopt ./app --hint "port 8080" # 1a. adapt an existing project
ebx template init "a python web server"             # 1b. AI writes ./<name>/ (optional)
ebx deploy ./app --acr-namespace my-ns              # 2. build, push to ACR, register (no LLM)
ebx create --template <TEMPLATE_ID>                 # 3. launch a sandbox

# MCP server
ebx mcp start                            # start MCP tool server

# Cleanup
ebx kill <sandbox-id>
```

> **Environment variables:** envd uses direct exec — shell features (`$VAR`, pipes, redirects) require `sh -c '...'`. Use `printenv VAR` to read a variable. See the [Environment Variables guide (EN)](docs/en/guide/environment-variables.md) | [环境变量指南 (中文)](docs/zh/guide/environment-variables.md) for details.

## Templates

Official and community templates live in the
[`Easy-Sandbox/awesome-templates`](https://github.com/Easy-Sandbox/awesome-templates)
repository — the single source of truth for template content, the index, and
publishing. Discover and install them through the remote index:

```bash
# Discover templates through the remote index
$ ebx template search web
Name      Description       Tags           Status
node-web  Node.js web app   nodejs, web    official

$ ebx template install node-web                                        # install by index name
$ ebx template install Easy-Sandbox/awesome-templates//node-web@v1.0.0 # or pin a ref
```

[`examples/templates/`](https://github.com/Easy-Sandbox/python-sdk/tree/main/examples/templates) (in the `python-sdk` repository) only keeps a minimal
`python-hello` **fixture** for offline tests — it is not a publishing source.
See [examples/templates/README.md](https://github.com/Easy-Sandbox/python-sdk/blob/main/examples/templates/README.md) for the
fixture contract and index behaviour (caching, offline fallback, pinned refs).

## Python SDK

The Python SDK — the async-first `Sandbox` API, the declarative `@sandbox` decorator, session persistence, the E2B compatibility layer, and the layered architecture behind them — lives in [the `python-sdk` repository](https://github.com/Easy-Sandbox/python-sdk). The quick start, the execution API (`sandbox.run()` / `sandbox.run_code()` / `sandbox.custom()`) and the architecture documentation are maintained there.

```bash
# Client SDK (import easy_sandbox)
pip install easy-sandbox

# Server runtime used inside template images (import easy_sandbox.server)
pip install easy-sandbox-server
```

`easy-sandbox-server` is the container-side runtime: template Dockerfiles and `commands.py` install it with `pip install easy-sandbox-server`. The `ebx` CLI is no longer shipped with the Python packages (there is no `[cli]` extra); install it with `npm install -g @easy-sandbox/cli`.

## Documentation

> Full documentation index: [`docs/README.md`](docs/README.md) (bilingual navigation)

### Tutorials & Guides

| Guide | Link |
|-------|------|
| Getting Started | [Getting Started](docs/en/guide/getting-started.md) |
| Best Practices | [Best Practices](docs/en/guide/best-practices.md) |
| Accessibility | [Accessibility](ACCESSIBILITY.md) |
| Operations | [Operations](docs/en/guide/operations.md) |
| Providers | [Providers](docs/en/guide/providers.md) |
| Authoring Providers | [Authoring Providers](docs/en/guide/authoring-providers.md) |
| Binary Installation | [Binary Installation](docs/en/guide/binary-installation.md) |
| CLI Tutorial | [CLI Tutorial](docs/en/guide/cli-tutorial.md) |
| Authentication | [Authentication](docs/en/guide/authentication.md) |
| Environment Variables | [Environment Variables](docs/en/guide/environment-variables.md) |
| Using Templates | [Using Templates](docs/en/guide/using-templates.md) |
| Authoring Templates | [Authoring Templates](docs/en/guide/authoring-templates.md) |
| Deploy & Build | [Deploy & Build](docs/en/guide/deploy-and-build.md) |
| E2E Template Workflow | [E2E Template Workflow](docs/en/guide/e2e-template-workflow.md) |
| BYO Agent Integration | [BYO Agent Integration](docs/en/guide/byo-agent-integration.md) |
| Agent Skill Installation | [Agent Skill Installation](docs/en/guide/agent-skill-installation.md) |
| MCP Integration | [MCP Integration](docs/en/guide/mcp-integration.md) |
| Troubleshooting | [Troubleshooting](docs/en/guide/troubleshooting.md) |

### Reference

| Document | Link |
|----------|------|
| CLI Reference | [CLI Reference](docs/en/reference/cli-reference.md) |
| Configuration | [Configuration](docs/en/reference/configuration.md) |
| Error Codes | [Error Codes](docs/en/reference/error-codes.md) |

### Design & Architecture

| Document | Link |
|----------|------|
| Design Index | [Design Index](docs/en/DESIGN.md) |
| CLI Architecture | [CLI Architecture](docs/en/design/architecture.md) |
| CLI Design | [CLI Design](docs/en/design/cli-design.md) |
| MCP Server | [MCP Server](docs/en/design/mcp-server.md) |
| Templates Catalog | [Templates Catalog](docs/en/design/templates-catalog.md) |

### Related SDK documentation

The Python SDK, the in-sandbox server SDK and the shared platform contracts are documented in the [`python-sdk` repository](https://github.com/Easy-Sandbox/python-sdk): [documentation index](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/README.md), [SDK Usage](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md), [Architecture](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/design/architecture.md), [SDK API Design](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/design/sdk-api-design.md), [Template System](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/design/template-system.md), [Template YAML Spec](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md), [Declarative Usage](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/guide/declarative-usage.md), [Session Persistence](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/guide/session-persistence.md), [Migrate from E2B](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/guide/migrate-from-e2b.md), and [`examples/`](https://github.com/Easy-Sandbox/python-sdk/tree/main/examples).

### Other Resources

| Resource | Link |
|----------|------|
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| Contributing Guide | [CONTRIBUTING.md](.github/CONTRIBUTING.md) |
| License | [Apache-2.0](LICENSE) |

## Contributing

We welcome contributions! Please read the [Contributing Guide](.github/CONTRIBUTING.md) to get started.

## License

[Apache-2.0](LICENSE) — see [`NOTICE`](NOTICE) for copyright information.

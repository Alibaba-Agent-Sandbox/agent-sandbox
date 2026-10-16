# Agent Sandbox

**English** | [中文](README.zh-CN.md)

<!-- badges -->
[![CI](https://github.com/alibaba-agent-sandbox/agent-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/alibaba-agent-sandbox/agent-sandbox/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)
[![Node 20+](https://img.shields.io/node/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)
[![License](https://img.shields.io/github/license/agent-sandbox/agent-sandbox)](LICENSE)

> Cloud sandboxes for AI agents — create, execute, and manage isolated environments in seconds.

**Agent Sandbox** is the command-line interface (`abx`). The default provider is Alibaba Cloud Express (`alicloud-express`). The CLI also loads installed `node`, `exec` and `rest` plugins. The catalog providers `opensandbox`, `alicloud-container`, `cubesandbox` and `e2b` are `node` plugins: an ES module `provider.mjs` that exports `create(kit)`. Install one with `abx provider install alibaba-agent-sandbox/awesome-providers//<id>` (a local path or a git URL also works) and run `abx --provider <id>`. An id that is neither built in nor installed exits `E8001`. A manifest with `runtime.kind = "python"` cannot be installed. In-code Python `Provider` subclasses still work in the Python SDK, which reaches the same `node` plugins through the local engine (`abx provider engine serve`; `abx` on `PATH` or `ABX_BIN`). `exec` (EPP/1 over stdio, any language, optional `pty.*`) remains for third-party plugins.
The Python SDK lives in [the `python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk) (see [Python SDK](#python-sdk)).
Template build and deploy live in this CLI. The runtime client is the Python SDK. Method names there are E2B-shaped to ease migration; neither the CLI nor the SDK is an E2B-protocol drop-in.

## Sites

| Site | URL |
|---|---|
| Official site | https://www.agent-sandbox.com |
| Provider registry | https://registry.agent-sandbox.com |

The CLI installs those catalog providers from the git tree `alibaba-agent-sandbox/awesome-providers//<id>`. The Python SDK installer (`python -m agent_sandbox.providers install registry:<id> --yes`) fetches `https://registry.agent-sandbox.cn/providers/index.json`. `ABX_PROVIDER_REGISTRY` overrides that URL for the SDK installer.

---

## Features

- **CLI (`abx`)** — create, inspect, exec, upload/download, deploy, and manage sandboxes from the terminal.
- **Template system** — reusable sandbox images (Python, Node, browser automation, AI agent harnesses, …).
- **MCP server** — expose sandbox operations as MCP tools for LLM agents.
- **Agent skill** — a static Agent Skills guide ([`SKILL.md`](SKILL.md)) for Qoder, Claude Code, Cursor, Qwen Code, and Codex.
- **Standalone binary, or Node.js >= 20 from source** — the release binary needs no Node.js. The npm package is not published yet.

The SDK-side features (async-first `Sandbox` API, the `run` / `run_code` execution primitives, the `@sandbox` declarative decorator, session persistence, and the E2B compatibility layer) are documented in the [Python SDK](#python-sdk) section.

## Installation

### macOS and Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
```

The installer picks `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, or `windows-x64`, verifies the `.sha256`, and does not need `sudo`. macOS and Linux install to `/usr/local/bin` when that directory is writable, otherwise `$HOME/.local/bin`. Windows installs to `%LOCALAPPDATA%\Programs\abx` and adds it to the user `PATH`. `ABX_VERSION` selects a release (default: latest). `ABX_INSTALL_DIR` selects the directory. The site can host these scripts on its own domain later; the command stays one line and only the URL changes.

These one-liners need a GitHub Release whose assets are named `abx-*`. The v0.2.0 assets are named `ebx-*`, and v0.3.0 is not published yet. Until that release exists, install from source (below).

### Manual download

Download `abx-<version>-<os>-<arch>[.exe]` and the matching `.sha256` from [GitHub Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases), check the digest, and put the file on `PATH` as `abx`. Commands, checksums, and the platform table: [Binary Installation](docs/en/guide/binary-installation.md) ([中文](docs/zh/guide/binary-installation.md)).

### npm (coming soon)

`npm install -g @agent-sandbox/cli` is **coming soon, package not yet published**. The package name is not final. Some npm mirrors (including npmmirror) serve an unrelated `@agent-sandbox/cli@0.2.2` whose bin is `agent-sandbox`, not `abx`.

### From source

Node.js 20 or newer. Verified 2026-10-15 on Linux x64 with Node.js 22.14.0 (`npm pack` wrote `agent-sandbox-cli-0.3.0.tgz`; `abx --version` printed `abx, version 0.3.0`):

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
npm ci
npm run build
npm pack
npm install -g ./agent-sandbox-cli-<version>.tgz
abx --version
```

### Troubleshooting: abx: command not found

The install directory is not on `PATH` until you add the `export PATH=...` line the installer prints (or open a new Windows terminal after `install.ps1`). If `npm install -g @agent-sandbox/cli` installed the mirror package `@agent-sandbox/cli@0.2.2`, uninstall it with `npm uninstall -g @agent-sandbox/cli`; that package's command is `agent-sandbox`. Details: [Binary Installation](docs/en/guide/binary-installation.md#troubleshooting-abx-command-not-found).

## Using with AI coding tools

The repository ships a static Agent Skills guide ([`SKILL.md`](SKILL.md)) that teaches Qoder, Claude Code, Cursor, Qwen Code, and Codex how to operate Agent Sandbox. Install it **before (or without) the `abx` CLI**:

```bash
# Fast path (requires Node.js); swap qoder for claude-code / cursor / qwen-code / codex,
# add -g for user-level scope, --list to preview
npx skills add agent-sandbox/agent-sandbox --skill agent-sandbox -a qoder -y
```

No Node.js? Copy `SKILL.md` into your tool's skills directory (for example `~/.qoder/skills/agent-sandbox/SKILL.md`). Full tool matrix, version pinning, upgrades, uninstall, and security notes: [Agent Skill Installation & Distribution](docs/en/guide/agent-skill-installation.md) ([中文](docs/zh/guide/agent-skill-installation.md)).

## CLI (`abx`)

```bash
# Configure credentials
abx config init                          # credentials + region (--build / --llm add sections)
abx config set sandbox_api_key <YOUR_API_KEY>   # or set one key directly

# Sandbox lifecycle
abx create --template base             # default template
abx create --template python-base      # Python image from the catalog
abx list                                 # list running sandboxes
abx info <sandbox-id>                    # inspect a sandbox
abx exec <sandbox-id> -- echo hello       # run a command (--cwd/--env/--timeout/--stream/--background)
abx run <sandbox-id> <name> --arg k=v    # named command registered on the in-sandbox server
abx connect <sandbox-id>                 # line-based command REPL

# File transfer
abx upload <sandbox-id> ./local.txt /remote/path.txt
abx download <sandbox-id> /remote/path.txt ./local.txt

# Template management
abx template list                        # list templates
abx template info python-base            # template details
abx template install owner/repo          # install from GitHub

# Template deployment (Alibaba Cloud template API, bundled with the CLI)
abx template create registry.cn-hangzhou.aliyuncs.com/ns/repo:tag --name my-tpl
abx template deploy ./examples/templates/python-hello \
    --acr-namespace my-ns --acr-repo python-hello

# Template lifecycle: author -> publish -> launch
abx template init --adopt ./app --hint "port 8080" # 1a. adapt an existing project
abx template init "a python web server"             # 1b. template generation writes ./<name>/ (optional)
abx deploy ./app --acr-namespace my-ns              # 2. build, push to ACR, register (no LLM)
abx create --template <TEMPLATE_ID>                 # 3. launch a sandbox

# MCP server
abx mcp start                            # start MCP tool server

# Cleanup
abx kill <sandbox-id>
```

> **Environment variables:** envd uses direct exec — shell features (`$VAR`, pipes, redirects) require `sh -c '...'`. Use `printenv VAR` to read a variable. See the [Environment Variables guide (EN)](docs/en/guide/environment-variables.md) | [环境变量指南 (中文)](docs/zh/guide/environment-variables.md) for details.

## Templates

Official and community templates live in the
[`alibaba-agent-sandbox/awesome-templates`](https://github.com/alibaba-agent-sandbox/awesome-templates)
repository — the single source of truth for template content, the index, and
publishing. Discover and install them through the remote index:

```bash
# Discover templates through the remote index
$ abx template search web
Name      Description       Tags           Status
node-web  Node.js web app   nodejs, web    official

$ abx template install node-web                                        # install by index name
$ abx template install alibaba-agent-sandbox/awesome-templates//node-web@v1.0.0 # or pin a ref
```

[`examples/templates/`](https://github.com/alibaba-agent-sandbox/python-sdk/tree/main/examples/templates) (in the `python-sdk` repository) only keeps a minimal
`python-hello` **fixture** for offline tests — it is not a publishing source.
See [examples/templates/README.md](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/examples/templates/README.md) for the
fixture contract and index behaviour (caching, offline fallback, pinned refs).

## Python SDK

The Python SDK — the async-first `Sandbox` API, the declarative `@sandbox` decorator, session persistence, the E2B compatibility layer, and the layered architecture behind them — lives in [the `python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk). The quick start, the execution API (`sandbox.commands.run()` / `sandbox.run_code()` / `sandbox.run()`) and the architecture documentation are maintained there.

```bash
# Client SDK (import agent_sandbox)
pip install agent-sandbox

# Server runtime used inside template images (import agent_sandbox.server)
pip install agent-sandbox-server
```

`agent-sandbox-server` is the container-side runtime: template Dockerfiles and `commands.py` install it with `pip install agent-sandbox-server`. The `abx` CLI is no longer shipped with the Python packages (there is no `[cli]` extra). Install it with the [binary installer](docs/en/guide/binary-installation.md). `npm install -g @agent-sandbox/cli` is coming soon, package not yet published.

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
| Agents API | [Agents API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/agents-api.md) |
| Agent Skill Installation | [Agent Skill Installation](docs/en/guide/agent-skill-installation.md) |
| MCP Integration | [MCP Integration](docs/en/guide/mcp-integration.md) |
| Troubleshooting | [Troubleshooting](docs/en/guide/troubleshooting.md) |

### Reference

| Document | Link |
|----------|------|
| CLI command tree (canonical paths, fixed shortcuts) | [CLI Command Reference](docs/en/reference/cli-commands.md) |
| CLI Reference | [CLI Reference](docs/en/reference/cli-reference.md) |
| Configuration | [Configuration](docs/en/reference/configuration.md) |
| Engine HTTP API (SDKs reach providers through it) | [Engine HTTP API](docs/en/reference/engine-api.md) |
| Error Codes | [Error Codes](docs/en/reference/error-codes.md) |

### Design & Architecture

| Document | Link |
|----------|------|
| Design Index | [Design Index](docs/en/DESIGN.md) |
| CLI Architecture | [CLI Architecture](docs/en/design/architecture.md) |
| CLI Design | [CLI Design](docs/en/design/cli-design.md) |
| Node provider architecture | [Node provider architecture](docs/en/design/node-provider-architecture.md) |
| MCP Server | [MCP Server](docs/en/design/mcp-server.md) |
| Templates Catalog | [Templates Catalog](docs/en/design/templates-catalog.md) |

### Related SDK documentation

The Python SDK, the in-sandbox server SDK and the shared platform contracts are documented in the [`python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk): [documentation index](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/README.md), [SDK Usage](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md), [Architecture](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/architecture.md), [SDK API Design](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/sdk-api-design.md), [Template System](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/template-system.md), [Template YAML Spec](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md), [Declarative Usage](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/declarative-usage.md), [Session Persistence](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/session-persistence.md), [Migrate from E2B](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/migrate-from-e2b.md), and [`examples/`](https://github.com/alibaba-agent-sandbox/python-sdk/tree/main/examples).

### Other Resources

| Resource | Link |
|----------|------|
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| Contributing Guide | [CONTRIBUTING.md](.github/CONTRIBUTING.md) |
| License | [Apache-2.0](LICENSE) |

Provider-specific cloud management: `abx provider command list alicloud-express`. See the [provider guide](docs/en/guide/providers.md) for typed commands, explicit write confirmation and current cloud API limits.

## Contributing

We welcome contributions! Please read the [Contributing Guide](.github/CONTRIBUTING.md) to get started.

## License

[Apache-2.0](LICENSE) — see [`NOTICE`](NOTICE) for copyright information.

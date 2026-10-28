# Agent Sandbox CLI

**English** | [中文](README.zh-CN.md)

[![CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)

`abx` creates and manages isolated cloud environments for AI agents. Run commands, transfer files, open terminals, and launch reusable application templates from your terminal.

Alibaba Cloud Express (`alicloud-express`) is the default backend. Additional backends are available through [provider plugins](https://github.com/Alibaba-Agent-Sandbox/awesome-providers).

[Website](https://www.agent-sandbox.cn/en/) · [Documentation](docs/en/README.md) · [Templates](https://registry.agent-sandbox.cn/en/templates/)

## Installation

macOS and Linux:

```bash
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
```

Or install with npm (Node.js 20+):

```bash
npm install -g @agent-sandbox/cli --registry=https://registry.npmjs.org
abx --version
```

Follow the installer's PATH instructions; open a new terminal after installing on Windows. See [binary installation](docs/en/guide/binary-installation.md) for platform support, checksums, version selection and source builds. Current application templates require CLI 0.5.8 or newer.

## Quick start

Configure your provider, then create a sandbox:

```bash
abx config init
abx create base --detach
```

For Express, use a Sandbox API key for your account and region. The setup guide explains [credential sources and required permissions](docs/en/guide/permissions.md), including the optional AccessKey-based preparation flow. Interactive settings are saved locally for later commands.

Replace `<sandbox-id>` below with the ID returned by create:

```bash
abx exec <sandbox-id> echo hello
abx info <sandbox-id>
abx connect <sandbox-id>
abx kill <sandbox-id>
```

`connect` opens a terminal. Exiting it leaves the sandbox running; `kill` deletes it. See the [CLI tutorial](docs/en/guide/cli-tutorial.md) for files, background processes and other operations.

## Launch an application template

Templates package tools such as browser automation, coding agents and web services. Choose one from the [catalog](https://registry.agent-sandbox.cn/en/templates/) and follow its setup instructions:

```bash
abx template search python
abx --provider alicloud-express template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello
```

Source templates need the selected provider's build prerequisites. Launch starts the template's declared services and returns its sandbox ID. The CLI generates and saves the default application authentication token automatically. Model credentials are needed only for templates that use a model.

Use `abx kill <sandbox-id>` when finished. Prepared images or templates may be retained for reuse; follow the [template guide](docs/en/guide/using-templates.md) for setup and resource cleanup.

## Use with AI tools

Run `abx mcp start` to expose sandbox operations through MCP. The repository also includes an [Agent Skill](SKILL.md) for AI coding tools.

- [MCP integration](docs/en/guide/mcp-integration.md)
- [Install the Agent Skill](docs/en/guide/agent-skill-installation.md)

## Documentation

| Task | Guide |
| --- | --- |
| Configure credentials and defaults | [Guided configuration](docs/en/guide/guided-configuration.md) |
| Choose or install a backend | [Providers](docs/en/guide/providers.md) |
| Build and publish a template | [Authoring templates](docs/en/guide/authoring-templates.md) |
| Look up commands and options | [CLI reference](docs/en/reference/cli-reference.md) |
| Move an existing Alibaba E2B CLI setup | [Migration guide](docs/en/guide/migrate-from-e2b.md) |
| Resolve an error | [Troubleshooting](docs/en/guide/troubleshooting.md) |

See the [full documentation index](docs/README.md) and [changelog](CHANGELOG.md).

## Python SDK

Use the [Python SDK](https://github.com/Alibaba-Agent-Sandbox/python-sdk) to control sandboxes from an application. The [Node.js SDK](https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk) calls an already running sandbox application service.

## Contributing

Development setup, checks and contribution workflow are in [CONTRIBUTING.md](.github/CONTRIBUTING.md). Report CLI problems through [Issues](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues).

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for attribution.

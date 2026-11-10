# Agent Sandbox CLI

**English** | [中文](README.zh-CN.md)

[![CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)

`abx` creates and manages isolated cloud environments for AI agents. Run commands, transfer files, open terminals, and launch reusable application templates from your terminal.

Alibaba Cloud Express (`alicloud-express`) is the default backend. Additional backends are available through [provider plugins](https://github.com/Alibaba-Agent-Sandbox/awesome-providers).

[Website](https://www.agent-sandbox.cn/en/) · [Documentation](docs/en/README.md) · [Templates](https://registry.agent-sandbox.cn/en/templates/)

## Installation

These commands require the current source CLI; published 0.5.10 has the previous command layout. Build with Node.js 20+:

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
npm ci
npm run build
npm link
cd ..
abx --help
```

Published 0.5.10 can still be installed with `npm install -g @agent-sandbox/cli@0.5.10`; use that release’s `--help` for its command layout.

## Quick start

Configure your provider, then create a sandbox:

```bash
abx config init
abx deploy --template-id base --name demo --yes
```

For Express, use a Sandbox API key for your account and region. The setup guide explains [credential sources and required permissions](docs/en/guide/permissions.md), including the optional AccessKey-based preparation flow. Interactive settings are saved locally for later commands.

Use the saved deployment name in subsequent commands:

```bash
abx sandbox exec demo -- echo hello
abx status demo
abx sandbox connect demo
abx delete demo --yes
```

`sandbox connect` opens a terminal. Exiting it leaves the sandbox running; `delete` deletes it. See the [CLI tutorial](docs/en/guide/cli-tutorial.md) for files, background processes and other operations.

## Launch an application template

To deploy an Agents API with one stable Gateway and a separate Sandbox per Session, use the
[managed application guide](docs/en/guide/managed-applications.md).

Templates package tools such as browser automation, coding agents and web services. Choose one from the [catalog](https://registry.agent-sandbox.cn/en/templates/) and follow its setup instructions:

```bash
abx template list python
abx deploy python-hello --name hello --yes
```

Source templates need the selected provider's build prerequisites. Launch starts the template's declared services and returns its sandbox ID. The CLI generates and saves the default application authentication token automatically. Model credentials are needed only for templates that use a model.

Use `abx delete hello --yes` when finished. It deletes owned sandboxes and templates; borrowed builds and images requiring manual cleanup are retained. follow the [template guide](docs/en/guide/using-templates.md) for setup and resource cleanup.

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

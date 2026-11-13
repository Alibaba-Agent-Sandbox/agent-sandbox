# Agent Sandbox CLI

**English** | [中文](README.zh-CN.md)

[![CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)

`abx` creates and manages isolated cloud environments for AI agents. Run commands, transfer files, open terminals, and launch reusable application templates from your terminal.

Alibaba Cloud Express (`alicloud-express`) is the default backend. Additional backends are available through [provider plugins](https://github.com/Alibaba-Agent-Sandbox/awesome-providers).

[Website](https://www.agent-sandbox.cn/en/) · [Documentation](docs/en/README.md) · [Templates](https://registry.agent-sandbox.cn/en/templates/)

> **Preview release:** Agent Sandbox is currently in preview and may introduce breaking changes. The stable **1.0.0** release is expected on **November 15, 2026**. Stay tuned!

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
abx sandbox create --template base --yes
```

For Express, use a Sandbox API key for your account and region. The setup guide explains [credential sources and required permissions](docs/en/guide/permissions.md), including the optional AccessKey-based preparation flow. Interactive settings are saved locally for later commands.

Use the Sandbox ID returned by creation in subsequent commands:

```bash
abx sandbox exec SANDBOX_ID -- echo hello
abx status SANDBOX_ID
abx sandbox connect SANDBOX_ID
abx sandbox delete SANDBOX_ID --yes
```

`sandbox connect` opens a terminal. Exiting it leaves the sandbox running; `delete` deletes it. See the [CLI tutorial](docs/en/guide/cli-tutorial.md) for files, background processes and other operations.

## Launch an application template

To deploy an Agents API with one stable Gateway and a separate Sandbox per Session, use the
[managed application guide](docs/en/guide/managed-applications.md).

Templates package tools such as browser automation, coding agents and web services. Choose one from the [catalog](https://registry.agent-sandbox.cn/en/templates/) and follow its setup instructions:

```bash
abx template init ./python-hello --from python-hello
cd python-hello
abx deploy . --name hello --yes
python run.py --template TEMPLATE_ID
```

Source templates need the selected provider's build prerequisites. Deploy returns the prepared template resource ID; use it as TEMPLATE_ID. The template's run.py creates an instance and starts its service. Follow that template's README for Python SDK, application authentication and model setup.

Use `abx sandbox delete SANDBOX_ID --yes` for the runtime instance, then `abx delete hello --yes` for owned template resources; borrowed builds and images requiring manual cleanup are retained. Follow the [template guide](docs/en/guide/using-templates.md) for setup and resource cleanup.

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

## Community

Join the **Agent Sandbox 开发者工具交流群** on DingTalk to discuss usage and share feedback. [Join the group](https://qr.dingtalk.com/action/joingroup?code=v1,k1,LSusypYdoGm4U0xoz1p1QSlgoBHeoi/kgpsl4uQ8qus=&_dt_no_comment=1&origin=1) or search for group number **213605001586**.

Scan the QR code with DingTalk:

<a href="https://qr.dingtalk.com/action/joingroup?code=v1,k1,LSusypYdoGm4U0xoz1p1QSlgoBHeoi/kgpsl4uQ8qus=&amp;_dt_no_comment=1&amp;origin=1"><img src="assets/dingtalk-group.jpg" alt="DingTalk group QR code" width="235" /></a>

## Contributing

Development setup, checks and contribution workflow are in [CONTRIBUTING.md](.github/CONTRIBUTING.md). Report CLI problems through [Issues](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues).

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for attribution.

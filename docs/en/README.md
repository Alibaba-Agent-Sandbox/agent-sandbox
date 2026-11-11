# Agent Sandbox CLI — Documentation

`abx` authors templates, manages named deployments, runs sandbox operations through the selected Provider, and exposes sandbox tools to IDE agents through MCP. This page indexes the documentation of the CLI (`@agent-sandbox/cli`). The Python SDK is documented in the [`python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk); see [Related SDK documentation](#related-sdk-documentation).

## Sites

| Site | URL |
|---|---|
| Official site | https://www.agent-sandbox.cn |
| Provider registry | https://registry.agent-sandbox.cn |

The CLI installs catalog providers from `alibaba-agent-sandbox/awesome-providers//<id>`. The Python SDK installer fetches `https://registry.agent-sandbox.cn/providers/index.json`. `ABX_PROVIDER_REGISTRY` overrides that URL for the SDK installer.

---

## User Guides

### [`guide/`](guide/) — Tutorials & How-to Guides

| Guide | Description |
|-------|-------------|
| [Getting Started](guide/getting-started.md) | Install, configure, first sandbox |
| [Best Practices](guide/best-practices.md) | When to use `--provider`, `--model`, `llm_model`, credentials, and the standalone binary |
| [Operations](guide/operations.md) | Every command group and the one command for that job |
| [Binary Installation](guide/binary-installation.md) | Single-file `abx` binary (Node SEA), no Node.js required |
| [Providers](guide/providers.md) | Install, select, and configure sandbox providers |
| [Provider commands](guide/provider-commands.md) | Provider operation discovery, JSON inputs, configuration and native platform APIs |
| [Authoring Providers](guide/authoring-providers.md) | Write a `node` or EPP/1 `exec` provider plugin, including `[template]` and install-from-git |
| [Authentication](guide/authentication.md) | API Key / AK-SK authentication and `abx config` |
| [CLI Tutorial](guide/cli-tutorial.md) | CLI quick start |
| [Managed Applications](guide/managed-applications.md) | One stable Gateway, explicit deployment and session-owned Sandbox compute |
| [Using Templates](guide/using-templates.md) | Official and community templates |
| [Authoring Templates](guide/authoring-templates.md) | Custom templates, including `abx template init --adopt` for an existing project |
| [Deploy & Build](guide/deploy-and-build.md) | Template lifecycle (`template init` / `--adopt` → `template build` → `deploy`) |
| [E2E Template Workflow](guide/e2e-template-workflow.md) | Complete guide from building a template to using sandboxes |
| [MCP Integration](guide/mcp-integration.md) | Cursor / Claude Desktop / VS Code integration |
| [Environment Variables](guide/environment-variables.md) | Sandbox env var scopes, injection, and direct-exec semantics |
| [Troubleshooting](guide/troubleshooting.md) | Common issues and solutions |
| [Agent Skill Installation](guide/agent-skill-installation.md) | Install the static SKILL.md agent guide into Qoder / Claude Code / Cursor / Qwen Code / Codex |
| [Agents API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/agents-api.md) | Run Codex, Qwen Code, and later agent CLIs inside the sandbox. The server parses sessions, turns, and items |
| [Testing & Definition of Done](guide/testing-e2e.md) | Three verification layers (unit, differential, real-cloud E2E) and the Definition of Done |
| [Command and SDK map](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/command-map.md) | The responsibilities and corresponding entry points of `abx` and the Python SDK |

### [`reference/`](reference/) — CLI / Configuration Reference

| Document | Description |
|----------|-------------|
| [CLI Command Reference](reference/cli-commands.md) | Canonical command tree and command responsibilities |
| [CLI Reference](reference/cli-reference.md) | All CLI commands quick reference |
| [Configuration](reference/configuration.md) | CLI environment variables, config file, priority |
| [Engine HTTP API](reference/engine-api.md) | The local engine that gives every SDK the same providers: discovery file, token, routes, errors |
| [Error Codes](reference/error-codes.md) | E1xxx–E7xxx on this page. Provider errors E8001–E8030 are in the [Python SDK index](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/error-codes.md) |

## Design Documents

Read these when you are changing the CLI. Day-to-day use is in the guides above.

| # | Document | Description |
|---|----------|-------------|
| 1 | [CLI Architecture](design/architecture.md) | Layers, `src/` structure, command groups, output and exit codes, build / SEA binary / release, parity contract |
| 2 | [CLI Command System](design/cli-design.md) | Command tree, global options, authoring and deployment responsibilities |
| 3 | [MCP Server](design/mcp-server.md) | Local IDE tools, session ownership, STDIO/HTTP transport and editable MCP templates |
| 4 | [Templates Catalog](design/templates-catalog.md) | Official template catalog contract, publishing flow, offline validation, template command surface |
| 5 | [Template build modes](design/template-build-modes.md) | Manifest build modes, declared Dockerfile profiles, reusable artifacts and preparation deadlines |
| 6 | [Node provider architecture](design/node-provider-architecture.md) | Four provider kinds, the kit, in-process vs the engine vs exec, and why the engine is HTTP, SSE and WebSocket |

The consolidated index is [DESIGN.md](DESIGN.md). The historical provider/credential specification is [providers-and-credentials-cli.md](../design/providers-and-credentials-cli.md). Its historical Chinese copy is [providers-and-credentials-cli.md](../zh/design/providers-and-credentials-cli.md). Port rules are [PORTING.md](../PORTING.md).

## Project Planning

| Document | Description |
|----------|-------------|
| [Design Index](DESIGN.md) | Design topic index and implementation status |
| [Python to Node port](../PORTING.md) | Parity contract and test ledger |

---

## Quick Navigation

### By role

- **CLI user**: [Getting Started](guide/getting-started.md) → [Operations](guide/operations.md) → [Best Practices](guide/best-practices.md) → [CLI Tutorial](guide/cli-tutorial.md)
- **Template author**: [Authoring Templates](guide/authoring-templates.md) → [Deploy & Build](guide/deploy-and-build.md) → [E2E Template Workflow](guide/e2e-template-workflow.md)
- **AI Agent developer**: [Agents API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/agents-api.md) → [MCP Integration](guide/mcp-integration.md) → [MCP Server](design/mcp-server.md)
- **CLI contributor**: [CLI Architecture](design/architecture.md) → [Python to Node port](../PORTING.md)

### By feature

- **Natural-language template authoring**: [CLI Tutorial](guide/cli-tutorial.md)
- **Deploy a project**: [Deploy & Build](guide/deploy-and-build.md)
- **MCP integration (Cursor/Claude)**: [MCP Integration](guide/mcp-integration.md)

### Other resources

- **Template source of truth (awesome-templates):** [alibaba-agent-sandbox/awesome-templates](https://github.com/alibaba-agent-sandbox/awesome-templates) — the single source of truth for official & community template content, the index (`awesome-templates.yaml`), and publishing; consumed via `abx template list` / `abx template init --from`
- **中文文档**: [Chinese docs](../zh/README.md)

## Related SDK documentation

The Python SDK, the in-sandbox server SDK and the shared platform contracts are documented in the [`python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk):

- [Documentation index](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/README.md)
- [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md) and [SDK API Design](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/sdk-api-design.md)
- [Architecture](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/architecture.md) — the SDK's six-layer architecture
- [Template System](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/template-system.md) and [template.yaml Spec](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md)
- [Declarative Usage](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/declarative-usage.md), [Session Persistence](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/session-persistence.md), [Migrate from E2B](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/migrate-from-e2b.md)

The [CLI command reference](reference/cli-commands.md) describes the single current command surface. The [E2B migration guide](guide/migrate-from-e2b.md) explains how to move existing workflows to it.

- [Local conditional acceptance](guide/conditional-acceptance.md)

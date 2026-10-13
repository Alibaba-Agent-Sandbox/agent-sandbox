# Agent Sandbox CLI — Documentation

`abx` is the command-line client for the Agent Sandbox cloud sandbox service (Alibaba Cloud Function Compute): create and manage sandboxes, run code and commands, author and deploy templates, and expose sandboxes to IDE agents through an MCP server. This page indexes the documentation of the CLI (`@agent-sandbox/cli`). The Python SDK is documented in the [`python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk); see [Related SDK documentation](#related-sdk-documentation).

---

## Design Documents

| # | Document | Description |
|---|----------|-------------|
| 1 | [CLI Architecture](design/architecture.md) | Layers, `src/` structure, command groups, output and exit codes, build / SEA binary / release, parity contract |
| 2 | [CLI Command System](design/cli-design.md) | Command tree, global options, natural language creation, OutputManager, AI-friendly design |
| 3 | [MCP Server](design/mcp-server.md) | 7 P0 tools, session binding, STDIO and Streamable HTTP transports, IDE configuration, FC deployment |
| 4 | [Templates Catalog](design/templates-catalog.md) | Official template catalog contract, publishing flow, offline validation, template command surface |

The consolidated index is [DESIGN.md](DESIGN.md). English-only maintainer documents (port rules, repository layout, provider drafts) are listed there and live in [`docs/design/`](../design/) and [`docs/PORTING.md`](../PORTING.md).

## User Guides

### [`guide/`](guide/) — Tutorials & How-to Guides

| Guide | Description |
|-------|-------------|
| [Getting Started](guide/getting-started.md) | Install, configure, first sandbox |
| [Best Practices](guide/best-practices.md) | When to use `--provider`, `--model`, `llm_model`, credentials, and the standalone binary |
| [Operations](guide/operations.md) | Every command group and the one command for that job |
| [Binary Installation](guide/binary-installation.md) | Single-file `abx` binary (Node SEA), no Node.js required |
| [Providers](guide/providers.md) | Install, select, and configure sandbox providers |
| [Authoring Providers](guide/authoring-providers.md) | Write an EPP/1 provider plugin, including `[template]` and install-from-git |
| [Authentication](guide/authentication.md) | API Key / AK-SK authentication and `abx config` |
| [CLI Tutorial](guide/cli-tutorial.md) | CLI quick start |
| [Using Templates](guide/using-templates.md) | Official and community templates |
| [Authoring Templates](guide/authoring-templates.md) | Custom templates, including `abx template init --adopt` for an existing project |
| [Deploy & Build](guide/deploy-and-build.md) | Template lifecycle (`template init` / `--adopt` → `deploy` → `create`) |
| [E2E Template Workflow](guide/e2e-template-workflow.md) | Complete guide from building a template to using sandboxes |
| [MCP Integration](guide/mcp-integration.md) | Cursor / Claude Desktop / VS Code integration |
| [Environment Variables](guide/environment-variables.md) | Sandbox env var scopes, injection, and direct-exec semantics |
| [Troubleshooting](guide/troubleshooting.md) | Common issues and solutions |
| [Agent Skill Installation](guide/agent-skill-installation.md) | Install the static SKILL.md agent guide into Qoder / Claude Code / Cursor / Qwen Code / Codex |
| [Agents API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/agents-api.md) | Run Codex, Qwen Code, and later agent CLIs inside the sandbox. The server parses sessions, turns, and items |
| [Testing & Definition of Done](guide/testing-e2e.md) | Three verification layers (unit, differential, real-cloud E2E) and the Definition of Done |
| [Command and SDK map](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/command-map.md) | `abx` and the Python SDK next to the E2B and OpenSandbox commands and methods |

### [`reference/`](reference/) — CLI / Configuration Reference

| Document | Description |
|----------|-------------|
| [CLI Command Reference](reference/cli-commands.md) | Canonical command tree, the fixed top-level shortcuts, removed spellings |
| [CLI Reference](reference/cli-reference.md) | All CLI commands quick reference |
| [Configuration](reference/configuration.md) | CLI environment variables, config file, priority |
| [Error Codes](reference/error-codes.md) | E1xxx–E6xxx error codes and CLI exit codes |

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

- **Natural language sandbox creation**: [CLI](design/cli-design.md#3-natural-language-creation-ai-template-generation)
- **Deploy a project**: [CLI deploy command](design/cli-design.md#abx-deploy) (`abx deploy` is a fixed build + push + create-template pipeline; templates are authored with `abx template init` — scaffold, one-sentence description, or `--adopt`)
- **MCP integration (Cursor/Claude)**: [MCP Server](design/mcp-server.md#5-installation-and-cli)

### Other resources

- **Template source of truth (awesome-templates):** [alibaba-agent-sandbox/awesome-templates](https://github.com/alibaba-agent-sandbox/awesome-templates) — the single source of truth for official & community template content, the index (`awesome-templates.yaml`), and publishing; consumed via `abx template search` / `abx template install`
- **中文文档**: [Chinese docs](../zh/README.md)

## Related SDK documentation

The Python SDK, the in-sandbox server SDK and the shared platform contracts are documented in the [`python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk):

- [Documentation index](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/README.md)
- [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md) and [SDK API Design](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/sdk-api-design.md)
- [Architecture](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/architecture.md) — the SDK's six-layer architecture
- [Template System](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/template-system.md) and [template.yaml Spec](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md)
- [Declarative Usage](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/declarative-usage.md), [Session Persistence](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/session-persistence.md), [Migrate from E2B](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/migrate-from-e2b.md)

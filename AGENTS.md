# AGENTS.md — AI Contributor Entry Point

> **For AI coding assistants** (Cursor, Copilot, Codex, Qoder, etc.).
> Human contributors: see [CONTRIBUTING.md](.github/CONTRIBUTING.md).

## Project Overview

**Easy Sandbox** (`@easy-sandbox/cli` on npm, CLI command `ebx`) is the CLI for the Alibaba Cloud FC Agent Sandbox service. It is **E2B-protocol compatible** with extensions for the Alibaba Cloud ecosystem (OSS, VPC, custom domains). The Python SDK (`easy-sandbox` on PyPI) and the in-sandbox runtime (`easy-sandbox-server`) live in the `python-sdk` repository.

- **Language:** TypeScript (strict, ESM), Node.js >= 20
- **Build system:** `tsc` (`npm run build`); standalone binaries via esbuild bundle + Node SEA (`scripts/build_binary.mjs`)
- **Package:** `src/`
- **Entry point:** `ebx` → `src/bin/ebx.ts` (built to `dist/bin/ebx.js`)

---

## Directory Structure

```
easy-sandbox/
├── src/                       # CLI source (TypeScript, ESM)
│   ├── models/                # Data models: config, errors, sandbox, template, session, filesystem, process
│   ├── transport/             # HTTP/WS transport, auth, codec, retry, streaming
│   ├── protocol/              # Protocol abstractions: sandbox, filesystem, process, terminal, port, code_interpreter
│   ├── api/                   # High-level API: Sandbox, files, code, commands, network, image, capability, session_manager, template
│   ├── cli/                   # `ebx` CLI: main, output/formatters, command modules
│   │   └── commands/          # Subcommands: config_cmd, deploy, mcp, sandbox, sandbox_files, sandbox_process, sandbox_system, template
│   ├── framework/             # Mini click-compatible command framework (groups, options, help rendering, lazy subcommands)
│   ├── agent/                 # AI agent tooling: MCP server, tool definitions, template authoring/adoption
│   ├── session/               # Session persistence: local (LocalSessionStore)
│   ├── utils/                 # Async bridge, secret store, logging, registry, retry
│   └── bin/                   # `ebx.ts` executable entry point
├── tests/                     # Mirrors src/ structure (test_api/, test_cli/, test_models/, …); vitest
├── parity/                    # Python-test ledger used by `npm run parity:coverage`
├── docs/
│   ├── PORTING.md             # Porting contract: Python `ebx` -> Node.js `ebx`
│   ├── en/
│   │   ├── design/            # CLI design documents (English): architecture, cli-design, mcp-server, templates-catalog
│   │   ├── guide/             # User tutorials & how-to guides
│   │   ├── reference/         # CLI/error-code/config reference
│   │   └── DESIGN.md          # Design topic index (links to design/)
│   ├── design/                # English-only maintainer drafts (repository layout, provider specs, fixtures)
│   └── zh/
│       ├── design/            # CLI design documents (Chinese mirror)
│       ├── guide/             # User tutorials & how-to guides
│       ├── reference/         # CLI/error-code/config reference
│       └── DESIGN.md          # Design topic index (links to design/)
├── scripts/                   # Utility scripts (binary build, template deploy helpers, parity coverage)
├── benchmarks/                # Performance benchmarks (CLI startup)
└── package.json               # Build config, dependencies, npm scripts
```

The SDK-only modules (`compat/`, `declarative/`, `extensions/`, `integrations/`, `server/`), `examples/` and the SDK/API docs live in the `python-sdk` repository. This repository keeps its own `.agents/` (ADRs in `notes/`, golden-file `evidence/`, design notes).

---

## Architecture Layers

The CLI follows a strict layered structure — **lower layers never import upper layers**. The full description (layer table, source directories, command groups, build and release, parity contract) is [`docs/en/design/architecture.md`](docs/en/design/architecture.md) ([中文](docs/zh/design/architecture.md)).

```mermaid
graph TB
    BIN["bin — ebx entry"]
    subgraph Front["Command line"]
        FW["framework — click-compatible command framework"]
        CLI["cli — main, OutputManager, formatters"]
        CMD["cli/commands — command groups"]
    end
    subgraph Services["Host-side services"]
        AG["agent — MCP server, template authoring"]
        SES["session — LocalSessionStore"]
    end
    subgraph Core["Client core"]
        API["api — Sandbox, files, code, commands, template"]
        PRO["protocol"]
        TRA["transport — HTTP, WebSocket, auth"]
        MOD["models + utils"]
    end
    BIN --> CLI --> FW
    CLI --> CMD
    CMD --> AG
    CMD --> SES
    CMD --> API
    AG --> API
    SES --> API
    API --> PRO --> TRA --> MOD
```

The client core mirrors the Python SDK's layers one-to-one; the SDK's own architecture (Compat, Declarative, Extensions, Integrations and Server layers) is documented in the [`python-sdk` repository](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/design/architecture.md).

---

## Development Commands

### Setup

```bash
# Install dependencies (Node.js >= 20)
npm ci

# Run the CLI from source
npm run dev -- --help        # tsx src/bin/ebx.ts --help
```

### Day-to-Day

| Command                           | What it does                                                                 |
|-----------------------------------|------------------------------------------------------------------------------|
| `make test` / `npm test`          | `vitest run` (integration tests excluded)                                    |
| `make lint`                       | Static check of `src/` and `tests/` (alias of `make typecheck`; no separate linter) |
| `make typecheck` / `npm run typecheck` | `tsc -p tsconfig.json --noEmit` (strict)                                |
| `make build` / `npm run build`    | `tsc -p tsconfig.build.json` (emits `dist/`)                                 |
| `make binary`                     | `node scripts/build_binary.mjs` — standalone binary for the current platform |
| `npm run parity:coverage`         | Run vitest and report Python-ledger tests without a Node counterpart         |
| `npm run test:integration`        | `vitest run tests/integration`                                               |
| `make clean`                      | Remove build artifacts (`dist/`, `build/`)                                   |

### Running a Specific Test

```bash
npx vitest run tests/test_api/test_sandbox.test.ts
npx vitest run -t "test_capability"
```

---

## Key Conventions

### Error Code System

All SDK errors live in [`models/errors.ts`](src/models/errors.ts). Error codes follow `E{category}{sequence}`:

| Range   | Category       | Base Class               |
|---------|----------------|--------------------------|
| E1xxx   | Authentication | `AuthenticationError`    |
| E2xxx   | Creation       | `SandboxCreationError`   |
| E3xxx   | Execution      | `ExecutionError`         |
| E4xxx   | Filesystem     | `FileOperationError`     |
| E5xxx   | Network        | `NetworkError`           |
| E6xxx   | Session        | `SessionError`           |
| E70xx   | Deploy/Build   | `SandboxError` (`DeployError` covers E7000–E7003; E7010–E7011 inherit `SandboxError` directly) |
| E702x   | Docker/ACR     | `SandboxError` (E7020–E7022 inherit it directly) |

Every exception carries: `code`, `message`, `suggestion`, `docs_url` (populated when documentation is available).

### Capability Model

Defined in [`models/template.ts`](src/models/template.ts), resolved by [`api/capability.ts`](src/api/capability.ts).

- **`STANDARD_CAPABILITIES`** = `{shell, files, code, terminal, ports}` — all recognised tokens
- **`DEFAULT_CAPABILITIES`** = `{shell, files, code}` — applied when a template declares nothing
- `terminal` and `ports` **must** be declared explicitly in the template's `template.yaml`
- **Capability declaration:** capabilities are declared in `template.yaml` and resolved by `resolveCapabilities()` (fail-closed). All API methods are callable; capability tokens are used at template resolution / model validation layer only
- **Fail-closed:** if a matched template's YAML is malformed, the resolver raises `TemplateParseError` (E2004) rather than silently falling back to defaults

### Capability Resolution Priority

1. Explicit `local_yaml_path` (programmatic override)
2. Local template cache scan (`~/.ebx/templates/`)
3. *(Phase 2, TODO)* Online fallback — `GET /templates/{id}`
4. Fall back to `DEFAULT_CAPABILITIES` + warning

### CLI Command Resolution Priority

When `ebx create` resolves a template:
- Programmatic specification → local project `template.yaml` → installed template cache → *(Phase 2)* online registry → `DEFAULT`

### Template Definition

Templates use `template.yaml` (not `manifest.yaml` for capability purposes). Key fields: `name`, `capabilities`, `custom_commands`, `alias`/`aliases`.

---

## Testing Conventions

### Standard Tests

- Framework: **vitest** (async tests are plain `async` functions)
- Structure mirrors `src/`: `tests/test_api/`, `tests/test_cli/`, `tests/test_models/`, etc.
- Integration tests live in `tests/integration/` — `npm test` skips them; run them with `npm run test:integration`
- Type checking enforced: `tsc --noEmit` with `strict: true`

### Golden-File CLI Evidence

The original auto-generated golden-file set (every CLI command's input→output behaviour) lives in [`.agents/evidence/cli/`](.agents/evidence/cli/); the Node snapshot tests compare against it under `tests/test_cli_evidence/golden/` as the port lands (see [`docs/PORTING.md`](docs/PORTING.md)).

**Regenerate:**
```bash
# Update golden files when tests use snapshot comparison
EBX_UPDATE_EVIDENCE=1 npm test
```

The offline/live evidence *capture* script lives in this repository as `scripts/capture-cli-evidence.mjs` (`--live`, `--command <group>`, `--out <dir>`; see [`tests/test_cli_evidence/README.md`](tests/test_cli_evidence/README.md)). It replaced the Python `scripts/capture_cli_evidence.py` driver and writes the Markdown evidence under `.agents/evidence/cli/`. Snapshot tests still compare against `tests/test_cli_evidence/golden/`.

---

## Contributing References

| Resource                | Path                                                                 |
|-------------------------|----------------------------------------------------------------------|
| Contributing guide      | [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md)                 |
| PR template             | [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) |
| Security policy         | [`.github/SECURITY.md`](.github/SECURITY.md)                        |
| Architecture decisions  | [`.agents/notes/`](.agents/notes/README.md) (this repository's ADRs) |
| CLI architecture        | [`docs/en/design/architecture.md`](docs/en/design/architecture.md)  |
| Design documents (EN) | [`docs/en/design/`](docs/en/design/)                                |
| Design documents (ZH) | [`docs/zh/design/`](docs/zh/design/)                                |
| Design index (EN)     | [`docs/en/DESIGN.md`](docs/en/DESIGN.md)                            |
| Design index (ZH)     | [`docs/zh/DESIGN.md`](docs/zh/DESIGN.md)                            |
| CLI evidence            | [`.agents/evidence/`](.agents/evidence/README.md) (golden files) |
| SDK documentation       | [`python-sdk` docs](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/README.md) (SDK, server SDK, `template.yaml` contract) |
| Changelog               | [`CHANGELOG.md`](CHANGELOG.md)                                      |

### ADR System (`.agents/notes/`)

Architecture Decision Records (this repository; the SDK repository keeps its own) follow a `proposed → implemented | rejected` lifecycle:

```
.agents/notes/
├── proposed/          # Under review
│   ├── architecture/
│   ├── feature/
│   └── process/
├── implemented/       # Accepted and active
│   ├── architecture/
│   ├── feature/
│   └── process/
└── rejected/          # Considered but not adopted (flat directory, no subdirectories)
    ├── .gitkeep
    └── *.md
```

See [`.agents/notes/README.md`](.agents/notes/README.md) for the full template and process.

---

## AI Assistant Guardrails

**MUST follow:**

1. **Never auto-commit.** Make changes; let the human review and commit.
2. **Never delete golden files** in `tests/test_cli_evidence/golden/`. If CLI output changes, regenerate them via `EBX_UPDATE_EVIDENCE=1 npm test`.
3. **After modifying any CLI command**, regenerate the affected evidence files and verify they look correct.
4. **Respect template capability declarations.** If `resolveCapabilities()` fails or a capability is missing, the fix is to declare it in the template YAML — not to bypass the resolution.
5. **Never fabricate FC/envd API endpoints.** If you're unsure about a real backend API, flag it as a TODO rather than inventing a placeholder.
6. **Run the full test suite** (`make test && make lint && make typecheck`) before claiming a task is done.
7. **Secret scanning** is enforced via `.githooks/check-secrets.sh`. Never commit API keys, tokens, or passwords. Use `REPLACE_ME` or `placeholder` for examples.
8. **Conventional Commits** for all commit messages: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `perf:`.
9. **Minimize changes.** Touch only the files necessary for the task. Don't refactor unrelated code.
10. **Type annotations** on all public APIs (explicit parameter and return types). TSDoc comments.
11. **Layer dependency constraint.** Lower layers must never import upper layers (L0 must not import L1+, L1 must not import L2+, etc.). If you need a type from a higher layer, refactor it downward or use dependency injection.
12. **Maintain module exports.** When adding or removing any public symbol that a package re-exports (its `index.ts`, if present), update the export list to match.
13. **Wire-name alias convention.** Model fields that map to camelCase API responses are exposed under their snake_case names (`sandbox_id`, `exit_code`, …, as in the Python models), and parsing accepts both the camelCase wire alias and the snake_case name. See [`docs/PORTING.md`](docs/PORTING.md).

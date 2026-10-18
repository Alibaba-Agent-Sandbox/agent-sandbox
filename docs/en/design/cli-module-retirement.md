# CLI module retirement

The npm package provides the `abx` executable. Its internal `dist/` modules are
not a separate Node SDK API. The Node HTTP SDK lives in
https://github.com/alibaba-agent-sandbox/nodejs-sdk; the Python SDK lives in
https://github.com/alibaba-agent-sandbox/python-sdk.

The following unused Python-port implementations are removed from the CLI. This
is a compatibility change for consumers that directly import those internal
paths; migrate before updating. No CLI command is removed by this cleanup.

| Retired source | Supported replacement / ownership |
|---|---|
| `api/image.ts`, `api/template.ts` | Dockerfile and `template.yaml` with `abx template build`, `push`, `create` or `deploy`; current DockerBuilder and official FC template adapter remain |
| `api/session_manager.ts`, `session/local.ts`, `models/session.ts` | Python SDK named session persistence; CLI interactive `abx connect` remains |
| `models/config.ts` | CLI layered configuration in `transport/config.ts` and `abx config` |
| `utils/keychain.ts` | CLI credential configuration; this unused SecretStore was not part of command credential resolution |
| `utils/retry.ts` | No automatic retry replacement; retries require operation-specific safety |
| `protocol/port.ts` | Active `api/network.ts` / provider URL methods used by CLI sandbox ports |
| `TemplateProtocol.create(dockerfile)` | Deprecated metadata-only `POST /templates` removed; current image build v3/v2 and official template APIs remain |

Reachability was checked from the executable with both the TypeScript import
graph (including type imports and literal dynamic imports) and the bundle graph.
The independent MCP executable `agent/mcp_main.ts` remains; barrels alone are
not evidence of an executable consumer. Active underscore compatibility helpers
remain. Existing feature PRs must be checked when rebasing across this removal.

Only tests dedicated to the removed implementations are retired. The original
CLI parity ledger, golden snapshots and historical evidence are retained. A
smaller test count here is removed implementation coverage, not a new passing
result for the deleted tests. New validation is recorded in the
[owner note](../../../.agents/notes/proposed/architecture/2026-10-18-retire-orphan-cli.md).

[中文](../../zh/design/cli-module-retirement.md)

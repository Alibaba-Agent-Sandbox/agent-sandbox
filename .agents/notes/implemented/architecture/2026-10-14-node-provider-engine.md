# Decision: one Node provider host, shared through a local HTTP engine

Status: implemented
Implemented: 2026-10-14

## Problem

Each sandbox backend had to be written again for every language. The CLI already hosts the provider layer in TypeScript (`cli/src/providers`). The Python SDK had its own copies, and later Node, Go and Java SDKs would have needed yet another copy. A default provider must still work from Python without a Node process. Third-party plugins written in any language must still be able to plug in.

## Decision

One provider implementation is reused by the CLI, the Python SDK, and later Node, Go and Java SDKs. The language is Node/TypeScript. The existing host in `cli/src/providers` is reused (5560 lines of TypeScript across the `.ts` files in that directory). No off-the-shelf package replaces that host: the manifest, installer, trust, config, feature-gate and envd stack stay in-tree. `cli/package.json` depends on `ws` (already used by the engine WebSocket server in `cli/src/engine/server.ts`). The packages considered and not adopted are `e2b`, `@alibaba-group/opensandbox`, `@connectrpc/*`, `vscode-jsonrpc`, `@grpc/grpc-js`, `fastify` and `hono`.

### Provider kinds

`cli/src/providers/manifest.ts` and `python-sdk/client-sdk/src/agent_sandbox/providers/manifest.py` accept three manifest kinds. The protocol map is `exec` = `epp/1`, `rest` = `e2b-rest/1`, `node` = `node/1`.

- **builtin.** `alicloud-express` stays a class in each language: `cli/src/providers/builtin.ts` (`AlicloudExpressProvider`, `kind = "builtin"`) and `python-sdk/client-sdk/src/agent_sandbox/providers/builtin.py`. The Python default resolves to that class (`registry.get_provider` returns `builtin_provider()` for the built-in id) and does not start Node.
- **rest.** `e2b-rest/1` is a manifest-only endpoint preset. `cli/src/providers/rest_provider.ts` (`RestProvider`) builds the protocol objects from the manifest. There is no plugin module.
- **exec.** `epp/1` is JSON-RPC 2.0 over stdio (NDJSON). `cli/src/providers/epp.ts` (`PROTOCOL = "epp/1"`) is the host client; `cli/src/providers/exec_provider.ts` adapts it. This kind stays for third-party plugins in any language. The `pty.*` extension is `pty.open`, `pty.write`, `pty.resize`, `pty.close`, with `pty.output` and `pty.exit` notifications (`ExecTerminal` in `exec_provider.ts`).
- **node.** `node/1` is an ES module (`provider.mjs`) loaded in the host process. The module `export default create(kit)` and the returned object implements `buildInfra(ctx)`. `cli/src/providers/node_provider.ts` (`NodeProvider`) imports it and calls `buildInfra`. All four catalog providers are `node`: `awesome-providers/opensandbox`, `awesome-providers/e2b`, `awesome-providers/cubesandbox` and `awesome-providers/alicloud-container` (`[runtime] kind = "node"`, `[compat] protocol = "node/1"`, `entry = "provider.mjs"`). OpenSandbox runs its EPP/1 methods in the host process through `kit.epp.infra` (`awesome-providers/opensandbox/provider.mjs`, `cli/src/providers/node_epp.ts`). `node provider.mjs` still serves EPP/1 on stdio: `main()` calls `serve` on stdin/stdout when the file is the process entry.

Manifest `runtime.kind = "python"` is rejected. The Python parser says that kind is no longer supported and the provider should be written as `node` or `exec` (`providers/manifest.py`). The CLI parser still answers that a `python` manifest is loaded by the Python SDK (`providers/manifest.ts`). In-code `Provider` subclasses still work: `Provider.kind` defaults to `"python"` in both `cli/src/providers/base.ts` and `python-sdk/client-sdk/src/agent_sandbox/providers/base.py`, and the registries still accept a programmatically registered `Provider`.

### Kit

`providerKit()` in `cli/src/providers/node_provider.ts` is what `create(kit)` receives:

- `SandboxProtocol`, `ProcessProtocol`, `FilesystemProtocol`, `CodeInterpreterProtocol`
- `errors`: `InvalidAPIKeyError`, `ProviderConfigError`, `ProviderFeatureNotSupportedError`
- `hostVersion` (`cli/src/providers/host.ts`)
- `e2b`: `resumeConnect`, `withDefault`, `overlay`, `parseExecution`
- `epp.infra`: `eppInfra(ctx, factory)` in `cli/src/providers/node_epp.ts`, which runs an EPP/1 dispatcher in-process and returns the exec adapters

Host options on the infra the plugin returns, and on the HTTP constructor the context passes in:

- `envd_dial`: `[host, port] | null`, forwarded to `HttpClient` (`node_provider.ts` `HttpOptions`, `cli/src/transport/http.ts`)
- `envd_auth`: `{ allow_missing?, basic_user? }`, stored on `ProviderInfra` and read by `EnvdTokenManager` (`cli/src/providers/base.ts`, `cli/src/transport/auth.ts`)

`awesome-providers/cubesandbox/provider.mjs` sets both (`envd_dial` from the `proxy` option, `envd_auth: { allow_missing: true, basic_user: "root" }`) and also calls `e2b.resumeConnect`, `e2b.overlay`, `e2b.parseExecution` and `e2b.withDefault`. `awesome-providers/e2b/provider.mjs` builds the four protocol objects from the kit and calls `e2b.resumeConnect`. `awesome-providers/alicloud-container/provider.mjs` does the same and also calls `e2b.overlay` and `e2b.parseExecution`.

### Engine `abx-engine/1`

`cli/src/engine/server.ts` and `cli/src/engine/discovery.ts` are a Node process on `127.0.0.1` only. The protocol id is `abx-engine/1`. The data plane is HTTP/JSON, SSE (`text/event-stream` for command streams and file watch) and WebSocket (upgrade of `GET /v1/sandboxes/:id/terminal`, via the `ws` package). A bearer token is written to `~/.abx/engine.json` with mode `0600`, next to `~/.abx/engine.lock` (also `0600`). Each request carries the connection in `X-Abx-Connection` (base64url JSON: provider, options, credentials). Sessions are keyed by a connection fingerprint (first 16 hex chars of the SHA-256 of the stable connection JSON) plus the sandbox id. The idle exit default is 900 seconds. The unused-session TTL default is 600 seconds. Both are the defaults of `startEngine` and of `abx provider engine serve` (`cli/src/cli/commands/provider_engine.ts`).

Error bodies are `{ error: { type, code, message, suggestion } }`. A `SandboxError` also includes `docs_url` (`errorBody` in `server.ts`).

`abx provider engine serve|status|stop` starts, inspects and stops the process. SDKs start it on demand. `serve` exits 0 immediately when `engine.lock` is already held by a live process.

The Python SDK reaches only `node`-kind providers through this engine. `python-sdk/client-sdk/src/agent_sandbox/providers/registry.py` builds an `EngineProvider` for `manifest.kind == "node"`, a `RestProvider` for `rest`, and an `ExecProvider` otherwise. `EngineProvider` (`engine_provider.py`) speaks `engine_client.py`. Sandbox URLs for that path are the marker `engine://{provider}/{id}` (`_SCHEME = "engine://"`). `engine_client.discover` keeps one `asyncio.Lock` per running event loop (`_start_locks`, a `WeakKeyDictionary`). `EngineClient.request` tries the call twice: a dead connection or an HTTP 401 drops the cached record and discovers again, so a call continues after the engine restarts.

### Why the SDK transport is not gRPC

The data-plane protocols are HTTP, SSE and WebSocket. Every target language already speaks those, so a plain HTTP/JSON + SSE + WebSocket engine needs no per-language codegen, and terminals and streams map onto WebSocket and SSE directly.

An earlier Python gRPC engine is still in the tree: `python-sdk/client-sdk/src/agent_sandbox/engine/` (`server.py`, `client.py`, `engine.proto`, package `agent_sandbox.engine`, protocol `abx.engine.v1`, Unix socket `~/.abx/engine.sock`). Its tests under `python-sdk/client-sdk/tests/test_engine/` still pass. It serves the built-in `alicloud-express` path (`Sandbox.create` in `python-sdk/client-sdk/src/agent_sandbox/api/sandbox.py` calls `agent_sandbox.engine.client.Engine`). It is superseded for catalog providers, which use `abx-engine/1`.

## API Design

```ts
// cli/src/providers/node_provider.ts
export interface ProviderKit {
  hostVersion: string;
  SandboxProtocol: typeof SandboxProtocol;
  ProcessProtocol: typeof ProcessProtocol;
  FilesystemProtocol: typeof FilesystemProtocol;
  CodeInterpreterProtocol: typeof CodeInterpreterProtocol;
  errors: {
    InvalidAPIKeyError: typeof InvalidAPIKeyError;
    ProviderConfigError: typeof ProviderConfigError;
    ProviderFeatureNotSupportedError: typeof ProviderFeatureNotSupportedError;
  };
  e2b: {
    resumeConnect<T extends SandboxProtocol>(inner: T, paths?: readonly string[]): T;
    withDefault<T extends object>(inner: T, option: string, value: string, methods: readonly string[]): T;
    overlay<T extends object, O extends object>(inner: T, overrides: O): T & O;
    parseExecution(raw: string): { stdout: string; stderr: string; text: string; exitCode: number };
  };
  epp: { infra(ctx: NodeContext, factory: EppFactory): Promise<NodeInfra> };
}

export interface NodePlugin {
  buildInfra(ctx: NodeContext): Promise<NodeInfra>;
}
// A plugin module: export default function create(kit: ProviderKit): NodePlugin
```

```python
# python-sdk/client-sdk/src/agent_sandbox/providers/engine_provider.py
class EngineProvider(Provider):
    kind = "node"
    def connection(self, config: TransportConfig) -> dict[str, Any]: ...
    async def build_infra(self, config: TransportConfig) -> ProviderInfra: ...

# engine://{provider_id}/{sandbox_id}  — envd_url marker, not a dial address
```

`abx provider engine serve` (`--idle-timeout` default 900, `--port` default 0) writes `EngineRecord` `{ protocol, pid, host, port, token, version, started_at }` to `~/.abx/engine.json`. Clients send `Authorization: Bearer <token>` and `X-Abx-Connection: <base64url JSON>`. Routes live in `Engine.defineRoutes` (`cli/src/engine/server.ts`): `GET /v1/health`, `POST /v1/shutdown`, sandbox lifecycle, commands, processes, files, code, and the terminal WebSocket.

## Alternatives considered

- **A new provider implementation per SDK language.** Rejected. The host layer (manifest, installer, trust, config, feature-gate, envd) is already the TypeScript tree in `cli/src/providers`, and copying it again is the problem this decision closes.
- **Replace that host with an off-the-shelf package** (`e2b`, `@alibaba-group/opensandbox`, `@connectrpc/*`, `vscode-jsonrpc`, `@grpc/grpc-js`, `fastify`, `hono`). Rejected. None of them is the manifest/installer/trust/config/feature-gate/envd stack. `ws` is the only one of that list adopted, and it was already a dependency.
- **gRPC as the SDK-to-engine transport, including extending `agent_sandbox.engine`.** Rejected for catalog providers. HTTP, SSE and WebSocket are native in every target language, so the engine needs no per-language codegen, and a terminal or a byte stream is a WebSocket or an SSE response. The Python gRPC engine remains the built-in `alicloud-express` path only.
- **Move `alicloud-express` onto the Node engine.** Rejected for this decision. The default provider must run from Python with no Node process. See Consequences.
- **Drop `exec` / EPP/1.** Rejected. Third-party plugins in any language still speak `epp/1` on stdio, including `pty.*`.

## Dependencies

- Node host: `cli/src/providers/*` (`node_provider.ts`, `node_epp.ts`, `exec_provider.ts`, `epp.ts`, `manifest.ts`, `registry.ts`, `rest_provider.ts`, `builtin.ts`, `base.ts`), `cli/src/engine/server.ts`, `cli/src/engine/discovery.ts`, `cli/src/cli/commands/provider_engine.ts`.
- npm dependency used by the engine: `ws` (WebSocket server). No new package was added for the plugin host.
- Catalog modules: `awesome-providers/{opensandbox,e2b,cubesandbox,alicloud-container}/provider.mjs` and the matching `abx-provider.toml`.
- Python client of the engine: `python-sdk/client-sdk/src/agent_sandbox/providers/engine_client.py`, `engine_provider.py`, `registry.py`.
- Superseded for catalog providers, still used by built-in `alicloud-express`: `python-sdk/client-sdk/src/agent_sandbox/engine/` (`engine.proto`, Unix socket).

## Test Strategy

Unit and contract tests on the TypeScript host, the Python provider and engine suites, and the OpenSandbox plugin's own runner. Live checks are limited to a local OpenSandbox 1.1.1. The other three catalog providers are checked against the offline E2B-shaped mock. The recorded run is [`2026-10-14-node-providers-engine`](../../../evidence/verify/2026-10-14-node-providers-engine.md).

## Acceptance criteria

- A `node/1` module `export default create(kit)` with `buildInfra(ctx)` loads in the CLI through `NodeProvider` and in Python through `EngineProvider` and `abx-engine/1`.
- The four catalog providers (`opensandbox`, `e2b`, `cubesandbox`, `alicloud-container`) are `runtime.kind = "node"`.
- OpenSandbox's EPP/1 methods run in-process via `kit.epp.infra`, and `node provider.mjs` still speaks EPP/1 on stdio.
- `exec` (`epp/1`, including `pty.*`) and `rest` (`e2b-rest/1`, manifest only) still load. Manifest `runtime.kind = "python"` is rejected. An in-code `Provider` subclass still registers.
- Python's default `alicloud-express` does not require Node. Python reaches `node`-kind providers only through the engine (`engine://{provider}/{id}`), with a per-loop start lock and one retry after the engine restarts.
- The engine listens on `127.0.0.1`, publishes a `0600` `~/.abx/engine.json` and `engine.lock`, keys sessions by connection fingerprint plus sandbox id, and uses the 900 s idle / 600 s session TTL defaults.

## Consequences

### What is deliberately not done

- `alicloud-express` is not moved onto `abx-engine/1`. TypeScript and Python each keep their own built-in class. The Python gRPC engine (`agent_sandbox.engine`, `~/.abx/engine.sock`) still serves that built-in path.
- The `exec` kind stays, including the `pty.*` extension, so a plugin in any language can still speak EPP/1 on stdio.
- There is no Node SDK yet. `provider_engine.ts` names Node, Go and Java as later clients of the same engine. This tree has no Node SDK package.
- OpenSandbox `pty` needs the global `WebSocket` constructor, which Node provides from version 22. `awesome-providers/opensandbox/src/pty.mjs` (`hasWebSocket`) omits the `pty` feature when `globalThis.WebSocket` is not a function, so Node 20 and 21 do not advertise `pty`.

## Evidence

- [`2026-10-14-node-providers-engine`](../../../evidence/verify/2026-10-14-node-providers-engine.md)

# Engine HTTP API (`abx-engine/1`)

The engine is a local process that hosts the provider layer once, so the CLI and every SDK (Python today; Node, Go and Java later) call the same provider code. It is the Node.js CLI running `abx provider engine serve`. An SDK that finds no engine starts one and talks to it over loopback HTTP, SSE and WebSocket. Nothing in this API needs gRPC or a code generator: any language with an HTTP client can use it.

Official site: <https://www.agent-sandbox.com>. Registry website: <https://registry.agent-sandbox.com>. Catalog installs fetch `https://registry.agent-sandbox.cn/providers/index.json`.

## Start, find and stop

```bash
abx provider engine serve [--idle-timeout 900] [--port 0]   # foreground; SDKs start it detached
abx provider engine status                                   # exit 1 when none is running
abx provider engine stop
```

A running engine writes `~/.abx/engine.json` (mode 0600) and holds `~/.abx/engine.lock`, so concurrent starts leave one engine:

```json
{ "protocol": "abx-engine/1", "pid": 4242, "host": "127.0.0.1", "port": 51234, "token": "…", "version": "0.3.0", "started_at": "2026-10-14T12:00:00Z" }
```

- The engine listens on `127.0.0.1` only. A request whose `Host` is not loopback, or that carries an `Origin` header (a browser page), is refused.
- Every request sends `Authorization: Bearer <token>`. WebSocket upgrades use the same header.
- It exits after `--idle-timeout` seconds without requests (default 900). Sessions idle for 600 s are closed. A client that gets a connection error, or a 401 after a restart, reads `engine.json` again and starts a new engine.
- The log is `~/.abx/engine.log`. An SDK launches the CLI named by `ABX_BIN` (a command line) or `abx` on `PATH`.

## The connection

The engine keeps no account of its own. Each request carries the connection the client resolved (its own config, env and `.env` layers):

```json
{ "provider": "e2b", "provider_options": { "base_url": "…" }, "api_key": "…", "api_url": "…", "domain": "…", "access_key_id": "…", "access_key_secret": "…" }
```

Send it as the header `X-Abx-Connection` (base64url of the JSON, no padding) or, on `POST` bodies, as the same fields. Sessions are keyed by a fingerprint of the connection plus the sandbox id, so two accounts never share a session. A session that the backend no longer knows is rebuilt through `connect` once.

## Routes

All paths start with `/v1`. Bodies are JSON unless noted. `:id` is the provider's sandbox id.

| Method and path | Purpose |
|---|---|
| `GET /health` | `{protocol, version, pid, uptime_s, sessions}` |
| `POST /shutdown` | stop the engine |
| `GET /providers` | installed providers: id, name, version, kind, trust, features, error |
| `POST /sandboxes` | create (`template`, `timeout`, `envs`, `metadata`, `cpu`, `memory`, `disk`, `gpu`, `secure`, …); `201` with the sandbox record |
| `GET /sandboxes?status=&limit=&offset=` | list: `{sandboxes: […]}` |
| `POST /sandboxes/:id/connect` | attach to an existing sandbox |
| `GET /sandboxes/:id` · `DELETE /sandboxes/:id` | info · kill |
| `GET /sandboxes/:id/running` | `{running}` |
| `POST /sandboxes/:id/timeout` | `{timeout}` seconds |
| `POST /sandboxes/:id/pause` · `/resume` | pause · resume |
| `GET /sandboxes/:id/ports/:port/url` | `{url, headers}` for a port |
| `POST /sandboxes/:id/commands/run` | run to completion: `{stdout, stderr, exit_code}` |
| `POST /sandboxes/:id/commands/stream` | SSE: `stdout`/`stderr`/`exit` events then `end` (body: `cmd` or `cmd` + `args`, `env`, `cwd`, `user`, `timeout`) |
| `GET /sandboxes/:id/processes` | running processes |
| `POST /sandboxes/:id/processes/:pid/signal` · `/stdin` · `DELETE …/:pid` | signal · write stdin · kill |
| `GET` / `PUT /sandboxes/:id/files/content?path=` | read or write raw bytes (`application/octet-stream`) |
| `GET /sandboxes/:id/files/list` · `/info` · `/exists` | directory listing, stat, existence (`path`, `depth`) |
| `POST /sandboxes/:id/files/mkdir` · `/move` · `DELETE …/files` | make directory · rename · remove |
| `GET /sandboxes/:id/files/watch` | SSE of file changes |
| `POST /sandboxes/:id/code/run` | run code: `code`, `language`, `context_id`, `envs`, `timeout` |
| `…/code/contexts` | create, list, restart, delete code contexts |
| `GET /sandboxes/:id/terminal?cols=&rows=&shell=` | WebSocket PTY: binary frames are bytes in and out; text frames `{"type":"resize","cols":…,"rows":…}` resize |

A feature the provider did not declare answers `501`, the same condition the CLI reports as `E8004`.

## Errors

```json
{ "error": { "type": "SandboxNotFoundError", "code": "E2009", "message": "…", "suggestion": "…", "docs_url": "…" } }
```

`type` is the SDK exception class, so a client rebuilds the same exception. Status codes: `404` not found, `401` bad token or provider authentication, `501` capability missing, `400` bad value or configuration, `500` anything else. Inside an SSE stream the same object arrives as an `error` event.

## Which kinds the engine runs

The engine hosts `builtin` (`alicloud-express`), `rest` (`e2b-rest/1`), `exec` (EPP/1 child processes of third-party plugins) and `node` (in-process `node/1` modules: `opensandbox`, `e2b`, `cubesandbox`, `alicloud-container`) providers. A client never sees the difference.

The Python gRPC engine in `agent_sandbox.engine` is superseded by this one for provider plugins.

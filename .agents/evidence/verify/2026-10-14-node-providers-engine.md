# Verification: node-kind providers through the local engine

- Date: 2026-10-14
- Change: ADR [`2026-10-14-node-provider-engine`](../../notes/implemented/architecture/2026-10-14-node-provider-engine.md)
- Result: PARTIAL (the suites and the live OpenSandbox path passed; e2b, cubesandbox and alicloud-container were mock-only; two unrelated template-adopt tests fail before and after this work; the limits below were not run)
- Binary / package under test: CLI host in `cli/` (`npx vitest`, `tsc --noEmit`, eslint on the changed files) and the Python client SDK (`pytest` of `tests/test_providers` and `tests/test_engine`)
- Environment: local Linux, Node for the CLI suite, a local OpenSandbox server 1.1.1 at `127.0.0.1:8080` (Docker) for the live contract-kit and manual Python run. No account credentials were required for the mock-backed cases. Credential values are not recorded.

## What was verified

The `node/1` catalog providers load through the shared TypeScript host, and the Python SDK reaches a `node`-kind provider through `abx-engine/1` (`EngineProvider`, `engine://{provider}/{id}`). OpenSandbox was also exercised against a live local server. CubeSandbox was exercised through the engine against the offline E2B-shaped mock, including an engine restart.

## Commands run

Recorded results below come from these invocations. The `env -i PATH HOME` prefix keeps the process off the ambient environment except for `PATH` and `HOME`.

```bash
env -i PATH="$PATH" HOME="$HOME" bash -c 'cd cli && npx vitest run'
env -i PATH="$PATH" HOME="$HOME" bash -c 'cd cli && npx vitest run tests/test_providers'
env -i PATH="$PATH" HOME="$HOME" bash -c 'cd python-sdk/client-sdk && pytest tests/test_providers tests/test_engine'
env -i PATH="$PATH" HOME="$HOME" node awesome-providers/opensandbox/tests/run.mjs
```

`tsc --noEmit` and eslint were run on the changed files and were clean. The exact file list of that lint invocation is not recorded here.

## Results

| Scenario / test | Result | Notes |
|---|---|---|
| `cd cli && npx vitest run` | 3786 tests; 3784 passed, 2 failed (`tests/integration/test_adopt_deploy_e2e.test.ts` `[express]` and `[flask]`) | The same 2 tests fail on the commit before this work (`d8bcade`), so they are not caused by it. The prompt of the template-adopt agent contains `.env`. One earlier full run did not show them; the cause was not found. |
| `cli/tests/test_providers/test_reference_plugins.test.ts` | 8 passed | Contract kit against a mock OpenSandbox, and against a live local OpenSandbox 1.1.1 at `127.0.0.1:8080` (Docker). Included in the provider vitest run above. |
| `cd python-sdk/client-sdk && pytest tests` | 1856 passed, 33 skipped | Full client-sdk suite, run with `env -i PATH HOME`. `pytest tests/test_providers tests/test_engine` alone was 376 passed before the per-provider tests were added; with them `tests/test_providers` is 381 passed. Includes | Includes the Cube end-to-end and engine-restart tests in `python-sdk/client-sdk/tests/test_providers/test_engine_provider.py` (`test_cube_through_the_engine`, `test_reconnects_after_the_engine_restarts`) against `cli/tests/_support/e2b_mock.ts`. |
| `cli/tests/test_providers/test_e2b_provider.test.ts` and `python-sdk/client-sdk/tests/test_providers/test_engine_e2b.py` | 10 and 6 passed | e2b through the TS host and through the Python SDK and the engine, against the mock: lifecycle, connect fallback order, commands, files, watch, code, port URLs, 401, missing key. |
| `test_cubesandbox_provider.test.ts` and `test_engine_cube.py` | 10 and 5 passed | Config defaults, lifecycle, data plane, pty through a proxy dial, envd `allow_missing`, error mapping, the CLI and the engine HTTP route. |
| `test_alicloud_container_provider.test.ts` and `test_engine_alicloud_container.py` | 8 and 4 passed | Domain and base URL handling (scheme, port, private mode), native lifecycle, private data plane, auth header forwarding, 401/404/5xx mapping, manifest features against the implementation. |
| `node awesome-providers/opensandbox/tests/run.mjs` | 51 passed | The OpenSandbox plugin's own tests. |
| Manual live path: Python SDK → engine → `node`-kind `opensandbox` → local server 1.1.1 | OK | `create`, `commands.run` (stdout `live-node-kind`), files write/read, terminal echo `pty-ok`. |
| `tsc --noEmit` and eslint on the changed files | clean | |

## Cleanup

No cleanup command was recorded for the manual live OpenSandbox sandbox. The automated suites use the E2B-shaped mock or the plugin's own mock, plus the process-local engine started by the tests.

## Problems found

Two `tests/integration/test_adopt_deploy_e2e.test.ts` cases (`[express]`, `[flask]`) fail in the full run and fail the same way at `d8bcade`, before this work. They are not provider-related and were left alone.

The per-provider tests found and fixed real defects:

- `cli/src/protocol/process.ts`: the process Start request lacked the top-level `stdin: false` that the Python protocol sends, so a command that reads stdin waited for the HTTP timeout.
- `cli/src/protocol/filesystem.ts`: envd watch events (`{filesystem:{name,type}}`, `EVENT_TYPE_*`) were not parsed.
- `awesome-providers/cubesandbox/provider.mjs`: port URLs were built as `https://` from the configured domain; Cube serves `http://{port}-{id}.{domain}` and the create response's domain wins.
- `cli/src/engine/server.ts`: template-not-found, quota and creation errors all answered HTTP 500; they are 404, 429 and 400 now.
- `awesome-providers/alicloud-container/provider.mjs`: a domain with a scheme was built into `https://api.https://...`; a blank key and a base URL with no scheme were not reported; unimplemented context methods threw `TypeError` instead of `E8004`.

## Not verified

- `e2b`, `cubesandbox` and `alicloud-container` were verified only against the offline E2B-shaped mock (`cli/tests/_support/e2b_mock.ts`). No real accounts were used.
- e2b: real creation and auth on `api.e2b.app`, the TLS data plane, and whether public envd wants Connect request frames (`envelope_connect`) are unverified. The mock returns a fixed `file-bytes` for reads and keeps `state: running` after pause.
- cubesandbox: real template ids, CubeProxy dialing, envd, Jupyter and PTY behavior on a cluster are unverified.
- alicloud-container: the native data-plane host `https://{port}-{id}.{domain}` has no DNS in the tests (only the URL shape is checked); envd port 49983, the `state` list filter, pause and timeout status codes and the Jupyter ndjson fields are unverified on ACS/ACK.
- mypy was not run.
- Python has no dedicated automated test for `node`-kind OpenSandbox. The live OpenSandbox path above is a manual run.
- The changes were not pushed to a remote.

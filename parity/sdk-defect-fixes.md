# Python SDK defect fixes the Node API layer must replicate (after the parity gate)

The Python SDK (`python-sdk/client-sdk`) fixed the defects `python-sdk/e2e/KNOWN-ISSUES.md` records as
KI-001 .. KI-007 and KI-010 (they exist in the original v0.2.0 code that is the parity oracle of this
CLI). The TypeScript port in `cli/src/{api,protocol,transport}` mirrors the *original* behaviour and was
**deliberately not changed**. After the parity gate, apply the changes below so the Node API layer
behaves like the fixed SDK. Every wire shape was captured from a real envd 0.5.2 sandbox; the Python
regression tests are in `python-sdk/client-sdk/tests/test_known_issues/` (copy their request/response
fixtures into the vitest suite: `helpers.py` has the exact frames).

Nothing here touches `cli/`; this file is the only addition. Python files named below are in
`python-sdk/client-sdk/src/easy_sandbox/`.

## Summary table

| KI | TS place to change | Python reference | CLI-visible effect |
|---|---|---|---|
| 001 | `protocol/process.ts` `ProcessProtocol.start` | `protocol/process.py::ProcessProtocol.start` | per-call `env` (SDK / MCP `run_command` envs) reaches the command |
| 002 | `protocol/filesystem.ts` `_parseFileInfo`, `stat` (+ new `_unwrapEntry`, `_parseSize`) | `protocol/filesystem.py::_parse_file_info/_unwrap_entry` | `ebx sandbox files list` / `stat` and MCP `list_files` show `directory`, real name/path/size |
| 003 | `protocol/process.ts` `start` (new guard generator), `transport/http.ts` `envdStream` | `protocol/process.py::_guard_command_timeout`, `transport/http.py::envd_stream` | timeout of a silent command is exit 5 `E3001` "Command did not finish within Ns" instead of "Request timed out" |
| 004 | `protocol/process.ts` `connectToProcess`, `update`, `sendInput`, `sendSignal`, `kill`, `sendStdin` | `protocol/process.py` | `ebx sandbox process signal` actually signals; stdin reaches the process; `--signal` other than 9/15 is an error |
| 005 | `protocol/filesystem.ts` (all envd calls), `protocol/sandbox.ts`, `models/errors.ts`, `cli/src/cli/main.ts` | `protocol/filesystem.py::_raise_file_error`, `protocol/sandbox.py::_sandbox_request`, `models/errors.py::SandboxNotFoundError` | exit 4 kept, but code/text change (`E4001` / `E2009` instead of `E5000` "Resource not found (HTTP 404)") |
| 006 | `transport/http.ts` `platformRequest` | `transport/http.py::HttpClient.platform_request/_authentication_error` | exit 3 kept; message/code change (`E1001`/`E1003` instead of the generic `E1000` text) |
| 007 | `protocol/filesystem.ts` `listDir` | `protocol/filesystem.py::list_dir` | `ebx sandbox files list` of a missing directory exits 4 instead of "Directory is empty." |
| 010 | none (the `@sandbox` decorator has no TS port) | `declarative/decorator.py::_build_json_script` | none |
| 008 (report only) | `protocol/filesystem.ts` `uploadFile`/`downloadFile` | `protocol/filesystem.py::_raise_transfer_timeout` | clear `FileOperationError` text instead of "Request timed out" |

Common helpers to add first (TS):

* `envdStatusError(exc: HTTPStatusError, rpcPath: string): EnvdRpcError` in `transport/http.ts`, the
  non-streaming twin of `_raiseEnvdRpcError` (Python: `transport/http.py::envd_status_error`, shared body
  builder `_build_envd_rpc_error(raw, status, rpc_path)`); the message is
  `envd RPC <path> failed (HTTP <status>): <detail>` and never contains the sandbox URL.
* `SandboxNotFoundError` (code `E2009`, extends `SandboxError`, **not** `SandboxCreationError`, suggestion
  `Run 'ebx list' to see the running sandboxes; a killed or expired sandbox cannot be reconnected.`) in
  `models/errors.ts`, exported next to the other errors and added to the errors `__all__`/fixture parity
  lists. Also add it to the "not found" branch of `exitCodeFor` in `providers/epp.ts` (exit 4).

---

## KI-001 per-call `env` dropped

* **Root cause.** `ProcessProtocol.start` put the variables under `process.envVars` (the spelling of the
  sandbox *create* body). envd's `ProcessConfig` has `map<string,string> envs = 3`; protobuf-JSON ignores the
  unknown key, so nothing reached the process.
* **Old.** `{"process": {"cmd": "printenv", "args": ["X"], "envVars": {"X": "1"}}}` -> `printenv` fails (exit 1).
* **New.** `{"process": {"cmd": "printenv", "args": ["X"], "envs": {"X": "1"}}}` -> prints `1`. No `envs`
  key when `env` is empty/absent (unchanged). Sandbox create (`protocol/sandbox.ts`, `envVars`) is unchanged.
* **TS.** `protocol/process.ts` line `process_obj["envVars"] = env` -> `process_obj["envs"] = env`
  (`api/commands.ts` already forwards `env`). Update the existing "payload isolation" vitest expectations
  (`envVars` -> `envs`).

## KI-002 directories reported as files, `stat` name/path blank

* **Root cause.** `_parseFileInfo` only knew `isDir` / `type == "directory"`. envd's `EntryInfo.type` is the
  enum `FILE_TYPE_FILE = 1`, `FILE_TYPE_DIRECTORY = 2`, JSON-encoded as a **number**; `Stat` answers
  `{"entry": {...}}` (the SDK read `result`/the top level, finding no name/path/size).
* **Captured wire.** `ListDir -> {"entries":[{"name":"sub","path":"/tmp/pr/sub","type":2,"size":4096,"mode":493,"permissions":"drwxr-xr-x","owner":"1000","group":"1000","modifiedTime":"2026-10-12T12:01:49Z"}, ...]}`;
  `Stat -> {"entry": {...same shape...}}`. A symlink to a file is `type: 1`.
* **Old.** `list` -> every entry `type: "file"`; `getInfo` -> `FileInfo{name:"", path:"", size:0, type:"file"}`.
* **New.** directory when `isDir` is truthy, or `String(type).trim().toUpperCase()` is one of `2`,
  `FILE_TYPE_DIRECTORY`, `DIRECTORY`; otherwise file (`0`, `1`, `FILE_TYPE_FILE`, `file`, missing). `size` is
  `parseInt` of the value (protobuf-JSON may render int64 as a string; non-numeric -> 0). `stat` unwraps
  `response.result ?? response`, then `.entry` when it is an object. Name still falls back to the last path
  segment; `modified` stays unset (the SDK did not add it).
* **TS.** `protocol/filesystem.ts`: `_parseFileInfo` (line ~62: `dictGet(data,"type") === "directory"`),
  `stat` (line ~128: read `entry`).
* **CLI.** `files list` table/JSON `type` column shows `directory`; `files stat` prints the real name, path, size
  and type (the Python oracle printed blank name/path, see `cli/e2e/BASELINE.md`); MCP `list_files` likewise.

## KI-003 command timeout surfaced as raw `ReadTimeout`

* **Root cause.** The HTTP read timeout of a `Start` stream is `timeout + 5` s. A command that stays silent
  that long makes httpx raise `ReadTimeout`; nothing mapped it, so `CommandTimeoutError` (E3001) was dead code,
  and the process kept running in the sandbox (closing the stream does not stop it).
* **Old.** `commands.run("sleep 60", timeout=3)` -> `httpx.ReadTimeout` after ~8 s (CLI: `Request timed out: ...`,
  code E3001 text about HTTP timeouts, exit 5); process left running.
* **New.** `CommandTimeoutError("Command did not finish within 3s (no output for 8s; pid N was asked to stop).")`
  (code `E3001`, existing suggestion). On `ReadTimeout` of the stream, if a `start` event was seen, send
  `SendSignal(pid, SIGNAL_SIGKILL)` with a 10 s timeout, ignoring any error (the timeout must win). A
  `ConnectTimeout` (not a `ConnectError` subclass) becomes `ConnectionError_("Failed to connect to sandbox envd
  for streaming: ...")` in `envdStream`. Still an *inactivity* limit, not a wall-clock deadline (unchanged).
* **TS.** `protocol/process.ts` `start`: wrap `raw_stream` in an async generator that tracks
  `frame.event.start.pid` and converts `ReadTimeout` (class re-exported from `transport/http.ts`) as above
  before building the `StreamReader`; `transport/http.ts` `envdStream`: catch `ConnectTimeout` next to
  `ConnectError`. The `pid` in the start event is **envd's id, not an OS pid** (see KI-004).
* **CLI.** Exit code stays 5 (`EXIT_TIMEOUT`) but the text is now the SDK message with code `E3001` and the
  SDK suggestion (not the "Request timed out ... http_timeout" block of `_handleRemoteException`).

## KI-004 `kill` / `send_signal` / `send_input` never reached the process

* **Root cause.** The bodies were flat (`{"pid":N,...}`). envd (`process.proto`): `SendSignalRequest{process:
  ProcessSelector, signal: Signal}`, `SendInputRequest{process, input: ProcessInput{stdin: bytes}}`,
  `ConnectRequest{process}`, `UpdateRequest{process, pty}`, `ProcessSelector{pid | tag}`,
  `Signal{SIGNAL_SIGTERM=15, SIGNAL_SIGKILL=9}`; `bytes` are base64 in JSON. envd ignored the unknown keys
  (`process not found` for input; signal silently `{}`), so real processes kept running.
* **Old.** `SendSignal {"pid":N,"signal":9}`, `SendInput {"pid":N,"data":"x"}`, `Connect {"pid":N}`,
  `Update {"pid":N,...}`.
* **New.** `SendSignal {"process":{"pid":N},"signal":"SIGNAL_SIGKILL"}` (15 -> `SIGNAL_SIGTERM`; `kill` = 9);
  `SendInput {"process":{"pid":N},"input":{"stdin":"<base64 of UTF-8 data>"}}`; `Connect {"process":{"pid":N}}`;
  `Update {"process":{"pid":N}, ...kwargs}`. Selector: `number` or all-digit string -> `{"pid": Number}`; any
  other string -> `{"tag": "<string>"}`; a boolean is a TypeError. Any signal other than 9/15 (also 0, negative,
  > 64) -> `ValueError`-equivalent (`"envd can only deliver SIGTERM (15) and SIGKILL (9) to a process; got N"`)
  **before any request** (there is no `kill -N` fallback: envd pids are its own counters, 1, 2, 3 ..., not OS pids).
  The unary calls (`list`, `update`, `sendInput`, `sendSignal`, `kill`) turn `HTTPStatusError` into
  `EnvdRpcError` via `envdStatusError` (`envd RPC /process.Process/SendInput failed (HTTP 404): process not found`).
* **TS.** `protocol/process.ts`: `connectToProcess` (line ~185), `update` (~200), `sendInput` (~210),
  `sendSignal` (~224), `sendStdin`/`kill` (delegates), `listProcesses`; the `pid` option type becomes
  `number | string` (the Python side already widened `ProcessInfo.pid` / `Commands` to `int | str`).
* **CLI.** `ebx sandbox process signal ID PID [--signal N]` (`cli/commands/sandbox_process.ts`) now works for 9 and
  15; its help text still advertises `2 (SIGINT)`, which now fails with the `ValueError` message (update the help or
  map it to a friendly error when porting). `--signal` is validated nowhere else.

## KI-005 not-found conditions leaked raw `HTTPStatusError`

* **Root cause.** `platformRequest` / `envdRequest` / `envdHttpRequest` re-raise `HTTPStatusError`; only `kill`
  (404 -> warn) and create/template had status handling. `connect`, `getInfo`, files read/write/stat/remove/move/
  mkdir propagated the raw error.
* **Old.** `Sandbox.connect("sbx-missing")` and `files.read("/missing")` throw `HTTPStatusError(404)`; CLI prints
  `Resource not found (HTTP 404).` code `E5000`, exit 4 (`_handleRemoteException`).
* **New (sandbox).** `SandboxProtocol.getInfo/connect/setTimeout/pause/resume`: HTTP 404 ->
  `SandboxNotFoundError("Sandbox '<id>' was not found.")` (E2009); other statuses unchanged; `kill` stays
  idempotent (404 swallowed with the existing warning); `isRunning` stays `false`.
* **New (files).** every envd filesystem call (`stat`, `listDir`, `makeDir`, `remove`, `move`) and
  `uploadFile`/`downloadFile`: 404 -> `FileNotFoundError_("File or directory not found in the sandbox: <path>")`
  (E4001), 403 -> `PermissionDeniedError("Permission denied in the sandbox: <path>")` (E4002), any other status ->
  `FileOperationError("envd file operation failed (HTTP <status>) for <path>[: <first 200 chars of body>]")`
  (E4000). `exists` still returns `false` (it swallows everything). `watchDir` is unchanged (already `EnvdRpcError`).
* **TS.** `protocol/filesystem.ts` (a `_rpc` wrapper + try/catch around `envdHttpRequest`), `protocol/sandbox.ts`
  (a `_sandboxRequest` wrapper), `models/errors.ts`, and **`cli/src/cli/main.ts`**: add `SandboxNotFoundError` to the
  `TemplateNotFoundError || FileNotFoundError_` branch of the error wrapper (it is a plain `SandboxError`, so
  without this the exit code would drop from 4 to 1).
* **CLI.** missing sandbox/file: still exit 4; message and code become SDK ones (`E2009` / `E4001`, with the SDK
  suggestion) instead of `E5000` "Resource not found (HTTP 404)."

## KI-006 401 leaked raw `HTTPStatusError`

* **Root cause.** `platformRequest` never mapped 401 (the CLI wrapper did, SDK callers got the raw error).
  `Sandbox.create` with a bad key additionally became `SandboxCreationError` through `_handle_create_error`.
* **Old.** `Sandbox.list(api_key=bad)` -> `HTTPStatusError(401)`; CLI `Authentication failed (HTTP 401).` `E1000`,
  exit 3. `Sandbox.create(bad key)` -> `SandboxCreationError`, exit 1.
* **New.** in `platformRequest`, status 401 -> `InvalidAPIKeyError("The Platform API rejected the API key (HTTP 401)
  for <path>: it is invalid, revoked or for another region.")` (E1001), or `InvalidCredentialsError("The Platform API
  rejected the AK/SK credentials (HTTP 401) for <path>.")` (E1003) when the auth provider is `AkSkAuth`. Text never
  contains the key or the base URL. All other statuses stay raw (403/404/429/5xx are mapped by callers/CLI as before).
  Because the mapping happens before the create handler, `create` with a bad key is now an `AuthenticationError`.
* **TS.** `transport/http.ts` `platformRequest` (the `// httpx.HTTPStatusError: let higher layers handle` branch):
  add the 401 case; `transport/auth.ts` already has `AkSkAuth`.
* **CLI.** exit 3 unchanged; message/code/suggestion are the SDK's (`E1001`/`E1003`); `ebx create` with a bad key is now
  exit 3 instead of 1.

## KI-007 `files.list` of a missing directory returned `[]`

* **Root cause.** envd answers `ListDir` of a missing (or non-directory) path with HTTP 200 `{"entries": []}`
  (captured), indistinguishable from an empty directory; `Stat` of the same path is HTTP 404 (empty body).
* **Old.** `files.list("/nope")` -> `[]` (CLI: `Directory /nope is empty.`, exit 0).
* **New.** if `ListDir` returns no entries, call `Stat(path)` once; `Stat` failing maps to `FileNotFoundError_`
  (KI-005). An existing empty directory (or a file path) still returns `[]`. A non-empty listing costs no extra
  request. A `ListDir` HTTP 404 maps to `FileNotFoundError_` too.
* **TS.** `protocol/filesystem.ts` `listDir` (after computing `entries`).
* **CLI.** `ebx sandbox files list ID --path /nope` exits 4 with `File or directory not found in the sandbox: /nope`
  (E4001) instead of reporting an empty directory.

## KI-010 `@sandbox` on `async def`

Python-only (`declarative/decorator.py`: `_build_json_script(..., is_async)` now emits `asyncio.run(f(*args,
**kwargs))` for coroutine functions). There is no declarative module in `cli/src`, so nothing to port.

## KI-008 (platform throughput, report only)

`uploadFile` / `downloadFile` turn `httpx` write/read timeouts (`TimeoutException`) into
`FileOperationError("Upload to <path> (<n> bytes) timed out; the transfer took longer than the HTTP timeout.")`
(download: `Download of <path> timed out; ...`) with suggestion `Raise the HTTP timeout (EBX_HTTP_TIMEOUT /
http_timeout) or transfer smaller chunks.` The timeout value itself is unchanged. TS: `protocol/filesystem.ts`
`uploadFile` / `downloadFile`. CLI: exit 1 with that text instead of the `Request timed out` block (exit 5).

## Parity-test notes

* The vitest mirrors of `tests/test_protocol/test_process.py` (`TestSendStdin`, `TestKillProcess`,
  `TestEnvdPayloadIsolation`) change their expected bodies exactly as in the Python tests (see the diff of that file).
* `exitCodeFor` / errors fixtures: new class `SandboxNotFoundError` E2009 (unique code; documented in
  `docs/{en,zh}/reference/error-codes.md`).
* After the gate, re-run the cli E2E (`cli/e2e`) differential harness: the baseline records KI-002 as an oracle
  defect (`files stat` prints a blank name/path), so those expectations flip with this change.

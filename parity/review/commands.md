# Adversarial review: area `commands`

Scope: `cli/src/framework/**`, `cli/src/cli/{main,output,formatters,region,repl,scaffold,_rich*,_orjson}.ts`, `cli/src/bin/abx.ts`,
`cli/src/cli/commands/{config_cmd,sandbox,sandbox_files,sandbox_process,sandbox_system}.ts` against Python `agent_sandbox/cli/**`.
Reviewer: independent (did not write the port). `cli/src/**` was not edited.

Placeholders: `$ORACLE_VENV` = virtualenv with the original Python `abx` (real Click 8.5, Rich, httpx), `$ORIG_REPO` = original checkout.
All harness runs used an isolated `HOME`, `ABX_NO_KEYCHAIN=1`, no real credentials and a private stub HTTP server per run.

## Deliverables

| Kind | Path |
| --- | --- |
| Vitest, `ADV-commands-01..15` (no oracle needed; expected values come from the oracle and are hard-coded) | `cli/tests/test_cli/adv_commands.test.ts` (ADV-01..15 plus ADV-16..18 added with the fixes) |
| Option/argument/command metadata dump of both trees (Python side / Node side, compared with `inspect.cleandoc` on help) | `cli/parity/diff/adv_commands_meta_dump.{py,mjs}` (the `.mjs` needs `node --import tsx`) |
| Shared runner (private stub, pty, signals, shell, tree snapshots) | `cli/parity/diff/adv_commands_lib.mjs` |
| Auto-generated option-parsing fuzz from oracle metadata (2385 cases) | `cli/parity/diff/adv_commands_fuzz.mjs` |
| Timeouts / huge ints (75) | `cli/parity/diff/adv_commands_misc.mjs` |
| Every runnable command x output mode x fault (1517) | `cli/parity/diff/adv_commands_matrix.mjs` |
| `[shortcuts]` shapes and unknown-command hints (994) | `cli/parity/diff/adv_commands_shortcuts.mjs` |
| Closed/full/broken stdio, pipes, signals, locale, REPL over pipes (237) | `cli/parity/diff/adv_commands_proc.mjs` |
| REPL under a pty, Rich/Click TTY env matrix (375+) | `cli/parity/diff/adv_commands_pty.mjs` |
| upload/download transfers with a binary-safe stub (89) | `cli/parity/diff/adv_commands_xfer.mjs` |
| create/kill/list flag semantics (232) | `cli/parity/diff/adv_commands_create.mjs` |
| Rich replacement through real commands, hostile cell data, widths 1..300 (456) | `cli/parity/diff/adv_commands_rich.mjs` |

Run: `ORACLE_VENV=... node parity/diff/adv_commands_<x>.mjs` (prints `DIFF ...`; prints `SKIP` and exits 0 without the oracle).
Env knob: `ADV_DROP_HTTP_INFO=1` hides the `INFO: HTTP Request:` lines (see C-05) so other diffs are visible.
Tests: `npx vitest run tests/test_cli/adv_commands.test.ts` (moved from `tests/adversarial/commands/commands.test.ts`; about 40 s; ADV-12/13 need `python3`, ADV-07/10 need `/dev/full`).

## Counts

* BUG: 13 open-or-fixed (1 HIGH C-01, 1 MEDIUM C-03, 1 MEDIUM-LOW C-02, 10 LOW); 4 of the LOW/MEDIUM ones (C-10a..d) were fixed in `cli/src` while I worked.
* GAP-UNJUSTIFIED: 2 (C-04, C-13)  -  ACCEPTED-OK: see the last section.
* Vitest at the end of the review: 15 cases, 9 FAIL (open: C-01..C-09), 6 PASS (C-10a..d: fixed meanwhile, now regression guards).

Test map: ADV-01 = C-10a, 02 = C-10b, 03 = C-10c, 04 = C-10d, 05 = C-04, 06 = C-05, 07 = C-03, 08 = C-06, 09 = C-07, 10 = C-08, 11 = C-09,
12 = C-01, 13 = C-02, 14 = C-10b (signal), 15 = C-10c (request timeout).

## Fix status

All BUG / GAP-UNJUSTIFIED findings were addressed in `cli/src`; the `ADV-commands-NN` tests moved to `tests/test_cli/adv_commands.test.ts`
(18 tests, all active, no `test.skip`; `it.skipIf` only when `python3` or `/dev/full` is missing on the machine).

| Id | Kind | Fix status | Where / how |
| --- | --- | --- | --- |
| C-01 | BUG HIGH | FIXED (`ADV-12`, `ADV-16`) | `src/cli/repl.ts`: stdin is read once into a module-level buffer; each prompt gets a readline `Interface` fed only up to the first Enter / Ctrl+J / Ctrl+C / Ctrl+D (GNU readline consumes one byte at a time), the remainder stays queued for the next `input()`. Raw mode is on only while a prompt is active. EOF / Ctrl+C / Ctrl+D semantics unchanged. |
| C-02 | BUG MEDIUM-LOW | FIXED (`ADV-13`) | same redesign (no raw-mode toggling with unread bytes dropped); 5000 char line + following line work. |
| C-03 | BUG MEDIUM | FIXED (`ADV-07`) | `src/framework/io.ts`: non-TTY stdout/stderr are written with `fs.writeSync` (EAGAIN retried), failures (ENOSPC, EIO, ...) are sticky and thrown as the Node error so `handle_errors` prints `OS error: [Errno 28] ...`; stream `'error'` events are recorded, never unhandled. `finalizeStreams` (`src/bin/abx_main.ts`) reproduces Python's final failing flush: `Exception ignored in: <_io.TextIOWrapper name='<stdout>' ...>` and exit status **120** (the oracle exits 120, not 1; the old test expectation was wrong). EPIPE stays silent. |
| C-04 | GAP-UNJUSTIFIED | FIXED (`ADV-05`) | `src/transport/_httpx.ts`: `httpx` logger `INFO HTTP Request: METHOD URL "HTTP/x CODE Reason"` for every response incl. redirect hops. |
| C-05 | BUG LOW | FIXED (`ADV-06`) | `_parsePairs` (`sandbox.ts`) and the pydantic `dict` validator/dump (`src/models/_pydantic.ts`) define `__proto__` as an own property. |
| C-06 | BUG LOW | FIXED (`ADV-08`) | `src/bin/abx.ts` is now a shim that drops Node's `NO_COLOR`/`FORCE_COLOR` warning (emitted while linking `node:http`) and then imports `abx_main.ts`. |
| C-07 | BUG LOW | FIXED (`ADV-09`) | `URL_` keeps scheme-less URLs (`127.0.0.1:9`, `not a url`, `/x`, `//h/x`) so the request fails with httpx's `UnsupportedProtocol` text; unparsable URLs that do have a scheme still raise `InvalidURL`. |
| C-08 | BUG LOW | FIXED (`ADV-10`) | `download` in `sandbox.ts` and `Files.download` in `src/api/files.ts`: open errors keep the filename, write errors do not. |
| C-09 | BUG LOW | FIXED (`ADV-11`) | `_httpx.ts`: truncated body -> `(received N bytes, expected M)` for Content-Length, `(incomplete chunked read)` for chunked; a real RST is a `ReadError`. |
| C-10a..d | BUG | FIXED during review (`ADV-01..04`, `14`, `15`) | `ADV-04` additionally needed `t.connect <= 0` to expire before anything is sent (it raced with an instant localhost connect and sent `Start`). An already-expired timeout (`httpx.Timeout(<= 0)`) stays `ConnectTimeout` and the CLI reports `[E3001] Request timed out` (exit 5), matching the oracle (AT-12). A `ConnectTimeout` under a positive timeout is still `ConnectionError_` (`[E5001]`, KI-003). |
| C-11 | BUG LOW | FIXED (`ADV-17`, `ADV-18`) | `repl.ts`: `TERM=dumb` keeps full editing (Node's dumb handler is removed), kill ring + Ctrl+Y, whitespace-delimited Ctrl+W (kills do not merge, verified against the oracle), Alt+D / Alt+Backspace, bell on Ctrl+D at end of a non-empty line. Tab / Ctrl+L redraw bytes remain ACCEPTED-OK (escape-sequence encodings). |
| C-12 | BUG LOW | FIXED | subsumed by C-01 (type-ahead is consumed prompt by prompt). The redraw bytes (`ESC[1G ESC[0J`) readline emits around the prompt stay ACCEPTED-OK. |
| C-13 | GAP-UNJUSTIFIED | DOCUMENTED, not changed | lone surrogates cannot come from a real terminal or argv (both are bytes); Node cannot hold them in `process.argv` at all. Only reachable programmatically. |
| C-14 | ACCEPTED-OK | unchanged | `info .` URL normalisation. |

## Findings

Severity is the user impact on a real run. "expected" is always the Python oracle.

### C-01 REPL drops type-ahead / pasted lines and then hangs (BUG, HIGH)  - open, `ADV-commands-12`
* Repro: `abx connect SBX` on a TTY; paste `echo a<CR>echo b<CR>echo c<CR>exit<CR>` in one write.
* Expected: a, b, c run, then exit 0. Actual: only `echo a` runs, then the prompt hangs forever (the rest of the paste is gone).
* Root cause: `src/cli/repl.ts:177` `_editedInput` creates a NEW `readline.Interface` per prompt and `rl.close()`s it after the first line
  (`finish`, ~line 188); bytes of the same chunk that belong to later lines are consumed and discarded with it.
* Fix: keep one persistent `Interface` for the whole REPL and feed lines through a queue (`rl.on("line")` + a pending-resolver list),
  or `rl.pause()` instead of `close()` and re-use it; keep history in the same instance.

### C-02 REPL stops reacting after a very long line (BUG, MEDIUM-LOW)  - open, `ADV-commands-13`
* Repro: in a pty type `echo ` + 5000 `x`, Enter, then `echo hello`. Threshold is about 4090 bytes (4080 works).
* Expected: both lines run (Python handles 5000+ chars). Actual: first result and a new prompt are printed, later input is ignored (hang).
  Node also redraws the whole line for every keystroke (112 KB of output for a 4000 char line vs 8 KB in Python).
* Root cause: not fully pinned down; same area as C-01 (`repl.ts` `_editedInput`, one throw-away `readline` per line on a raw-mode TTY,
  pty canonical buffer limit 4096 is hit while raw mode is toggled between lines). A persistent Interface (C-01 fix) most likely fixes it.

### C-03 failed stdout/stderr write crashes with an unhandled stream error (BUG, MEDIUM)  - open, `ADV-commands-07`
* Repro: `abx config list > /dev/full` (also `list --quiet`).
* Expected: `OS error: [Errno 28] No space left on device` + `Suggestion: Check file permissions and disk space.`, exit 1.
  Actual: Node prints a stack trace (`node:events: throw er; // Unhandled 'error' event ... ENOSPC`) and exits 1. The same code path swallowed
  the failure silently earlier in the review (exit 0), so the behaviour is also unstable between revisions.
* Root cause: `src/framework/io.ts:40-47` `ProcessOutput.write` wraps `stream.write` in try/catch, but write errors on a `SyncWriteStream` are
  emitted asynchronously as `'error'` events, not thrown, and there is no `stream.on("error")` handler. Pipes: `| head -c1` is fine (EPIPE ends quietly, like Python).
* Fix: attach an `error` listener on `process.stdout/stderr` in `ProcessOutput`, record the first error and rethrow it (as `toOSError`) from
  the next `write`/`flush` or at exit, so `handle_errors` prints Python's `OS error: ...` message and exits 1.

### C-04 `--log-level info|debug` and `--verbose` omit httpx's `INFO: HTTP Request:` line (GAP-UNJUSTIFIED, LOW-MEDIUM)  - open, `ADV-commands-05`
* Repro: `abx --log-level info list`. Expected: `INFO: HTTP Request: GET http://HOST/sandboxes?limit=20&offset=0 "HTTP/1.1 200 OK"` on stderr
  (one per request, also at DEBUG and `-v`). Actual: silent. `KNOWN-GAPS.md` only mentions losing SDK log lines.
* Root cause: the transport (`src/transport/_httpx.ts`) never logs through the `httpx` logger; the CLI log handler never sees it.
* Fix: log `"HTTP Request: %s %s \"%s %d %s\""` at INFO from the same place the response status is known (also redirects and streamed responses).
  The httpcore/asyncio DEBUG lines (`connect_tcp.started`, `Using selector: EpollSelector`) stay ACCEPTED-OK.

### C-05 `create --env __proto__=X` / `--metadata __proto__=X` silently drop the key (BUG, LOW)  - open, `ADV-commands-06`
* Expected body `{"metadata":{"__proto__":"2"},"envVars":{"__proto__":"1"}}`; actual `{"metadata":{},"envVars":{}}`.
* Root cause: `src/cli/commands/sandbox.ts:912-920` `_parsePairs` assigns into a plain `{}` (the setter for `__proto__` swallows strings).
* Fix: `Object.create(null)` is not enough for JSON.stringify of own `__proto__`; use `Object.defineProperty(result, key, {value, enumerable: true, writable: true, configurable: true})` or a `Map`.

### C-06 `FORCE_COLOR` together with `NO_COLOR` leaks a Node warning (BUG, LOW)  - open, `ADV-commands-08`
* Repro: `FORCE_COLOR=1 NO_COLOR=1 abx config list`. Actual stderr: `(node:PID) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`; Python prints nothing.
* Root cause: Node's own startup check on the real environment (before `src/bin/abx.ts` runs).
* Fix: in the launcher/shim (`bin/abx.js` wrapper) call `process.removeAllListeners("warning")` is too late; use `NODE_NO_WARNINGS=1`/`--no-warnings` in the re-exec, or `process.emitWarning` filter via `--disable-warning=...` in the shebang; the compiled binary can strip it at build time.

### C-07 scheme-less `E2B_API_URL` message differs (BUG, LOW)  - open, `ADV-commands-09`
* Repro: `E2B_API_URL=127.0.0.1:9 abx list` (or `"not a url"`). Expected `Request URL is missing an 'http://' or 'https://' protocol.`;
  actual `Unexpected error: Invalid URL "127.0.0.1:9"`.
* Root cause: `src/transport/_httpx.ts:472` throws `InvalidURL` with Node's wording, and the scheme-less case should be the `UnsupportedProtocol`
  message (httpx `_transports/default.py`/`httpcore`); `InvalidURL` is only for unparsable authority.
* Fix: when the URL has no scheme (or scheme is not http/https) raise `UnsupportedProtocol("Request URL is missing an 'http://' or 'https://' protocol.")`
  / `"Request URL has an unsupported protocol 'ftp://'."` and let the CLI map it like Python.

### C-08 download write error carries a filename (BUG, LOW)  - open, `ADV-commands-10`
* Repro: `abx download SBX /home/user/hello.txt /dev/full`. Expected `OS error: [Errno 28] No space left on device`; actual appends `: '/dev/full'`.
* Root cause: `src/api/files.ts:90` `fs.writeFileSync` error carries `path`; the generic OSError mapper uses it. Python's `write_bytes` failure has no filename in this path
  (the open succeeds, the write fails). Only the write-failure case differs; open failures (`ENOENT`, `EACCES`) correctly include the filename.
* Fix: map write failures with `toOSError(e, null)` (open the file with `openSync` first, then `writeSync`, so open and write errors are distinguishable).

### C-09 truncated `Content-Length` body message (BUG, LOW)  - open, `ADV-commands-11`
* Expected `... peer closed connection without sending complete message body (received 1000 bytes, expected 5000)`; actual `(incomplete chunked read)`.
* Root cause: `src/transport/_httpx.ts:1499` hard-codes the chunked wording for `ECONNRESET`, and "received 0 bytes, expected more" otherwise.
* Fix: count bytes read and compare with `content-length` (chunked only when `transfer-encoding: chunked`).

### C-10 Integer / timeout parsing: FIXED while reviewing
* C-10a Unicode digits (`list --limit ٣`; Python `int()` accepts them): `src/framework/py.ts` `parseIntStrict`. `ADV-commands-01` now passes.
* C-10b ints above 2**53 (`list --limit 99999999999999999999`, `process info <id> 9007199254740993`, `process signal --signal 99999999999999999999`
  "Integer exceeds 64-bit range"): INT now keeps precision. `ADV-commands-02` and `-14` pass.
* C-10c `setTimeout` overflow: `exec --timeout 2147483648`, `create --request-timeout 99999999999|inf` fired immediately and printed `TimeoutOverflowWarning`
  (`src/transport/_httpx.ts` `withTimeout` and 5 more `setTimeout`s). Fixed; `ADV-commands-03` and `-15` pass.
* C-10d negative effective timeout (`exec --timeout -5`, `http_timeout = timeout + 5 <= 0`): Python fails at once with E3001 and sends no Start request.
  Fixed; `ADV-commands-04` passes.

### Minor, not covered by a test
* C-11 (BUG, LOW) `sandbox` REPL on `TERM=dumb`: Node `readline` uses its dumb handler (no line editing, Ctrl-D with partial text closes the REPL, Up arrow ignored); Python's readline still edits. No Ctrl-Y yank (`echo foo bar`, Ctrl-W, Ctrl-Y: py `echo foo barbar`-style yank, node nothing). Tab and Ctrl-L differ. `src/cli/repl.ts` `_editedInput`.
* C-12 (BUG, LOW) empty-Enter prompt redraw differs when type-ahead is pending (cosmetic; subsumed by C-01).
* C-13 (GAP-UNJUSTIFIED, LOW) the lone-surrogate argument/cell (`"\ud83d"`): Python fails `Unexpected error: 'utf-8' codec can't encode ... surrogates not allowed`, Node prints U+FFFD and exits 0. Not reproducible from a real terminal (argv is bytes), only via programmatic data; documented only.
* C-14 (ACCEPTED-OK/LOW) `info .` requests `/sandboxes/` in Node vs `/sandboxes` in Python (WHATWG dot-segment normalisation vs httpx).

## Held up (no diff found)

* Full option/argument/command metadata of every command (names, flags, types, defaults, envvars, hidden, help, epilog, `show_default`, choices) - identical to the oracle;
  only the no-op callbacks of groups `config`, `mcp`, `template` are missing in Node (harmless).
* `--help` for every command at widths 40/80/200 (281 cases, `help_all.mjs` also 0 diff).
* Option-parsing fuzz derived from the oracle tree: unknown options, abbreviations, clusters, `--opt=value`, `--`, duplicates, envvars, missing values, bad choices (2385 cases, only C-10a/b).
* Every runnable command x `--json/--quiet/--ci/--verbose/--log-level` x 401/429/500/503/unreachable/no credentials (1517 cases; 0 diffs once C-04 is filtered out).
* Shortcut configuration edge cases and unknown-command hints/"did you mean" (994 cases).
* Output channel discipline (stdout vs stderr), exit codes, `handle_errors` formatting, closed stdin/stdout, SIGINT/SIGTERM/SIGHUP/SIGQUIT handling, locale variants, REPL over pipes (26 cases).
* Rich replacement: tables/panels/markup escapes/CJK/emoji/ZWJ/flags/combining/tabs/control characters at widths 1..300 and with `COLUMNS`/TTY variants (456 cases, 0 diffs).
* Click/Rich TTY + `NO_COLOR`/`FORCE_COLOR`/`TERM`/`CLICOLOR` matrix (375 cases; one timing flake in the kill spinner frame count).
* Uploads (file/dir/symlink/FIFO/unicode names/12 MB/binary) and downloads, create/kill/list flag semantics, `config` wizard paths (1450 existing cases).

## ACCEPTED-OK (Python-specific or Node-inherent)

* SIGUSR1 starts the Node inspector (Python dies of SIGUSR1); could add `--disable-sigusr1`.
* `PYTHONIOENCODING=ascii`, `PYTHONUTF8=0 LC_ALL=C`: Python-only encoding behaviour. stdin being a directory (Python fatal init error). Invalid UTF-8 argv (Python surrogateescape vs Node U+FFFD).
* Closed-stderr corner cases. A `1e-3` s `--request-timeout` race. `template search --token 日本語🎉`: both fail, different text (ascii codec vs invalid header char).
* httpcore `connect_tcp.*`/`send_request_*` DEBUG lines and `Using selector: EpollSelector`; escape-sequence encodings of arrow keys inside the REPL.

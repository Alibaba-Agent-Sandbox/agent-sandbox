# Adversarial review: area `agent-template`

Scope: port `cli/src/agent/**` (qwen_code, clarify, codegen, adopt, coding_agent, template_guide, dockerfile_sources, mcp, mcp_http, mcp_main, tools)
and `cli/src/cli/commands/{template,_adopt,deploy,mcp,_coding_agent}.ts`, against the matching Python files.
Reviewer: independent (did not write the port). `cli/src/**` was not edited.

Placeholders: `$ORACLE_VENV` = the original Python CLI virtualenv (PyYAML safe_load, httpx, pydantic 2.14, uvicorn/httptools, Python 3.11/3.12).
`$ORIG_REPO` = original repo checkout. Every oracle run used an isolated temp `HOME`, `ABX_NO_KEYCHAIN=1`, fake credentials, stub HTTP
servers and fake `docker` / fake `qwen` executables. The real `~/.abx` was never touched.

## Deliverables

| Kind | Path |
| --- | --- |
| Adversarial vitest `ADV-agent-template-01..13` (moved into the regular suites; they pass) | `cli/tests/test_templates/adv_install_init.test.ts`, `cli/tests/test_templates/adv_adopt_gate.test.ts`, `cli/tests/test_agent/adv_qwen_extract.test.ts`, `cli/tests/test_agent/adv_mcp_http_header.test.ts`, `cli/tests/test_agent/adv_mcp_stdio_eof.test.ts` |
| Shared runner (isolated HOME/work, stub server, fake docker, file-tree snapshot incl. modes, listing normalisers) | `cli/parity/diff/adv_agent_template_lib.mjs` |
| `template install/search/init --from/build`, hostile tarballs (240 cases) | `cli/parity/diff/adv_agent_template_install.mjs` (+ `adv_agent_template_mktar.py`) |
| PyYAML safe_load vs both port loaders, 3 494-document corpus | `cli/parity/diff/adv_agent_template_yaml.mjs` (+ `adv_agent_template_yaml_oracle.py`; run under `node --import tsx`) |
| `template init --adopt` with a scriptable fake qwen (404 cases: spawn/kill/env scrub/timeouts/staging/promote/drift/backups/secret filters/YAML/Dockerfile validation) | `cli/parity/diff/adv_agent_template_adopt.mjs` (+ `adv_agent_template_fakeqwen.py`) |
| `mcp install` (cursor/claude/vscode) and `mcp deploy` artifact bytes (924 cases) | `cli/parity/diff/adv_agent_template_mcp_install.mjs` |
| MCP STDIO server, JSON-RPC + signals + EOF (183 cases) | `cli/parity/diff/adv_agent_template_mcp_stdio.mjs` |
| MCP HTTP server, raw-socket exchanges (301 cases + lifecycle flows) | `cli/parity/diff/adv_agent_template_mcp_http.mjs` |

Run: `ORACLE_VENV=... node parity/diff/adv_agent_template_<x>.mjs [--verbose] [--only <substr>]` (exit 0 identical, 1 diffs, skipped cleanly if the
oracle is absent). Tests: `npx vitest run tests/test_templates/adv_install_init.test.ts tests/test_templates/adv_adopt_gate.test.ts tests/test_agent/adv_qwen_extract.test.ts tests/test_agent/adv_mcp_http_header.test.ts tests/test_agent/adv_mcp_stdio_eof.test.ts tests/test_agent/test_template_gate_gaps.test.ts`.

## Counts

* BUG: 12 (1 MEDIUM-LOW, 11 LOW)  -  GAP-UNJUSTIFIED: 4 (all LOW)  -  ACCEPTED-OK: 12 (listed at the end)
* Differential volume: 240 + 924 + 404 + 183 + 301 + 3 494 YAML documents. Final state per suite: install 34/240 differ, mcp-install 6/924 (a 7th, `--memory` beyond 2^53 printed as `1e+23`, was fixed in the shared tree while this review ran),
  adopt 27/404, STDIO 16/183, HTTP 29/301 (all diffs classified below; the rest are identical byte-for-byte).

Harness note (honest disclosure): the adopt suite's `-y` + missing-qwen cases make BOTH CLIs download the official Qwen Code standalone
archive (SHA256-verified) from the vendor mirror into the temporary HOME. No credentials were involved.

## Fix status

| ID | Fix status | Where |
| --- | --- | --- |
| AT-01 | fixed | `src/utils/_pyyaml.ts` / `_pyyaml_load.ts`: `!!python/*` and NUL rejected; `!!binary` / `!!omap` / `!!pairs` / `!!set` accepted |
| AT-02 | fixed | `src/agent/qwen_code.ts`: timeout above 2^31-1 ms raises `timeout is too large` |
| AT-03 | fixed | `src/agent/mcp_http.ts`: 20 KB request headers return 200 |
| AT-04 | fixed | `src/agent/_archive.ts`: extracted directories are 0755, not 0700 |
| AT-05 | fixed | `src/utils/_tar.ts`: a zero-byte tarball is `empty file` |
| AT-06 | fixed | `src/cli/commands/template.ts`: `--alias` is joined without normalising `..` |
| AT-07 | fixed | `src/utils/registry.ts`: list-valued YAML is `pop expected at most 1 argument, got 2` |
| AT-08 | fixed | `src/cli/commands/template.ts`: a list-valued `name` is printed with Python's repr |
| AT-09 | fixed | `src/utils/_pyos.ts` `pyCopytree`: destination-inside-source and partial copy on `EACCES` |
| AT-10 | fixed | `src/utils/_pyos.ts` `pyExpandUser`: unresolvable `~user` is `Could not determine home directory.` |
| AT-11 | fixed | `src/agent/mcp.ts`: a no-I/O request followed by EOF is still answered |
| AT-12 | fixed | `src/transport/http.ts`: an already-expired `httpx.Timeout` (`<= 0`) stays `ConnectTimeout` (not rewritten to `ConnectionError_`) |
| AG-01 | fixed | `src/utils/dockerignore.ts`: a leading UTF-8 BOM is kept, so line 1 does not match |
| AG-02 | fixed | `src/agent/codegen.ts`: `version: 1.0` stays a float (`input_value=1.0, input_type=float`) |
| AG-03 | fixed | `src/agent/_pycompat.ts` and `src/utils/_dotenv.ts`: invalid UTF-8 names the byte and position |
| AG-04 | fixed | index cache stores the response bytes, including a UTF-8 BOM |

---

## BUG findings

### AT-01  adopt: the YAML gate accepts documents PyYAML rejects and rejects documents PyYAML accepts  (BUG, MEDIUM-LOW)

`template init --adopt` validates the agent-written `template.yaml` with the port's rich loader (`src/agent/_pyyaml.ts`);
`template install/build/init --from` use `src/utils/_yaml.ts` (+ `utils/registry.ts`). On a 3 494-document corpus each loader diverges
from `yaml.safe_load` on ~383 documents (96 PyYAML-accepts/port-rejects, ~287 PyYAML-rejects/port-accepts) plus ~58 value
differences. KNOWN-GAPS only documents the error *text*; acceptance differences are not documented.

* PyYAML rejects, port **accepts and promotes into the user's project**: `!!python/object/apply:os.system [echo pwn]` (any `!!python/*`
  tag), NUL and other non-printable characters (`ReaderError`), TAB inside plain scalars / after block indicators, `k: &a: x`, malformed
  anchors, flow-key oddities (`{k: ?a}`), duplicated anchors.
* PyYAML accepts, port **rejects**: `!!binary`, `!!omap`, `!!pairs`, `!!timestamp 2026-01-01`, `!!value`, `"\<newline>"` in a double-quoted
  scalar; `!!set` is accepted but built with a different shape (list vs set), `.inf/.nan/date` mapping keys compare differently.
* No code execution is possible in Node (tags are never constructed), but the gate promises "a template.yaml that PyYAML (the Python `abx`
  and the server-side tooling) can load" and it is weaker than the original: a hostile/hallucinated file lands in the project, and a
  legitimate one using `!!binary`/`!!omap` is refused.
* Repro: `adv_agent_template_yaml.mjs` (summary lines `ACCEPT[rich]`, `VALUE[thin]`), `adv_agent_template_adopt.mjs --only "yaml:"`.
  Tests `ADV-agent-template-04` (install, 3 tags), `-09` (python tag in adopt), `-10` (NUL in adopt).
* Oracle: `$ORACLE_VENV` `abx template init --adopt ... -y` -> `[E2007] Generated template.yaml could not be parsed: could not determine a constructor for the tag 'tag:yaml.org,2002:python/object/apply:os.system'` / `... unacceptable character #x0000: special characters are not allowed`, nothing promoted. Port: exit 0, template.yaml promoted.
* Root cause: `src/agent/_pyyaml.ts` (rich loader built on the `yaml` package's CST/Document; tag resolution and the reader's printable-character
  check are not PyYAML's) and `src/utils/_yaml.ts`. Fix: add a ReaderError pre-pass (PyYAML `NON_PRINTABLE` class), reject every tag outside
  `{str,int,float,bool,null,seq,map,set,omap,pairs,binary,timestamp,merge,value}`, add constructors for `binary/omap/pairs/timestamp/set`, reject TAB per the YAML 1.1 scanner rules PyYAML uses.

### AT-02  `ABX_QWEN_CODEGEN_TIMEOUT` above 2^31-1 ms (~24.8 days) or `inf` kills qwen after 1 ms  (BUG, LOW)

Python raises `OverflowError: timeout is too large` -> `Unexpected error: timeout is too large` (exit 1). The port's `setTimeout(..., seconds*1000)` overflows
Node's 32-bit timer, Node prints `TimeoutOverflowWarning` on stderr and fires after 1 ms, so qwen is killed immediately and the user is told
`[E2007] Qwen Code did not finish within 3000000s` (misleading). Same for `inf` (Python: `cannot convert float infinity to integer`).

* Repro: `adv_agent_template_adopt.mjs --only "env: timeout"`; test `ADV-agent-template-11`.
* Root cause: `src/agent/qwen_code.ts:976` (`setTimeout(..., Math.max(timeoutSeconds, 0) * 1000)`). Fix: clamp or raise a Python-style
  `OverflowError`-equivalent before arming the timer. Other `* 1000` timer sites with user-controlled seconds (`providers/epp.ts:599`, `cli/commands/mcp.ts:95`, `utils/retry.ts`) share the pattern.

### AT-03  MCP HTTP server rejects request headers above Node's 16 KiB default  (BUG, LOW-MEDIUM for real clients)

uvicorn (httptools) accepts a 20 KB header (`/health` -> 200). `http.createServer()` defaults to `maxHeaderSize` 16 384, so the port answers
`431 Request Header Fields Too Large` for a 20 KB header and for a 20 KB URL (uvicorn: 404). A client that sends a large `Authorization`
bearer (JWT/OIDC token) or many cookies through a proxy gets a hard 431 only against the port.

* Repro: `adv_agent_template_mcp_http.mjs --only "very long"`; test `ADV-agent-template-13`.
* Root cause: `src/agent/mcp_http.ts:869` `http.createServer((req, res) => ...)` with no options. Fix: `http.createServer({ maxHeaderSize: 1 << 20 }, ...)`
  (or `--max-http-header-size`), matching uvicorn's "no cap" behaviour.

### AT-04  qwen standalone install creates every extracted directory with mode 0700 (Python: 0755)  (BUG, LOW)

`~/.abx/bin/qwen-code/**` directories are `drwx------` in the port and `drwxr-xr-x` in Python (`tarfile.extractall(filter="data")` keeps the member mode;
files are identical). Harmless for a single user, but a shared `~/.abx/bin` (container image layer, `sudo abx` then non-root use) becomes unusable
for other users.

* Repro: `adv_agent_template_adopt.mjs --only "env: no qwen binary" --verbose` (file tree, `~/.abx/bin/qwen-code/ 700` vs `755`); test `ADV-agent-template-08` (in-process, no network).
* Root cause: `src/agent/_archive.ts:250` `fs.mkdirSync(target, { recursive: true, mode: 0o700 })` for `dir` members, never chmod'ed afterwards. Fix: create with the
  `dataFilter` mode (`member.mode & 0o755`), or `chmod` directories after extraction like `tarfile` does.

### AT-05  `template install` of a zero-byte tarball reports "not a gzip file" instead of "empty file"  (BUG, LOW)

* Oracle: `Unexpected error: empty file` (tarfile `ReadError("empty file")`); port: `Unexpected error: not a gzip file`. A proxy/CDN returning `200` + empty body is a realistic trigger.
* Repro: `adv_agent_template_install.mjs --only "tar zero bytes"`; test `ADV-agent-template-01`.
* Root cause: `src/utils/_tar.ts:252-254` `openTarGz` checks the gzip magic (`raw.length < 2`) before the empty check that lives at `_tar.ts:134`. Fix: `if (raw.length === 0) throw new ReadError("empty file")` first.

### AT-06  `template install --registry-type local` cache path: `path.join` instead of `Path / name`  (BUG, LOW)

`--alias ../../escape` (or a `template.yaml` `name:`) is `Path`-joined un-normalised in Python (`<home>/.abx/templates/../../escape`, and `~/.abx/templates/` is created);
the port normalises (`<home>/escape`, no `templates/` dir) and an **absolute** name is re-rooted under the cache (`<cache>/tmp/abs`) where Python writes to the absolute path itself.
Observable stdout (`Cached  ...`) and file-tree differ. Security note: the *oracle* is the unsafe one here (a hostile local `template.yaml` `name: ../../../x` writes outside the cache);
the port still allows `..` escapes and only differs in normalisation. Recommend fixing both (reject names containing a path separator) and recording it as an intentional change.

* Repro: `adv_agent_template_install.mjs --only "install local cache name hostile alias"` / `"name absolute"` / `"name from yaml traversal"`; test `ADV-agent-template-02`.
* Root cause: `src/cli/commands/template.ts:1038` (`nodePath.join(registryMod.TEMPLATE_CACHE_DIR, installName)`), same at the `--dir` branch (`:1032`).

### AT-07  list-valued `template.yaml` error text  (BUG, LOW)

Python: `dict.pop(k, default)` on a list -> `TypeError: pop expected at most 1 argument, got 2`; port emulates an `AttributeError: 'list' object has no attribute 'pop'`
(wrong exception type and text; same exit code/prefix). Also reached via `template init --from`.

* Repro: `--only "local yaml list"`, `"init --from yaml list"`; test `ADV-agent-template-03`. Root cause: `src/utils/registry.ts:441`.

### AT-08  `template build` with a list-valued `name:` prints/uses the first element instead of Python's repr  (BUG, LOW)

Python formats `['a']` (`Template: ['a']`, `ACR: ns/['a']:latest`, `docker build -t ['a']:latest`); the port's template literal stringifies the array as `a`
(and the docker image tag becomes valid, so a malformed template builds instead of failing like the oracle).

* Repro: `adv_agent_template_install.mjs --only "build yaml name list"`; test `ADV-agent-template-05`. Root cause: `src/cli/commands/template.ts:751,1707` (`${templateName}` on an unvalidated YAML value; should go through `pyStr`).

### AT-09  `template init --from` / `install --dir` use `fs.cpSync` instead of `shutil.copytree`  (BUG, LOW)

* Destination inside source (`init src/dest --from src`): Python copies and finishes (exit 0, one nested level); port aborts `Cannot copy .../src/ to a subdirectory of self`.
* One unreadable source file: Python copies everything else then raises `shutil.Error` listing `[(src, dst, "[Errno 13] ...")]`; the port stops at the first failure and leaves the destination empty.
* Symlink loops: error text differs (`OS error: [('src','dst','[Errno 40]...')]` vs bare message).
* Repro: `adv_agent_template_install.mjs --only "init --from"`; tests `ADV-agent-template-06`, `-07`. Root cause: `src/cli/commands/template.ts:1032,1039,2229`.

### AT-10  `~user` adopt target  (BUG, LOW)

Python `Path("~nobody/proj").expanduser()` raises `RuntimeError: Could not determine home directory.` -> `Unexpected error: ...`; the port reports `'~nobodyxyz/proj' is not an existing directory`.
Test `ADV-agent-template-12`. Root cause: `src/utils/_pyos.ts:181` `pyExpandUser` (handles only `~` and `~/`; Python raises for an unresolvable `~user`), called from `src/cli/commands/_adopt.ts:84`.

### AT-11  STDIO: a request that completes without I/O, immediately followed by EOF, is answered only sometimes  (BUG, LOW, flaky)

`printf '<tools/call create_sandbox timeout:"x">\n' | abx mcp start`: Python always writes the validation-error response before exiting; the port writes nothing in ~5 of 6 runs
(race between the 256-microtask emulation of asyncio scheduling and the stdin `end`). Real clients keep stdin open, so only one-shot pipes are affected.

* Repro: `adv_agent_template_mcp_stdio.mjs --only "tool call then immediate eof"` (run 6 times). Not turned into a vitest because it is nondeterministic.
* Root cause: `src/agent/mcp.ts:722-732` (`settleMicrotasks` / `startTasks`) vs the `next.done` fast-path at `:755-759`. Fix: when EOF arrives, let tasks already started run to their first real await, or drain `pending` for non-I/O requests before cancelling.

### AT-12  (cross-area, `core` transport) negative per-call `timeout` is not a deterministic `ConnectTimeout`  (BUG, LOW)

STDIO `tools/call run_command {timeout:-1}`: Python -> `{"error": "ConnectTimeout"}` always; port -> `ReadTimeout` or, intermittently, a successful result. Root cause in the shared httpx shim
(`src/transport/http.ts` timeout handling, `new httpx.Timeout(effective_timeout)`); listed here because it is reachable from the MCP tools. Repro: `adv_agent_template_mcp_stdio.mjs --only "timeout neg"`.

---

## GAP-UNJUSTIFIED (not covered by `KNOWN-GAPS.md`)

* **AG-01 `.dockerignore` with a UTF-8 BOM (LOW, safe direction).** Python does not strip the BOM, so line 1 (`**/.env`) does not match and `adopt` stops with
  `.dockerignore does not exclude secret-named file(s): .env ...`; the port strips the BOM (as Docker itself does), treats `.env` as excluded and proceeds. Repro `--only "dockerignore bom"`.
* **AG-02 `template.yaml` `version: 1.0` echo (LOW).** The port's loader turns `1.0` into integer `1`, so the pydantic text reads `input_value=1, input_type=int` (oracle `1.0 / float`). Same root as AT-01 (no float-vs-int node kind). Repro `--only "yaml: version number"`.
* **AG-03 invalid-UTF-8 text in adopt/`mcp install`/`template.yaml` (LOW).** Oracle: `Unexpected error: 'utf-8' codec can't decode byte 0xff in position 101: invalid start byte` (adopt: class `Unexpected error`); port: `[E2007] Generated template.yaml could not be parsed: The encoded data was not valid for encoding utf-8` (different class/prefix, no byte/position) and, for `mcp install` env files, `'utf-8' codec can't decode bytes` without byte/position. Repro `--only "yaml: invalid utf-8"`, mcp-install `env file invalid utf8`.
* **AG-04 search-index cache stores BOM-stripped bytes (LOW).** `template search --index-url` of a BOM-prefixed index: Python caches the bytes verbatim (74 B), port 71 B. Repro `--only "search index utf8 bom"`.

---

## What held up (ACCEPTED-OK, with the evidence)

1. **Hostile tarballs** (`template install`, 49 `tar *` cases plus subdir/alias/cache re-run variants: `..` and absolute members, symlink/hardlink members, symlink-then-file-through-it, devices/FIFOs, duplicate names, file/dir conflicts, backslashes, 12 MB member, bz2/truncated/uncompressed, 300-char names, modes 000/4755): extraction results and error texts identical to `tarfile` + the oracle's filter.
2. **qwen spawn/kill/signals** (adopt): argv, `start_new_session`, stdin=/dev/null, env scrub allow-list (no `E2B_*`/`ALICLOUD_*`/`GITHUB_TOKEN` reach qwen), SIGTERM then 2 s then SIGKILL on the process group, grandchildren reaped on timeout and when ignoring SIGTERM, stream-json fallback, `--max-session-turns`, exit codes and E2007 messages: identical (grandchild liveness checked via a pid file).
3. **Adopt safety**: `stage_project` filters (skip dirs, symlinks, secret names and content incl. 64 KiB window boundaries, binaries, 1 MiB/file, 2000 files, 20 MiB), agent writes through symlinks/absolute paths/deleting project files, drift detection, `.abx-bak[.N]` numbering, `--force`, reserved-file ownership: all identical.
4. **Directory listing order.** Python's `os.walk` yields filesystem order (unsorted, differs per filesystem); libuv's `readdir` yields sorted order. The dry-run list and the prompt's file list therefore differ from the oracle on any filesystem whose native order is not sorted, but the oracle's order is not a contract. The harness sorts indented listing runs before comparing.
5. **`mcp install`**: 918/924 identical across the cursor/claude/vscode targets incl. symlinked/dangling/hard-linked configs, modes, existing nested JSON, quote/backslash/unicode/control characters in values. Remaining 6 diffs are the documented launcher, AG-03 text, recursion-limit text (`Maximum call stack size exceeded` vs `maximum recursion depth exceeded...`), and two `--output-dir` edge cases (symlink to dir: Python `OS error: [Errno 17] File exists`, port `[E4001] ... not found`; empty `--output-dir`: tmp name only). A real MCP client launch of the written config (`[execPath, abx.ts|abx.js, mcp, start]`) works end to end.
   * Observation: the config pins the absolute path of the current `node` binary and entry script; an nvm switch or `npm i -g` upgrade that moves either one silently breaks the IDE entry. (Documented gap, but worth a doc sentence.)
6. **Existing config containing a lone surrogate** (`mcp install`): Python fails with an encode error *after truncating the existing `mcp.json` to 0 bytes* (data loss); the port rewrites it. Port is safer; keep as is.
7. **`mcp start` STDIO over-long line / deep nesting**: Python drops the message following an overlong line and crashes (exit 1, `RecursionError`) on 5 000-deep JSON; the port answers an error and keeps serving. Port behaviour is better (documented).
8. **Real-client impact of the documented MCP/JSON gaps** (`id: 1.0` echoed as `1`, `-0.0`->`0`, `1E+2`->`100`; lone-surrogate ids; `Allow` header order; huge ints): JSON-RPC ids are strings or integers in every mainstream SDK and JS cannot even serialise `1.0` differently from `1`; value-equal ids correlate identically in Python/JS/Go/Rust clients. Lone surrogates are rejected by most JSON encoders and Python's own server 500s on them over HTTP. `Allow` order is unspecified in HTTP. Judged **no practical impact**; the only gap with client reach is AT-03 (header size), which is not documented.
9. **HTTP parser strictness** (llhttp vs httptools/h11): lowercase methods, `CONNECT`, `HTTP/1.2`, bare-LF and obs-fold requests, `Content-Length` + `Transfer-Encoding` together (port 400, oracle serves 200 - a request-smuggling shape), non-numeric/negative/duplicate `Content-Length`, missing `Host`: no mainstream client emits these; the port is stricter, never looser. Accepted.
10. **SIGTERM with a hung in-flight tool call**: the oracle HTTP server does not exit (harness timeout), the port exits on SIGTERM; same for the STDIO server. Port better. Hung tools do not block `ping`/`/health` on the same session in either.
11. **`mcp deploy` artifact bytes** (`app.py`, `config.yaml`, `requirements.txt`, token handling incl. `ABX_MCP_AUTH_TOKEN`, region/memory/timeout validation): identical for ~76 flag combinations (only the temp-dir name and the `--output-dir` edge cases differ).
12. **Harness-only differences that are NOT port bugs**: (a) the adopt harness strips `/usr/bin` from `PATH` (dirs holding `docker` are removed), so the port's Python-syntax gate falls to its documented lexical fallback (`KNOWN-GAPS.md` "Python syntax check"): py2 `print 'x'`, a U+FEFF BOM and >200 nested parentheses are then accepted where `ast.parse` rejects them. With `python3` on `PATH` the port rejects all three with the oracle's exact text (re-verified; this is why there is no ADV test for them). Residual risk: on a machine without Python (the port's raison d'etre) the gate is only lexical. (b) Fake-qwen `scenario.json`, `bg.pid` and the install wrapper embed per-run paths/pids and are masked.

## Suggested fix order

1. AT-01 (YAML acceptance parity) and AT-03 (`maxHeaderSize`) - the only findings with real-client or gate-strength reach.
2. AT-02 / AT-04 / AT-05 - one-line fixes each.
3. AT-06..AT-10, AG-01..AG-04 - text/semantics parity; AT-06 deserves a decision shared with the Python project (the oracle path handling is itself unsafe).

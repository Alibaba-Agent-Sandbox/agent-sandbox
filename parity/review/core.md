# Adversarial review: area `core`

Scope: `cli/src/{models,utils,transport,protocol,api,session}/**` against Python `easy_sandbox/{models,utils,transport,protocol,api,session}`.
Reviewer: independent (did not write the port). `cli/src/**` was not edited.

Placeholders: `$ORACLE_VENV` = the original Python CLI virtualenv (Python 3.11, httpx 0.28.1, pydantic 2.14.1, websockets 17.2,
python-dotenv 1.2.4, orjson; no brotli/zstandard/socksio). `$ORIG_REPO` = original repo checkout.

## Deliverables

| Kind | Path |
| --- | --- |
| Adversarial vitest, `ADV-core-NN` (51 cases, all FAIL today, each is a real divergence) | `cli/tests/adversarial/core/{pydantic_codec,transport_net,ws}.test.ts` |
| Differential: all models x ~200 hostile values, `str(ValidationError)`/`errors()`/`model_dump_json` | `cli/parity/diff/adv_core_models.mjs` |
| Differential: orjson decode/encode, Connect envelope parser with random chunkings | `cli/parity/diff/adv_core_codec.mjs` |
| Differential: raw TCP/TLS/h2 misbehaving servers, same argv through both CLIs (293 scenarios) | `cli/parity/diff/adv_core_net.mjs` |
| Differential: `WebSocketClient` vs websockets 17 against a hostile server (144 scenarios) | `cli/parity/diff/adv_core_ws.mjs` |
| Differential: base64, shlex, `_needs_shell_wrap`, python-dotenv fuzz | `cli/parity/diff/adv_core_helpers.mjs` |

Run any harness with `ORACLE_VENV=... node parity/diff/adv_core_<x>.mjs` (exit 0 identical, 1 diffs, 2 oracle absent = skipped).
Tests: `npx vitest run tests/adversarial/core`.

## Counts

* BUG: 13 (2 MEDIUM, 4 MEDIUM-LOW, 7 LOW)  -  GAP-UNJUSTIFIED: 2  -  ACCEPTED-OK: 12 (listed at the end)

## Fix status

Checked against `npx vitest run tests/adversarial/core` and, for the two remaining assertion mismatches, against pydantic 2.14.1 and websockets 17.2.

| ID | Fix status |
| --- | --- |
| CORE-01 | Fixed. `tlsTrustOptions` (`src/transport/_tls.ts`) loads `SSL_CERT_FILE` (missing file -> `[Errno 2]`, garbage -> `NO_CERTIFICATE_OR_CRL_FOUND`) and `SSL_CERT_DIR`; HTTP and `wss://` use it. `ADV-core-25..27` pass. |
| CORE-02 | Fixed. WebSocket client honours `HTTP(S)_PROXY` / `NO_PROXY` / `ALL_PROXY`. DockerBuilder PyPI wheel and ACR fetches go through `AsyncClient({trust_env})` (no silent unpinned-pip skip). `ADV-core-30`, `ADV-core-56` pass. |
| CORE-03 | Fixed. Handshake follows 301/302/303/307/308 (`ADV-core-55`). |
| CORE-04 | Fixed for the close texts the suite checks (`ADV-core-50..52`, `-54`). `ADV-core-53` still fails its frozen string: an uncompressed frame (the `ws` server has `perMessageDeflate: false`) makes websockets 17.2 say `frame with 1048577 bytes exceeds limit of 1048576 bytes`. The shorter `frame exceeds limit of 1048576 bytes` is only `PayloadTooBig(None, max_size)` on the permessage-deflate path. The port matches the library for the frame this test sends. |
| CORE-05 | Fixed. URI checks and handshake text (`ADV-core-57`, `-58`). |
| CORE-06 | Fixed. h11 leniency (`maxHeaderSize` / `insecureHTTPParser`) and `E5003` vs `E5001` mapping (`ADV-core-20..23`). |
| CORE-07 | Fixed. Non-object list bodies go through `dictGet` (`'NoneType'` / `'str' object has no attribute 'get'`). A JSON array body stays a successful list, as in `protocol/sandbox.py`. |
| CORE-08 | Fixed. Unknown proxy schemes raise `ValueError` (`ADV-core-24`). |
| CORE-09 | Fixed in the httpx URL layer (no remaining adversarial failure). |
| CORE-10 | Fixed for accept/reject and the message texts (`ADV-core-01..07`, `-09`, `-10`). `ADV-core-08` still fails its frozen loc: pydantic 2.14.1 `loc_by_alias` (default True) reports `createdAt`, and `SessionInfo.model_validate_json` does too. The port matches that; the assertion asks for the field name `created_at`. |
| CORE-11 | Fixed. `1e-7` and non-finite floats as `null` (`ADV-core-11`, `-12`). |
| CORE-12 | Fixed. Python `re` whitespace class (`ADV-core-13`). |
| CORE-13 | Fixed. Keychain list-of-pairs / NaN / `__proto__` / invalid UTF-8, and session invalid UTF-8 (`ADV-core-14..17`, `-40`). |
| GAP-A | Fixed with CORE-02. KNOWN-GAPS now says the remaining DockerBuilder difference is checkout autodetect / frozen-binary only; proxies and `SSL_CERT_FILE` are honoured. |
| GAP-B | Fixed with CORE-10. KNOWN-GAPS no longer treats those accept/reject edges as text-only. Residual: message catalogue outside the covered cases. |
* Differential volume: 26 427 model cases (52 854 comparisons), 1 079 x 4 codec documents + 303 frame streams,
  293 HTTP/TLS/proxy CLI scenarios, 144 WebSocket scenarios (~77 identical, all diffs classified above), 1 536 base64 / 1 564 shlex / 3 071 dotenv (x3 seeds) cases.

---

## BUG findings

### CORE-01  `SSL_CERT_FILE` / `SSL_CERT_DIR` are ignored  (BUG, MEDIUM)

httpx (`trust_env=True`) builds its SSL context from `SSL_CERT_FILE` / `SSL_CERT_DIR`; the Node port uses Node's default
store (+ `NODE_EXTRA_CA_CERTS`, which Python does NOT read). Corporate / self-hosted platforms with a private CA that work
with the Python CLI via `SSL_CERT_FILE=ca.pem ebx ...` fail with `[E5001] ... CERTIFICATE_VERIFY_FAILED` in the port. Also
applies to `wss://` (`ws.ts`) and to the PyPI/ACR `fetch` calls.

* Repro: `adv_core_net.mjs --filter '^t-selfsigned-(sslcertfile|sslcertdir)$'`; tests `ADV-core-25`, `-26`.
* Oracle: `status: success` ("No sandboxes found."). Port: `Failed to connect to Platform API: [SSL: CERTIFICATE_VERIFY_FAILED] ... self-signed certificate`.
* Also: `SSL_CERT_FILE=<missing>` -> oracle `[E4001] File or directory not found: [Errno 2] No such file or directory`
  (httpx raises at client creation, before any request); garbage file -> `OS error: [X509: NO_CERTIFICATE_OR_CRL_FOUND] ...`
  (`t-sslcertfile-missing`, `t-sslcertfile-garbage`, `ADV-core-27`). Port: connects and reports a cert error.
* Root cause: `src/transport/_httpx.ts` NodeTransport TLS options (`verify`/`trust_env` handling around l.1255; no `ca:`
  built from `SSL_CERT_FILE`/`SSL_CERT_DIR`); `src/transport/ws.ts:connect` passes no `ca`.
* Fix: when `trust_env && verify`, build `ca = [...tls.rootCertificates, ...readFileSync(SSL_CERT_FILE)]` (+ every file in
  `SSL_CERT_DIR`), raising `FileNotFoundError`/`OSError` texts as Python does when the path is unusable; use the same
  options object for `ws` and replace the raw `fetch` call sites (CORE-02).
* Note: Node honours `NODE_EXTRA_CA_CERTS` while the oracle does not (`t-selfsigned-nodeextra`): ACCEPTED-OK (strictly more permissive).

### CORE-02  Environment proxies are ignored by `WebSocketClient` and by every raw `fetch()`  (BUG, MEDIUM)

* `websockets` 17 (`proxy=True` default) tunnels `ws://`/`wss://` through `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`
  (honouring `NO_PROXY`); `ws` does not. Behind a proxy that blocks direct egress the PTY terminal fails in the port
  and works in Python; where direct egress is allowed the port silently bypasses the proxy.
  Repro `adv_core_ws.mjs --filter '^proxy-'` (oracle sends `CONNECT 127.0.0.1:PORT`, port connects directly); test `ADV-core-56`.
* `DockerBuilder` uses the global `fetch` (undici, no env-proxy support in Node 22.x) for the PyPI wheel download
  (`docker_builder.ts:638,657`) and for ACR `GetAuthorizationToken` (`:1116,:1156`) while Python uses `httpx.Client` with
  `trust_env`. Behind a proxy the wheel download silently fails (falls back to un-pinned `pip install`) and ACR token
  retrieval falls back to using AK/SK as docker credentials. Test `ADV-core-30` (proxy never sees `CONNECT cr.cn-hangzhou.aliyuncs.com:443`).
* Fix: route these calls through the shim's `AsyncClient({trust_env:true, timeout, follow_redirects:true})`; for `ws`
  pass an `https-proxy-agent`-style agent chosen by the same `getproxies`/`no_proxy` logic as `_httpx.ts`.
* Oracle detail: `ALL_PROXY=socks5://...` raises `Using SOCKS proxy, but the 'socksio' package is not installed` only
  because the oracle venv lacks socksio; the port ignores the variable and connects directly (`x-proxy-socks`): ACCEPTED-OK
  as an environment artefact, but note the silent bypass.

### CORE-03  WebSocket handshake redirects are not followed  (BUG, MEDIUM-LOW)

websockets 17 follows 301/302/303/307/308 on the opening handshake; `ws` is created without `followRedirects`.
Oracle: `connect:ok` after hitting `/hs/302` then `/echo`. Port: `server rejected WebSocket connection: HTTP 302`.
Repro `adv_core_ws.mjs --filter '^hs-30'`, test `ADV-core-55`. Root cause `ws.ts:109-113` (no `followRedirects: true`,
`maxRedirects: 10`). Fix: set both options (`websockets` allows 10).

### CORE-04  `WebSocketClient` close-path semantics and text  (BUG, MEDIUM-LOW)

Observed through the `ConnectionError_` message that terminal/REPL code prints, and via `recv_iter` ending behaviour:

| Scenario (server action) | Oracle | Port |
| --- | --- | --- |
| close(1000,"bye") / 1001 / 1008 / 1011 / 4000 with reason | `received 1000 (OK) bye; then sent 1000 (OK) bye` (reply frame echoes the reason) | `... then sent 1000 (OK)` (reason dropped) `ADV-core-50` |
| close(3000) | `received 3000 (registered); then sent 3000 (registered)` | `(private use)` `ADV-core-51` |
| empty close frame (1005) | `recv_iter` ends cleanly, `is_connected` stays True; `receive()` raises `received 1005 (no status received [internal]); then sent 1005 (...)` | iterator raises `WebSocketConnection lost: no close frame received or sent`, `is_connected` False `ADV-core-52` |
| frame > 1 MiB (text or binary) | `sent 1009 (message too big) frame exceeds limit of 1048576 bytes; no close frame received`; peer sees close reason `frame exceeds limit of 1048576 bytes` | `no close frame received or sent`; peer sees empty reason `ADV-core-53` |
| invalid UTF-8 text frame / bad opcode / masked server frame / 1-byte close payload / invalid close code / bad close reason | `sent 1007/1002 (...) invalid start byte at position 0 / invalid opcode / incorrect masking / close frame too short / invalid status code; no close frame received`, peer sees the same reason text | `no close frame received or sent`, empty reason `ADV-core-54` |
| fragmented message then close | `received 1000 (OK); then sent 1002 (protocol error) incomplete fragmented message` | `... then sent 1000 (OK)` |
| no pong within 2 x interval | `sent 1011 (internal error) keepalive ping timeout; no close frame received` | `received 1011 (internal error) keepalive ping timeout; then sent 1011 (internal error)` |

* Repro: `adv_core_ws.mjs --filter '^(close-|big-|bad-|invalid-|masked-|frag-|no-pong)'`.
* Root cause `ws.ts:53-59` (`closeText`: no reason echo, no 3000-3999 "registered", 1005 mapped to "no close frame"),
  `ws.ts:169` (`clean = code === 1000 || code === 1001`; websockets' `OK_CLOSE_CODES` also contains 1005), `ws.ts:179-184`
  (keepalive text), and the `ws` limits (`maxPayload`) are surfaced by `ws` as close 1009 with an empty reason.
* Fix: reproduce `websockets.frames.Close.__str__` (code names incl. "reserved"/"registered"/"private use", reason suffix,
  `; then sent` / `; no close frame received`), pass the same close reason strings when failing the connection
  (`ws` lets the receiver choose the reason only via custom `WebSocket` subclass: set `ws._receiver` error hooks or
  validate size/UTF-8/opcode on `message` events), treat 1005 as OK.

### CORE-05  WebSocket connect error text / validation  (BUG, LOW)

* URL validation: `http://x`, `https://x`, `127.0.0.1:1/x`, `""`, `ftp://x` -> Python
  `<uri> isn't a valid URI: scheme isn't ws or wss`; `ws://` / `wss:///x` -> `hostname isn't provided`; fragment ->
  `fragment identifier is meaningless`; port out of range -> `Port out of range 0-65535`; non-numeric port ->
  `Port could not be cast to integer value as 'abc'`. Port: `Invalid URL`, `The URL's protocol must be one of ...`, or an
  actual connection attempt (`http://127.0.0.1:1` -> `[Errno 111]`) (`ADV-core-57`).
* Handshake: bad `Sec-WebSocket-Accept` -> `invalid Sec-WebSocket-Accept header: AAAA`; missing Upgrade -> `missing Upgrade header`;
  101 without proper headers -> `invalid Connection header: close`; non-HTTP bytes / early close -> `did not receive a valid HTTP response`
  (port: `Parse Error: Expected HTTP/`, `All connection attempts failed`; `ADV-core-58`); `ws://` to a TLS port or any
  malformed reply likewise. `localhost` refused -> `Multiple exceptions: [Errno 111] Connect call failed ('::1', 1, 0, 0), ...`
  vs port's single IPv4 text; IPv6 literal -> `('::1', 1, 0, 0)` vs `('::1', 1)`.
* TLS: `_ssl.c:1016` vs `_ssl.c:1006`; `wrong version number` surfaces as `[SSL] write EPROTO C07C...:error:0A00010B:...` instead of
  `[SSL: WRONG_VERSION_NUMBER] wrong version number`. Same family for the httpx shim (`t-tls-oldproto`, `t-wrong-host`:
  `Hostname mismatch` vs `IP address mismatch`).
* Header validation: `\r\n` in an extra header -> `invalid X-Adv header: a\r\nInjected: 1` vs Node's `Invalid character in header content`;
  an extra `Sec-WebSocket-Protocol` -> `no subprotocols supported` vs `Server sent a subprotocol but none was requested`.
* Fix: add a message-mapping layer (like `connectErrorText`) in `ws.ts`; validate URL up front with the websockets rules.

### CORE-06  httpx shim: response-parse strictness and error classification differ from h11  (BUG, MEDIUM-LOW)

Node's llhttp is strict where h11 is lenient, and the shim then reports a different class (`ReadError` instead of
`RemoteProtocolError`), which flips the CLI error code `E5003` -> `E5001` and the suggestion text.

* Requests that SUCCEED in Python but FAIL in the port: header block > 16 KiB (h11 accepts up to 64 KiB;
  Node `maxHeaderSize` default 16 KiB: `Parse Error: Header overflow`), bare-LF line endings, `Transfer-Encoding` +
  `Content-Length` together, obsolete folded header lines (`ADV-core-23`; `adv_core_net.mjs` `p-bighead`, `p-http11-bare-lf`,
  `p-te-and-cl`, `p-header-folded`).
* Same failure class, different text/code: garbage status line (`illegal status line: bytearray(b'garbage')`, E5003) vs
  `Parse Error: Expected HTTP/` E5001 (`ADV-core-20`); lower-case `http/1.1`, status 99/1000, duplicate/negative/invalid
  Content-Length, header w/o colon or with space before colon (`illegal header line: bytearray(b'...')`, `conflicting Content-Length headers`, `bad Content-Length`, ...);
  `HTTP/1.1 101` without a pending upgrade -> Python `Received server _SWITCH_UPGRADE event without a pending proposal` (E5003) vs port
  `Request timed out` (E3001).
* TCP RST before any byte: Python `ReadError('')` -> `[E5001] Connection error:`; port `RemoteProtocolError: Server disconnected without
  sending a response` -> `[E5003]` (`ADV-core-21`, also streaming `e-reset-mid` and upload `up-resp-reset-after-read`).
* Body-length mismatch text: `(received 2 bytes, expected 10)` vs `(incomplete chunked read)` (`ADV-core-22`);
  chunk-size garbage -> `illegal chunk header: bytearray(b'ZZ\r\n')`; gzip errors `Error -3 while decompressing data: incorrect header check`
  vs `incorrect header check`, truncated gzip, `Content-Encoding: x-gzip` (Python: not decoded -> JSON error; port: decodes), trailing garbage after a gzip stream, double gzip.
* Root cause: `src/transport/_httpx.ts` `NodeTransport.handleAsyncRequest` (~l.1281) error mapping and default `http.request`
  options.
* Fix: `http.request({ maxHeaderSize: 65536, insecureHTTPParser: true })` (accepts bare LF / folded headers; note the
  duplicate Content-Length / TE+CL cases then need explicit checks), and map `HPE_*` / `ECONNRESET`-before-first-byte to the h11
  texts (table in `adv_core_net.mjs`).

### CORE-07  Non-object JSON bodies are treated as success  (BUG, LOW)

Platform returns `null` / `"str"` as the list body: Python `Unexpected error: 'NoneType' object has no attribute 'get'` /
`'str' object has no attribute 'get'` (exit non-zero); port prints `No sandboxes found.` (success). UTF-16 JSON bodies
(`json.loads(bytes)` detects UTF-16/32) are rejected by the port; deeply nested bodies and invalid UTF-8 bodies give a
validation error instead of `maximum recursion depth exceeded while decoding a JSON array from a unicode string` /
`'utf-8' codec can't decode byte 0xff in position 2: invalid start byte`; `NaN` literal body -> Python accepts then
`model_type` error (input_value=nan) vs `Expecting value`; invalid JSON key quote -> `Expecting property name enclosed in double quotes` vs `Expecting value`.
Repro `adv_core_net.mjs --filter '^p-body-'`. Root cause: `codec.ts json_decode` + `api/sandbox.ts` list handling (`resp.json()` result is not checked with `.get` semantics).

### CORE-08  Proxy URL scheme validation  (BUG, LOW)

`HTTP_PROXY=ftp://h:1` -> Python `ValueError: Unknown scheme for proxy URL URL('ftp://h:1')` (`Unexpected error: ...`); port ignores the
variable and connects directly (`x-proxy-ftp`, `ADV-core-24`). `NO_PROXY` pattern `*.sub.domain` handling and DNS vs connect text differ
(`x-no-proxy-wildcard-sub`); CONNECT tunnels send `Accept: */*` (Python) vs `Connection: close` (port), proxy closing the tunnel
-> E5003 vs `All connection attempts failed` (`x-https-proxy-connect*`). Root cause `_httpx.ts` proxy selection.

### CORE-09  API URL shape handling  (BUG, LOW)

Differences for odd `E2B_API_URL`/`api_url` values (`adv_core_net.mjs --filter '^u-'`, `e-envd-url-garbage`):

* scheme-less / host-only: `Request URL is missing an 'http://' or 'https://' protocol.` vs `Invalid URL "..."`
* `http://127.0.0.1:99999`: `unhandled errors in a TaskGroup (1 sub-exception)` vs `Invalid URL`
* `http://a b:80`, `http://`, `http:`: `[E5001] Failed to connect to Platform API: [Errno -2] Name or service not known` vs `Unexpected error: Invalid URL`
* `ws://host`: accepted by httpx (request made) vs `Request URL has an unsupported protocol 'ws://'`
* URL with userinfo: httpx turns it into `Authorization: Basic ...` replacing the Bearer header; port keeps Bearer
* URL with a query string: path/query composition differs (`GET /?limit=20&offset=0` vs `GET /sandboxes?limit=20&offset=0`).

Root cause `_httpx.ts URL_` parsing / `HttpClient` URL building. Low impact (operator misconfiguration only).

### CORE-10  Pydantic emulation: texts and a few accept/reject decisions  (BUG, LOW)

`adv_core_models.mjs` (26 427 cases) leaves exactly these categories (`--ignore-input-value --groups`), all frozen in `ADV-core-01..10`:

1. `input_value` is truncated by UTF-8 **bytes** with `floor_char_boundary(25)` / `ceil_char_boundary(len-24)` on the *repr*
   (quote included): 40 x `é` prints `éééééééééééé...ééééééééééé` in Python, untruncated in the port; ASCII tail is 23 chars in Python, 24 in the port.
   Root cause `src/models/_pydantic.ts:63-67`.
2. int field: `"5."` is rejected (`int_parsing`) but accepted by the port; `1e+21` -> `int_parsing_size`, port accepts / reports a range error (`:356`).
3. bool field with float `2.5`: `bool_type` (`Input should be a valid boolean`), port `bool_parsing` (`:401,:407`).
4. float field `"1_000"` accepted (-> 1000.0), port `float_parsing` (`:377`).
5. datetime: `"+5"` accepted (unix 5 s); `2024-01-01T24:00:00Z`, `...T10`, `+24:00` give `unexpected extra characters at the end of the input` (port: hour/second range, `input is too short`, or accepted) (`parseDatetimeString`, `:199`).
6. JSON-mode messages: `Input should be an object` / `a valid array` for dict/list/model in `model_validate_json` (port uses the python-mode `dictionary`/`list` texts, `:456,:476`; only `model_type` is JSON-aware, `:629`).
7. `Invalid JSON:` detail text: `EOF while parsing an object`, `trailing comma`, `trailing characters`, `key must be a string`, `invalid number`, `invalid escape`,
   `expected ident`, BOM -> port reuses V8-style `expected value` / `EOF while parsing a value` (`jsonErrorText`, `:698`). Reachable through a hand-corrupted session file only.

KNOWN-GAPS already says the catalogue is not complete; the items above are the ones that differ for *reachable* inputs (server JSON, `template.yaml`, config files), so the "harmless" claim holds only for texts, not for #2/#4/#5 acceptance.

### CORE-11  `json_encode` is not orjson for exponents / non-finite floats  (BUG, LOW)

`json_encode({c:1e-7})` -> `{"c":1e-07}` (orjson `1e-7`); `Infinity`/`NaN` -> `Infinity`/`NaN` literal (orjson `null`; invalid JSON on the wire).
`ADV-core-11`, `-12`; `adv_core_codec.mjs`. Also (documented-gap family): ints > 2^53 lose precision, ints beyond 64-bit do not raise
`TypeError: Integer exceeds 64-bit range`, `1.0`/`-0.0` print as `1`/`0`, integer-like keys reorder. Root cause `codec.ts:26` (`json_encode`).
Any CLI option that forwards a user float (`--timeout inf`) can put `Infinity` in a request body; not verified end to end.

### CORE-12  python-dotenv whitespace class  (BUG, LOW)

Python `re` `\s` matches `\x1c-\x1f`, `\x85`, not `\ufeff`; JS `\s` is the opposite. Oracle: `A\x85=1` -> `{A: 1}`, `\x1cA=1` -> `{A:1}`,
`A\ufeffB=1` -> key `A\ufeffB`; port: key `A\x85`, `\x1cA`, and `A\ufeffB=1` is a parse error. `ADV-core-13`;
`adv_core_helpers.mjs --only dotenv` (3 071 x 3 seeds identical once these chars are removed). Root cause `src/utils/_dotenv.ts:26,30,122`.
Fix: replace `\s` by `[ \t\n\r\f\v\x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`.

### CORE-13  SecretStore / LocalSessionStore corner cases  (BUG, LOW)

* `secrets.json` = `[["a","1"]]` or `[]`: Python `dict(...)` works; port throws. `{"a": NaN}`: Python accepts; port treats the file as `{}`
  and the next `set` overwrites it (silent data loss). Secret named `__proto__` is lost (plain object). Invalid UTF-8 file: Python raises
  `UnicodeDecodeError`, port returns U+FFFD text. File key order with integer-like names differs (documented family).
  `ADV-core-14..17`; `keychain.ts:_load_file`, `_get_file`.
* Session store (library only; no CLI command constructs it): invalid-UTF-8 session file -> Python skips it in `list_all` and raises in
  `load`; port loads it with U+FFFD (`ADV-core-40`, `local.ts:99,131`). `sorted(Path)` is by code point, port by UTF-16 unit (astral vs U+E000-U+FFFF names).

---

## GAP-UNJUSTIFIED

* **GAP-A  DockerBuilder release wheel path uses bare `fetch`** (KNOWN-GAPS "DockerBuilder"): beyond the stated checkout/frozen
  difference, the download ignores proxies and `SSL_CERT_FILE` (CORE-01/02) and so silently degrades to an un-pinned `pip install` in exactly the
  networks where Python succeeded via `trust_env`. Fix with CORE-02.
* **GAP-B  "pydantic: error text matches for covered cases"**: acceptance differences (CORE-10 #2, #4, #5) change control flow, not only text.

## ACCEPTED-OK (differs, harmless)

1. `Accept-Encoding: gzip, deflate, br` (Python without brotli sends `gzip, deflate`); the port decodes br; servers only see a superset.
2. `NODE_EXTRA_CA_CERTS` honoured (Python ignores it).
3. `User-Agent` `ebx-node-httpx/0.28.1` vs `python-httpx/0.28.1` (already in KNOWN-GAPS; request logs normalise it).
4. HTTP/2: the shim negotiates h2 via ALPN like httpx `http2=True` (`t-h2-only-server` identical); connection-pool limits not reproduced (KNOWN-GAPS).
5. Retry/backoff: all `429`/`5xx` + `Retry-After` combinations (`p-status-429-*`, 5xx e-*) are identical in request count and timing (see "held up").
6. File locking: `.lock` + `mkdir .lock.d` instead of `flock`. Caveats to remember: (a) after `kill -9` a *fresh* `.lock.d` blocks the next
   operation for up to 5 s whereas `filelock` never blocks; (b) Python and Node processes sharing `~/.ebx/sessions` are not mutually exclusive
   (different lock primitives); (c) two processes recovering the same stale lock can both pass (`local.ts:45-52`, remove-then-`continue`
   without re-check). The store is library-only (no CLI path), so impact is nil today.
7. `x-gzip` / gzip edge text (see CORE-06) are also unreachable in practice.
8. TCP connect failures collapse to `All connection attempts failed` (KNOWN-GAPS), identical in `p-refused`, `e-refused`.
9. Float/int distinction (`1.0` vs `1`), integer-like key ordering, ints > 2^53 (KNOWN-GAPS).
10. `base64` `binascii` emulation: confirmed exact (1 536 random + 35 fixed cases, incl. non-ASCII `ValueError` text).
11. SOCKS proxy env vars (oracle venv lacks `socksio`; with it Python would honour them): ignoring is an environment artefact but see CORE-02.
12. Yaml 1.1 emulation, FC SDK 1.5.1 vs 1.6.0, unported `deploy.py`/SyncVariants: outside this slice's runtime paths; spot checks showed no core-level fallout.

## What held up (attacked and identical to the oracle)

* Models: 26 427 mutated cases (every field/alias x ~200 hostile values, nested models, unions, enum fallbacks, aliases, extras, unicode, huge/negative/NaN,
  python and JSON mode) -> only the CORE-10 categories differ.
* Connect/SSE framing: `parse_streaming_frames` / `EnvelopeStreamParser.feed` on 303 frame streams with random chunk splits: 0 diffs;
  `json_decode`/`decode_response`/`decode_streaming_frame` on 1 079 hostile documents: 0 diffs after known-gap filters (depth limit, UTF-8 text).
* HTTP: redirects 301/302/303/307/308 (limit, method rewrite), 100-continue, 103, HTTP/1.0 close-delimited, missing reason phrase, 429 `Retry-After`
  matrix, slow trickle bodies, hung head/body timeouts (`SANDBOX_HTTP_TIMEOUT`), partial heads, refused/DNS errors, Latin-1 headers, BOM/charset
  decoding, duplicate JSON keys, big ints, lone surrogates, unknown/uppercase/identity/zstd `Content-Encoding`, proxy env precedence
  (`http_proxy` vs `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY` exact/suffix/star/port/IP/CIDR/spaces), self-signed cert failure text, TLS hang in handshake,
  upload and download paths (multipart boundary normalised) - 230/293 scenarios byte-identical, the rest are listed above.
* WebSocket: echo text/binary/empty/1 MiB/unicode, custom/overriding headers, query, userinfo, ping flood, ping/pong keepalive timing (1 s interval),
  receive timeout, send/receive before connect and after close, abrupt close / RST, handshake 4xx/5xx/non-HTTP, wss self-signed failure, wss trust via CA env -
  ~77 of 144 scenarios identical (the remainder are CORE-03/04/05 and the proxy cases).
* shlex split/quote/join/`_needs_shell_wrap`/punctuation tokens (1 564 cases), base64 (1 536), dotenv (9 000+ cases apart from CORE-12), github token
  resolution and the retry helper (code-read line by line; no divergence found, backoff covered by the 429 matrix), `json_encode` of plain values, session `_path_for` sanitising.
* Build-arg secrecy: `_redact_build_args` log rewriting and `--password-stdin` for `docker login` match (code-read; `template_cmds.mjs` covers the
  fake-docker runs).

## Not covered / follow-ups for the coordinator

* ACR `GetAuthorizationToken` error text (`str(data)` repr vs `JSON.stringify`, non-JSON error body -> `JSONDecodeError` text) was found by code reading only; the endpoints are
  hard-wired to `aliyuncs.com` over TLS, so it needs a MITM proxy harness.
* `--timeout inf` / non-finite floats reaching request JSON (CORE-11) was not driven through the CLI.
* Cross-implementation stale-lock behaviour (Python holding `flock` while Node runs) is untested.

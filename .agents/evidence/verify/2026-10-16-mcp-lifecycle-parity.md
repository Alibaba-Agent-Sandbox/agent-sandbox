# Verification: CLI MCP lifecycle parity

- Date: 2026-10-16
- Change: shared MCP lifecycle handlers and CLI catalog/evidence, based on
  `c269603177ffa7a4fd5b6b7cd43aca1b57b2bad1` with the reviewed lifecycle patch.
- Result: PARTIAL — real-cloud acceptance passed; repository-wide test and health
  gates have unrelated failures which remain blocking.
- Binary: built Node CLI 0.3.0; Node 22.22.2 on Linux.
- Environment: authorized Alibaba Cloud Express credentials supplied only through
  process environment. Credential values, raw provider payloads and sandbox IDs
  are omitted from this record. Existing resources were not modified or deleted.

## What was verified

The real-cloud test starts separate owning and observing CLI STDIO processes and
exchanges JSON-RPC requests. All 14 checks passed: lifecycle catalog, missing
default rejection, unsupported account selector rejection, creation with CPU and
memory, safe metadata allowlist, account list visibility, external ID inspection,
external ID TTL update, observer EOF preserving the instance, default TTL update,
file write/read, command output `42`, explicit destruction, and finally cleanup
with readonly list confirmation that the owned ID is absent.

Only the documented eventual consistency of account listing is retried. No Docker
build, template deployment, other provider cloud or IDE acceptance is inferred.

## Commands and results

| Command | Result |
| --- | --- |
| `make test` | FAIL: 3739 passed, 29 failed, 57 skipped across 154 files; see limitations below |
| `make lint` | PASS with existing warnings; no errors |
| `make typecheck` | PASS after fixing the lifecycle test mock's explicit `Promise<void>` return type |
| `make build` | PASS |
| Focused lifecycle/MCP/HTTP/CLI and golden tests | PASS: 301 tests before the final install/oracle follow-up; final rerun recorded below |
| `ABX_UPDATE_EVIDENCE=1` CLI evidence snapshots | PASS: 110 cases; regenerated status and install outputs reviewed |
| MCP evidence capture via its Vitest config | PASS: 3 cases, no skips |
| `node e2e/mcp-lifecycle.mjs` | PASS: 14 real-cloud checks, including cleanup |
| `bash scripts/check-repo-health.sh` | FAIL: repository baseline issues documented below |

Local npm commands reused the previously installed npm 10.9.4 executable. No
lockfile or installed dependency was changed.

## Cleanup

The test destroys exactly its own created sandbox ID, including on exceptions.
After successful explicit destruction, a readonly platform list confirmed that
ID was absent. Both local STDIO processes were stopped and their temporary
configuration directories removed. Arbitrary account instances and templates
were never destroyed.

## Failures and limitations

The initial full-suite run caught four lifecycle-related expectations: HTTP tool
count, two CLI status snapshots and the historical Python JSON catalog oracle.
Those catalog expectations were corrected; the historical oracle fixture was preserved, and its test
still checks exact JSON envelope/number bytes and all unchanged tool schemas.
The install command's printed tool list was also updated to match all ten tools.

The other 25 failures occur outside the changed lifecycle behavior: archive
extraction permissions; HTTP large-header/trailing-slash/connection-refusal
behavior; eleven template-install fixture assertions; FORCE_COLOR warning;
transport parsing/TLS/proxy tests; and WebSocket error/proxy semantics. Some local
network assertions received platform HTTP 501/502 responses. Denied network paths
were not retried or bypassed. This record does not claim those failures were fixed,
nor that all are proven pre-existing in an independent baseline run.

Repository health reports missing runnable examples, historical broken links and
missing ADR slugs, historical local path strings, and existing EN/ZH provider
documentation asymmetry. These were not expanded into unrelated cleanup.

Unit/mocked tests prove ownership, races and privacy behavior; the real-cloud
STDIO run proves this lifecycle workflow. Real Streamable HTTP cloud lifecycle,
IDE integration, Node 20 matrix, other providers and container deployment remain
unverified. The PR must remain a draft while mandatory gates are unmet.

## Final follow-up results

- Focused unchanged MCP/HTTP/lifecycle/CLI/golden run: 301 passed.
- Final run including the historical Python JSON oracle: 238 passed, one failed.
  The catalog compatibility checks pass; a later unchanged `run_code` case
  expected a refused-connection error but received a disconnected-response error
  from the loopback test environment. The error expectation was not weakened.
- `npm run check:hygiene`: PASS.
- Repository health: 94 passed, five warnings, ten failures, all described above.
- Install evidence now lists all ten tools and uses sufficient alignment width.

## Cross-review correction: direct control-plane dispatch

A reviewer found that external inspection used `Sandbox.connect`, which can invoke
resume through the catalog E2B/Cube adapters. The earlier Express acceptance did
not cover those provider semantics. The core now exposes direct `getInfoById` and
`setTimeoutById` APIs, and external MCP IDs dispatch through them. Temporary
infrastructure closes in `finally`; provider connect/create/kill is never called.
Paused provider metadata remains paused. Managed operations keep their existing
handles, and late TTL completion after shutdown cannot restore session state.

The core provider/built-in no-connect regressions plus MCP/HTTP/CLI/golden and
existing sandbox API tests passed: eight files, 361 tests. Typecheck and build
passed. The corrected binary reran the real CLI STDIO workflow: all 14 checks
passed again, including external observation/TTL, observer EOF preserving the
instance, owned destruction and final readonly absence confirmation. This remains
Express-only cloud evidence; E2B/Cube coverage here is protocol-spy regression.

The E2E harness now resolves credential configuration once and uses that same
configuration for child CLI processes and parent SDK fallback cleanup. Ignored
file credentials therefore cannot silently select a different cleanup account.

Post-review lint has zero errors and 221 repository warnings; changed-file lint
passes without warnings. Hygiene and configured-secret/diff scans pass. The full
repository test result above predates the no-resume follow-up; all eight relevant
files (361 tests) and the real 14-check workflow were rerun after that core change.
The known failing repository-wide/network gates were not repeatedly rerun or
bypassed. Verification was captured before draft delivery; no merge is implied.

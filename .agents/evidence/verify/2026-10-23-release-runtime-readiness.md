# Verification: release runtime readiness

- Date: 2026-10-23
- Change: release-runtime-readiness; base 475848c
- Result: BLOCKED (full suite/environment, cloud and remote gates)
- Package: @agent-sandbox/cli 0.4.10 source candidate (not published)
- Environment: Linux, Node 22.22.2, npm 12.0.2. No cloud credentials supplied.

## What was verified

Runtime compatibility, explicit contract skip reporting, real local engine initialization,
SSE backpressure, MCP version and shipped Skill reference closure. A temporary local-disk
mirror used the exact Git base, current diff and untracked candidate files; byte equality
of all changed source/test/docs was checked. This avoids mounted-filesystem delays (a
simple CLI invocation took 28 seconds there versus under a second on local disk).
CI fixtures were archived at Python 270a7a8fa72656653b485403273491fd99aeefc8 and provider
catalog de4fbf647966459feb57a35ab590b938024abe0e, matching this base's workflow.

## Commands run

- `npm ci --no-audit --no-fund`
- `npm run typecheck`; `npm run build`; `npm run lint`
- `npx vitest run tests/test_engine/test_initialize.test.ts tests/test_engine/test_sse_backpressure.test.ts tests/test_providers/test_runtime_loading.test.ts tests/test_providers/test_contract_kit.test.ts tests/test_agent/test_mcp.test.ts tests/test_skill_installation_docs.test.ts`
- `npx vitest run tests/test_agent/test_mcp_http_wire.test.ts tests/test_cli/test_package_entry.test.ts`
- `npm test -- --reporter=json --outputFile=parity/.vitest-report.json`
- `npm run parity:coverage` (also executes the two integration files omitted by npm test)
- `npm run e2e:offline` with ABX_BIN set to the built entry point
- `bash scripts/check-repo-health.sh`; `npm run check:hygiene`; `make dist-check`
- Skill Creator `quick_validate.py .` in an isolated PyYAML tool environment
- Built `node dist/bin/abx.js mcp start`, JSON-RPC initialize and tools/list over stdin,
  then EOF; parsed stdout and asserted exit status, version and tool count.

Full-suite runs used ABX_AWESOME_PROVIDERS, ABX_SERVER_SDK_SRC and PYTHON_SDK_ROOT
pointing to the pinned fixtures above. The final run unset HTTP_PROXY, HTTPS_PROXY,
ALL_PROXY and their lowercase equivalents; the failures below still occurred.

## Results

| Check | Result | Scope |
| --- | --- | --- |
| Lockfile install | PASS | npm 12 warned that openapi-core/esbuild install scripts were blocked; build and local runtime checks passed |
| Typecheck/build | PASS | Current candidate source |
| ESLint | PASS | 0 errors, 275 pre-existing warnings |
| Focused runtime/Skill suite | PASS | 75 tests, including real HTTP and ES module loading |
| MCP wire/package gate | PASS | 21 tests, including missing Skill resource rejection |
| Full npm test with pinned fixtures | FAIL / environment blocked | 4177 passed, 20 failed, 2 skipped |
| Parity command's complete vitest run | FAIL / environment blocked | 4203 passed, 20 failed, 2 skipped; additional 26 integration cases passed |
| Parity ledger | PASS | 907/907, no missing/failed ledger entries; 11 Python moves verified. This does not erase full-suite failures |
| Full offline E2E after fixture repair | PASS | 81 passed; 1 leak-check skipped because no cloud resource was created |
| Built MCP stdio smoke | PASS | serverInfo.version 0.4.10, 21 tools, valid JSON stdout, EOF exit 0 |
| Health/hygiene | PASS | Health 106 passes, 11 registered historical warnings, 0 failures |
| Npm content gate / Skill validator | PASS | CLI entry and transitive local Markdown Skill references shipped; Skill valid |
| Cloud E2E | BLOCKED | No credentials; local checks are not cloud evidence |
| Remote CI/review | BLOCKED | No authenticated GitHub transport in environment |

## Baseline comparison and repairs

The 20 final suite failures have exactly the same test-name set on unchanged base
475848c (six affected files: 39 passed, 20 failed). They involve loopback envd,
foreign-Host requests, low-level HTTP/TLS/proxy behavior and WebSocket error text.
Several receive HTTP 501 with the managed environment's message that project network
auditing is disabled; malformed-response tests receive intermediary 502 responses.
No product transport or test assertion was weakened to hide these failures. Required
CI must rerun them in its normal environment.

The original offline suite also failed five cases on unchanged base 475848c. Its
fixtures still advertised retired max_retries, expected an old numeric error phrase,
omitted catalog schema_version, used retired catalog capabilities, and omitted the
mandatory provider operation/workflow declarations. Fixtures now use current contracts;
all original behavior checks remain, and config additionally rejects retired max_retries.
The five repaired cases passed individually and the complete offline suite then passed.

Initial new regressions were adapted to main's operation/workflow contract after fixture
validation failed. Those exploratory failures are not counted as passes. MCP exact-wire
expectations now use the actual package version rather than historical 0.3.0.

## Cleanup

Local loopback engines are closed in finally/afterEach. Offline E2E reports created=0,
leaked=0 and cleans its temporary HOME/files. No cloud resources were created; this is
not a claim of cloud inventory verification. No package was published.

## Not verified

Real cloud E2E, Node 20 remote matrix, release publication and remote merge. The
repository definition of done requires applicable gates before completion; the ADR
remains proposed. Python consumers of the new initialization endpoint must land after
this CLI host capability; old engines must return an explicit unsupported result.

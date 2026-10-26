# Verification: live CLI/MCP resources, durable tasks and parallel work

Result: PARTIAL overall; supported core task workflows PASS; explicit resource mismatch defect fixed and verified against the cloud.

Base revision: `2e32256acdd45eab026c5b1d71e4e886df4c0f77` (`0.5.6`), plus the exact local files in [tested-files.json](2026-10-26-cli-live-resource-verification/tested-files.json). Runs used real Alibaba Express control/data planes, Node 22, the built CLI, an actual coding agent loading `SKILL.md` and its workflow references. No mocked cloud responses were used for the live assertions. This is a single bounded acceptance run, not a statistical reliability claim.

## Inputs, returned values and independently observed effects

| User capability / actual input | Returned result | Independently observed effect | Result |
| --- | --- | --- | --- |
| Create `base`, lifetime 360, CPU 1, memory 1024 | Originally a running ID | Separate metadata showed CPU 2 / memory 2048. The backend used template resources; requested override was not applied | FAIL before fix |
| Same mismatching create after fix | MCP `isError: true`, `category: resource_configuration`, requested/observed resources, `cleanup_verified: true` | Separate `get_sandbox` after rollback also returned not found | PASS regression |
| Create test-owned template `a9bmaim1kx6zsjmetxel` with CPU 1 / memory 1024 | Running sandbox | Independent metadata confirmed CPU 1 / memory 1024; template owner separately built and owns template cleanup | PASS supported path |
| `list_sandboxes`; `get_sandbox` | Real IDs and safe metadata | The exact created resource appeared in a bounded 30-second poll; immediate list can lag | PASS |
| `set_sandbox_timeout`, 480 seconds | Request accepted, timeout metadata unknown | Separate `get_sandbox.end_at` showed about 478 seconds remaining; no invented timeout metadata | PASS effect; metadata omission explicit |
| `verify_sandbox`; `upload_file` synthetic 102400-byte binary; `download_file` | Verified checks and SHA-256 | Independent remote `sha256sum` and re-read delivered local bytes both matched `27783e87963a4efb6829b531c9ba57b44f45797f6770bd637fbf0d807cbdbae0` | PASS |
| Start Python task, end MCP process, start a new process and `get_task` by original IDs | Original state/logs, exit 0 | Original task finished; downloaded and parsed actual JSON `{ "count": 3, "total": 70 }`, including integer type checks | PASS |
| Start heartbeat loop, `cancel_task`, poll terminal state | `cancelled` | Independent heartbeat line counts stayed fixed across separate reads | PASS |
| Run Python `ValueError`, bounded memory exhaustion, timeout, then access deleted sandbox | Nonzero remote exit, `MemoryError`, execution timeout error, missing-sandbox error | Code traceback and exit are distinct from transport/expiry; a 64 MiB per-process address-space limit caused `MemoryError`, and sandbox subsequently ran `printf still-alive` | PASS; real sandbox-wide OOM not induced |
| Three concurrent same-template creates and tasks, one deliberate exit 7 | Three independent task results: `[0,7,0]` | Success resources deleted; failed resource and worker marker survived connection restart for diagnosis, then were explicitly deleted | PASS |
| Install Cursor MCP configuration in isolated HOME and launch generated command | Config points at executable CLI; discovered 21 tools | The actual generated command authenticated, created a short-lived sandbox and ran Python `6*7`, yielding `42` | PASS |
| Invalid key with both relevant credential aliases overridden | Authentication failure | No successful cloud operation under the invalid credentials | PASS after correcting harness alias handling |
| `run_code` on Express | Typed provider feature unsupported error | Express has no verified interpreter protocol; Python execution through `run_command` and durable tasks was actually verified | UNSUPPORTED specialized interpreter, supported command path PASS |

Machine-readable [events](2026-10-26-cli-live-resource-verification/events.jsonl) preserve failed attempts, returned values and later assertions. Delivered [binary](2026-10-26-cli-live-resource-verification/binary-downloaded.dat) and [task JSON](2026-10-26-cli-live-resource-verification/task-result.json) are actual downloaded artifacts, not reconstructed expected data.

## Harness corrections, retained failures and limitations

- Early harness attempts used obsolete global `--json` for standard commands; actual current help requires `list --format json` / `template list --format json`. These are harness failures, not product regressions.
- Direct module entry loads `E2B_API_KEY`; `abx mcp start` uses its configured ABX credential path. Initially changing only one alias left another valid key, so those negative checks were invalid. Repeating with both aliases invalid rejected authentication. No authentication bypass was established. Final supported workflows used canonical `abx mcp start`.
- Concurrent canonical MCP launchers have separate isolated HOME directories to avoid the CLI's deliberate single-server pid-slot guard. An initial shared-HOME launcher conflict and an incorrectly quoted error snippet are retained as harness failures.
- Team is selected by the actual runtime credential. Unknown create `team_id` is rejected. This run did not switch between two independent Team credentials or verify cross-Team isolation.
- Runtime region metadata is omitted by the backend and remains null. The configured regional endpoint was used; a distinct-region deployment was not claimed.
- The custom-resource path requires a matching template. Runtime CPU/memory overrides on `base` remain unsupported backend behavior; the MCP now detects and rolls them back. Node/Python public client resource semantics outside this MCP tool were not changed.
- `run_code` requires a provider with an implemented interpreter transport. A typed unsupported error is not interpreter E2E success.

## Local checks actually executed

- `npm exec -- vitest run tests/test_agent/test_create_resources.test.ts tests/test_agent/test_mcp_lifecycle.test.ts tests/test_agent/test_tools.test.ts`: PASS, 3 files / 36 tests.
- `npm run typecheck`: PASS after correcting a regression-test constructor argument.
- `npm run build`: PASS.
- The coordinating task owns full-repository tests, lint, health/hygiene and remote CI evidence; they are not silently claimed here.

## Cleanup

Every exact ID from all 14 successful creates across the exploratory and final runs was independently queried after cleanup and returned missing. The resource-mismatch rejection's additional newly created ID was separately confirmed missing after automatic rollback. Only test-created resources were deleted; baseline lists recorded counts without adopting or deleting unrelated resources. Test templates are owned and cleaned by the template acceptance task. No `kill --all` was used.

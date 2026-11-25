# Named status and JSON execution verification

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/276

Baseline: `b095ab0001f40f1f148e0552d0bdbc378eae11fd`. This evidence covers the bounded status and process-output fixes, not the separate template build/deploy/create migration.

## Observed defects

- A saved `ready` Sandbox deployment still printed `status: ready` when the saved remote ID returned typed `SandboxNotFoundError`. A remotely paused instance also retained the top-level `ready` label.
- Non-Express `exec --stream --json` printed raw stdout before its JSON result and raw stderr separately. A stream with no exit event, or a null exit code, defaulted to success.

The initial regression run failed the status, JSON-shape and capture-limit assertions on the baseline. Two initial parameterized test cases had a test-fixture tuple error; after correcting that fixture, both missing/null exit cases failed the baseline behavior and passed the implementation. No fixture failure is counted as product evidence.

## Changes and scope

Named status reports observed remote state, `missing` after typed NotFound, or `unknown` when no ID was recorded. `recorded_status` preserves the deployment history and `observation` identifies the result source. The query uses the saved ID and Provider configuration. Authentication, service and connection errors remain errors; inspection does not modify the local record.

Streaming JSON uses one `{stdout, stderr, exit_code}` result across the native Express and Provider stream paths. Native execution and Provider streaming share a combined 16 MiB UTF-8 capture limit. Exceeding it stops accumulation, retains the original execution/timeout, and reports an error after completion rather than truncated success. No new retry, independent drain timeout, or command replay is introduced. Missing/null terminal codes fail explicitly. Human stream routing and interrupt handling remain separate.

## Executed checks

- `npm ci --ignore-scripts`: passed using the lockfile.
- Targeted status, execution, list-partial, native output and standard session tests: **59 passed** across five files after review corrections.
- The new process component case starts a real child, feeds UTF-8 stdin, observes stdout/stderr and exit 13 through the JSON CLI path, then closes the child. This is local process evidence with the Provider connection seam replaced; it is not a real OpenSandbox backend test.
- Existing standard-session tests exercised real child-process deadline handling and POSIX TTY restoration, including interrupt and failed/hung cancellation branches.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and 258 pre-existing warnings reported by the repository configuration.

The status tests replace the remote query seam. No cloud resource, key, database or release was created. Full integrated repository checks, subsequent review and release remain owned by the encompassing Issue 276 change.

## Adversarial review

The parent reviewer required preserving a present response with unavailable state as `unknown`, rather than mistaking it for absence. A regression now covers that distinction. The reviewer also challenged repeated terminal events; the CLI rejects duplicate EXIT events or output after EXIT instead of overwriting a confirmed nonzero code. The original Provider deadline and native cancellation implementation remain in force; this patch does not claim cloud execution cancellation or a bound on upstream Provider memory.

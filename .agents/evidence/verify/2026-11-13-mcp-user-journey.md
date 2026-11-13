# MCP user journey — 2026-11-13

Result: PASS for the supported MCP paths stated below; NOT an overall Skills or full-local-suite pass.
Owner: CLI. [Issue250](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/250).
Base/source tested: `16e0a2bfe50ac89b1d6c8ee21e3bcc995cd12614`.
Only bilingual MCP guidance, changelog and engineering records change; runtime is unchanged.

## Historical denominator

The immutable [2026-10-26 acceptance](2026-10-26-skills-delivery-acceptance.md) covers 17 broad
scenarios: 11 PASS and 6 PARTIAL. Remaining parts concern WarmPool/workload benchmarks,
cost attribution/utilization, cache/pool version synchronization, a target VPC, real operator
handoff/video, and a permanent managed MCP service/tenant boundary. That run also retained
20 full-local-suite failures. These were never an overall pass.
The later website Skill guides have a different denominator and do not close
[Issue46](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/46) or
[SDK Issue45](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/45).

## Current real-component scope

Environment: Linux, Node22.22.2, Python3.13, Qwen Code0.19.3, configured qwen3-coder-flash.
Dependencies came from the CLI lockfile; source build passed. Existing credentials were loaded
privately; temporary client profiles were private and not included here. No key/Team was created.

[Summary](2026-11-13-mcp-user-journey/summary.json),
[actual tool schemas](2026-11-13-mcp-user-journey/tool-inventory.json),
[STDIO sent/returned record](2026-11-13-mcp-user-journey/mcp-tool-record.json),
[HTTP sent/returned record](2026-11-13-mcp-user-journey/http-e2e-record.json),
[actual assistant calls/reply](2026-11-13-mcp-user-journey/qwen-mcp-client.json).
Identifiers/endpoints are redacted consistently. Large base64 bodies are omitted with their
length and SHA-256 preserved; this is sanitized evidence, not verbatim unredacted wire capture.

- Actual discovery yielded21 tools. All21 contracts were exercised:20 had positive workload
  observations; run_code was a negative unsupported-capability check (E8004), not code execution.
- STDIO26 checks: create/state/eventually consistent list, real42/exit0, text files/directory,
  nonzero exit7/stderr, binary upload/download with local byte/hash verification, invalid hash
  rejection, runtime probe, explicit TTL/retention, background work recovered after server
  restart, cancellation to state=cancelled, explicit deletion and independent platform404.
- HTTP15 checks: actual health/discovery, missing/wrong Bearer401, two distinct sessions,
  real creation/file readback, default-session separation, DELETE cleanup plus independent404,
  unsupported GET405 and unknown-session404. Same-account session separation is not tenant isolation.
- Qwen actual connected client made9 MCP calls across create/write/run/read/list/state/kill.
  Its CSV input summed12+30 into actual `{"total":42}`; the final readback and post-delete lookup
  were real tool returns. An independent platform request confirmed absence. Tool discovery was
  also verified by the protocol harness; the model did not perform every requested diagnostic step.
- Initial Qwen project configuration was Pending approval; an exploratory bare invocation did
  not connect. Neither normal exit was counted as success. Final automation used an explicitly
  configured trusted user-scope test profile with locally saved CLI credentials; this is not a
  claim to have automated the interactive project-approval UI. The public guide explains approval.

## Template path and retained failure

[Prepared-image operations](2026-11-13-mcp-user-journey/mcp-template-record.json),
[initial failure](2026-11-13-mcp-user-journey/mcp-template-injection-failure.json),
[template cleanup](2026-11-13-mcp-user-journey/template-cleanup.json).

The first uniquely named template submitted but build state became error: envd injection could
not find an ACR EE endpoint for the platform registry image. This remained a failure, not readiness.
A second, separate owned template reused the already prepared existing base image with
`envd_inject=false`; it reached ready, then validate_template verified actual commands/binary I/O
and temporary-sandbox cleanup. Exact owned templates were deleted and independently absent.
This proves prepared-image reuse, not arbitrary public/private registry builds or envd injection
for arbitrary images. Do not disable injection for an unprepared incompatible image.

## Installation evidence

[Installation receipt](2026-11-13-mcp-user-journey/installation-receipt.json) and
[released CLI workflow](2026-11-13-mcp-user-journey/release-journey.json).
Linux x64 installed the actual checksum-verified binary0.5.10, npm0.5.10, and built source.
The released binary completed the displayed create/exec/upload/download/kill flow with local
byte comparison and independent404. A first harness parser omitted hyphenated native IDs;
the successful created resource was continued using its captured exact ID, not created again.
No native macOS/Windows runner was available; commands/layout and declared release assets
are separate from native operating-system acceptance.

## Harness failures and cleanup

Early list checks did not wait for platform list visibility; bounded observation retry was added
without repeating creation on uncertainty. Native/qualified ID parsing and task state field
checks were corrected against actual contracts. Initial cancellation output already showed
state=cancelled; the final corrected run passed. HTTP evidence was rerun after isolating a
record destination collision. Initial failures are retained in the task report rather than
converted into product passes. No production assertion or TLS behavior was weakened.

The [final independent list](2026-11-13-mcp-user-journey/independent-final-inventory.json) returned HTTP200 and zero visible sandboxes.
All owned runtime IDs were explicitly deleted and independently absent, including Qwen and
HTTP resources. Only exact task-owned template names/IDs were deleted. No account-wide cleanup,
permanent hosted service, billing mutation, VPC or WarmPool resources were created.

## Repository checks and limits

- Locked install and source build: PASS.
- Document health: PASS105/WARN11/FAIL0 before adding this record; final health is rerun for publication.
- `npm run check:hygiene`: PASS; final staged credential scan is separate.
- Fresh optional `npm test -- --maxWorkers=2`: **FAIL** —4515 passed,12 failed,61 skipped across
  215 files (205 pass/5 fail/5 skip). Failures are Docker/template build tests; explicit Docker
  Permission denied appears in the adopt/deploy fixtures. The other failures are not all assigned
  that cause without independent diagnosis. Python server-source cross-checks were skipped in
  this standalone environment. No fake Docker executable, assertion suppression or product
  fallback was introduced. This result is not reported as full local CI success.
- Unchanged source baseline's required remote CI had passed at run43205476557. PR latest-head
  CI, review requirements and merge state must be checked separately; that older run cannot
  satisfy the new PR gate. This documentation-only change requires health/hygiene and applicable
  remote checks; it does not change the failing Docker/runtime code.

No all-client matrix, native macOS/Windows execution, positive Express native interpreter,
permanent managed hosting/tenant isolation, all17 historical workflows or overall SDK suite
is certified by this evidence. Required PR checks and publication are recorded separately.

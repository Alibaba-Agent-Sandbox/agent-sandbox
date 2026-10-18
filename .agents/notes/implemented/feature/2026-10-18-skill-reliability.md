# Decision: Evidence-based Sandbox Skill workflows and task recovery

Status: implemented

## Problem

A previous live Skill run encountered FunctionNotFound after creating a sandbox and uploading input. Its uncommitted temporary worktree was lost on environment recovery. Historical tool records remain, but not all edited file contents. The committed baseline also fabricates omitted timeout metadata, renews resources on lookup and deletes connected external resources on MCP disconnect. Existing test failures were not attributed with adequate controls.

## Decision

Continue from committed baseline 62cb6c9 on an isolated workspace worktree. Rebuild the reusable workflow tools, preserve observational reads, explicitly retain background/user resources and store task status/logs within the sandbox. Add SHA-256-verified binary transfers and separate template submission, readiness and runtime acceptance. Document actual per-action agent inputs, returns and independent effects. Preserve the original failed run and each new attempt separately.

## API Design

The compatible seven MCP tools remain. Add get_capabilities, list_sandboxes, get_sandbox, set_sandbox_timeout, retain_sandbox, upload_file, download_file, start_task, get_task, cancel_task, verify_sandbox, submit_template_build, get_template_build and validate_template. Create supports cpu/memory/region/retain and refuses unsupported parameters. Runtime Team selection remains credential-owned. Sandbox.getInfoById is an observational provider-aware API. Missing platform timeout/region normalize to unknown (0/empty in the model, null in workflow output); dates are ISO strings. Nonzero task exit in a successful status/cancel query does not make the lookup an MCP tool error; run_command/run_code retain their nonzero-exit error semantics.

## Alternatives considered

- Extending every timeout would hide eager SDK loading and platform interception rather than fix them.
- Treating a declared provider feature or submitted template as verified would produce misleading acceptance.
- Recreating lost tasks automatically could repeat side effects and conceal lifecycle failures.
- Claiming the historical template deletion actor from a current 404 would exceed the available evidence.

## Dependencies

Existing lockfile dependencies and provider adapters. Durable task wrappers require Linux, sh, python3, nohup, base64 and /proc. Template control uses the existing Alibaba AK/SK adapter with explicit Team; other providers require their own adapter. Related lifecycle contribution: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/31.

## Test Strategy

Real local processes verify persistent task exit/logs and cancellation; regression checks cover resource ownership, unknown metadata, binary corruption and unsupported parameters. An independent agent performs actual CLI then MCP file-processing, reconnect, code-failure, cancellation and cleanup acceptance using environment credentials. A separate fixed compiled entry prevents source changes from contaminating each live run. Preserve test-harness mistakes as distinct from product failures. Run full repository checks and classify environmental failures using direct-route/raw-network controls.

## Acceptance criteria

- Each attempted Skill operation records agent identity, Skill hash, sanitized input/return, expected and independently observed effect, timing and cleanup.
- Background task identity/logs/results survive a real MCP process restart while the sandbox remains alive.
- Connected user resources and retained/background sandboxes are not deleted on disconnect; ephemeral session-owned resources still clean up.
- File hashes and business content are independently verified; cancellation stops observable work.
- Mandatory unrun/blocked advanced requirements remain visible; no blanket reliability or full-P0/P1/P2 claim.
- Bilingual docs, packaged references, unit/real-component evidence and required repository gates pass before final acceptance.

## Evidence

- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/43
- [Verification](../../../evidence/verify/2026-10-18-skill-reliability.md).

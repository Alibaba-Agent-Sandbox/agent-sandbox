# Task execution and observable acceptance

Use this reference for files, background work, reconnecting and cancellation. Inspect `tools/list` or CLI `--help` first; installed releases can differ from this source tree. A Skill is guidance loaded by the agent, not an executable API.

1. Record agent identity, model/version if available, Skill version/hash, provider, region/Team source, natural-language request and resource baseline. Do not dump configuration or credentials. Credentials stay in environment/config; do not include account IDs, access tokens or signed URLs in traces.
2. Select an existing ready template. An ephemeral template owned by another test may disappear; a template ID and build state do not guarantee its backing function remains present. Never update/delete an existing template to make a test pass.
3. Create one sandbox with explicit lifetime and record its provider-qualified ID. `create_sandbox` accepts `template`, `timeout`, `envs`, `cpu`, `memory`, `region`, `retain`. Runtime Team is selected by configured authentication; unknown fields such as `team_id` are refused. A successful request does not prove requested resource settings were applied: re-query.
4. Use `verify_sandbox` for command and binary round trip, then upload actual inputs using `upload_file` with canonical base64 and SHA-256. The server reads bytes back before marking upload verified. For files larger than 1 MiB use CLI upload/download and independently compare local/remote SHA-256.
5. `start_task` returns `task_id`, persists state/logs inside the sandbox, and preserves that sandbox on MCP disconnect. It requires Linux, `sh`, `python3` with `os.waitid`/`WNOWAIT`, `nohup`, `base64` and `/proc`; provider feature declarations alone do not prove these dependencies. Explicit `retain_sandbox` also controls session-created resources. Record sandbox/task IDs outside the conversation so a new client can recover them. Platform TTL still applies. This is not a hosted multi-user task service.
6. Disconnect/restart MCP, reconnect with the original sandbox/task IDs and call `get_task`. Never recreate a missing sandbox or blindly resubmit a submission whose result was lost. `running`, `starting`, `unknown`, and `cancelling` are not successful completion. Inspect bounded stdout/stderr and exact exit code. A failed command is distinct from failure to reach its environment.
7. For cancellation, use `cancel_task`, then poll `get_task` to `cancelled`. Check that a heartbeat/output stops. Terminal process state without a persisted result is `unknown`. SIGTERM-resistant work may remain `cancelling`; report it and explicitly escalate through the supported process API if authorized. The supervisor waits for non-zombie members of the original process group/session, including when the shell leader has exited. A descendant that deliberately uses `setsid`/daemonization can escape that group and is outside this contract; use sandbox destruction for complete environment termination when authorized. Do not claim the cancellation request itself stopped work.
8. `download_file` returns bytes/base64/SHA-256; write the local artifact, re-read it and verify hash, length, format and business result. Preserve the actual artifact separately from locally computed expected data. For JSON, verify both fields and data types. A transport process exiting zero does not override MCP `isError` or a nonzero remote exit.
9. Kill only resources created by this task, unless the user requested preservation. Verify deletion with `get_sandbox`/CLI info and the resource baseline. Cleanup failure is a separate failing check. Connected user resources are closed locally on disconnect and are not auto-deleted. `retain_sandbox` with `retain:false` is refused for borrowed resources: it never transfers cleanup ownership. Use an explicit `kill_sandbox` only when deletion is intended and authorized. Failed explicit deletion preserves the handle for retry.

## Per-action record

For **every function attempted through the Skill**, append a sanitized event with:

```json
{
  "agent": "acceptance-agent",
  "skill": "agent-sandbox",
  "skill_sha256": "REPLACE_ME",
  "provider": "alicloud-express",
  "scenario": "file-delivery",
  "user_request": "Summarize the uploaded orders",
  "action": "download_file",
  "sent": {"sandbox_id": "RUN_SANDBOX_1", "path": "/tmp/summary.json"},
  "returned": {"bytes": 58, "sha256": "REPLACE_ME", "isError": false},
  "expected_effect": "Local file contains independently checked totals",
  "observed_effect": "Record the actual local hash and parsed totals here",
  "result": "PASS | FAIL | BLOCKED | NOT_RUN",
  "cleanup": "Record independent cleanup evidence"
}
```

Record actual inputs/returns, elapsed time, expected/observed effects and the verification method; assertions made by the agent are not external verification. Never store full file data or logs if they contain private information. Preserve failures and before/after evidence rather than overwriting a failed run with a pass. A missing mandatory scenario remains in the coverage denominator. Do not infer a statistical reliability percentage from one agent run.

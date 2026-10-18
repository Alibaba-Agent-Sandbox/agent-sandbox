# Verifiable tasks with the Agent Sandbox Skill

Show users what the agent sent, what the tool returned and what actually changed. A Skill guides an agent; CLI/MCP executes requests, while the provider determines backend support. An accepted request or returned ID is not business delivery.

## Install and connect

Follow the [installation guide](agent-skill-installation.md), installing `SKILL.md` and `references/` from one revision. Inspect actual CLI help or `tools/list`; this source exposes 21 MCP tools and installed releases may differ. Load credentials through environment/local configuration without recording API keys, AK/SK, signed URLs or account details. Runtime API credentials select the runtime Team; template-control AK/SK and Team are a separate scope. Unsupported create fields such as arbitrary `team_id` are refused rather than ignored.

Record existing resources first, then create only your own short-lived test environment. A declared provider feature requires separate live acceptance.

## A concrete user task

Ask an agent: “Summarize this order file in a sandbox, run it in the background, retrieve the result after reconnecting, demonstrate cancellation, then clean up only your resources.”

```csv
qty,unit_price
2,10.00
1,5.50
3,2.00
```

Independently expect three rows, quantity six and Decimal total string `31.50`. Expected data is never substituted for a downloaded cloud artifact.

The independent agent's real CLI run on 2026-10-18 observed:

| Skill action | Sent | Returned | Observed effect |
| --- | --- | --- | --- |
| Create | Ready template, lifetime 600s | New sandbox ID | Platform start/expiration timestamps differ by 600s |
| Upload | CSV and analysis code | Upload success and remote listing | Input CSV is 37 bytes |
| Background/reconnect | Start Python analysis, exit CLI, use new clients | PID 495 | Same PID and command recovered after disconnect |
| Retrieve | Download result JSON | 53 bytes | Exact bytes, parsed totals and remote/local SHA-256 agree |
| Diagnose code failure | `exit 7` | Remote and CLI exit code 7 | Correctly distinguished from resource failure |
| Cancel | SIGTERM heartbeat PID 500 | Signal accepted | Marker 15, process absent and heartbeat count 182 unchanged over approximately 41s |
| Cleanup | Delete only owned ID | Delete accepted | Subsequent resource list empty |

The actual artifact is this JSON plus one newline, SHA-256 `9c808afca68751e859669502476d9570d6fe5a0a6ac1c8fb774d40ec3346d6f8`:

```json
{"row_count":3,"total_amount":"31.50","total_qty":6}
```

This is evidence for this version/provider/template, not a statistical reliability rate or acceptance of all advanced features. See the [complete verification record](../../../.agents/evidence/verify/2026-10-18-skill-reliability.md) for MCP restart acceptance and the full passed/failed/blocked/unrun denominator.

## The equivalent MCP workflow

Inspect `get_capabilities`, then create and run `get_sandbox`/`verify_sandbox`. `upload_file` requires canonical base64 and SHA-256 and checks remote read-back. `start_task` returns a durable task ID and retains the sandbox. Save both IDs, restart the MCP process and query the original task with `get_task`; never blindly resubmit after an uncertain submission.

Task wrappers require Linux, sh, python3, nohup, base64 and `/proc`. State/logs survive the client connection inside the sandbox; platform expiry/destruction still removes them. This is not a hosted multi-user task service. Poll cancellation to a terminal state and verify work stops. `running`, `cancelling` and `unknown` are not completion.

`download_file` returns bounded base64, length and SHA-256; the agent must write/re-read the local file and verify business content. Use CLI transfer with independent hashes for files over 1 MiB. Keep task success and cleanup success separate.

Connecting to an existing user sandbox does not adopt cleanup ownership. Only session-created ephemeral resources auto-delete on disconnect. Retained/background environments survive until platform TTL or explicit deletion. Observation does not renew TTL. `set_sandbox_timeout` separates acceptance from observable verification; omitted timeout/region remain unknown.

## Diagnose failures with controls

The historical failure now has audit evidence: at 07:18:48 UTC on 2026-10-16, DeleteFunction succeeded for the exact backing function; task startup returned FunctionNotFound at 07:18:51. The direct cause was a deleted backing function, not business code or failure to honor the requested 600-second lifetime. The actor is assumed-role and used a different AK from the currently supplied one. The upstream initiating operation remains unidentified, so this does not establish a particular deleting user or a platform product defect. The historical template now returning 404 is corroboration.

Raw platform data omitted `timeout`; the client previously displayed its default 300s. Actual start/expiration timestamps proved the requested 600s. That is a client metadata defect. The fix preserves unknown values and ISO timestamps. Losing `aliases` and `builds[].status` in template-list output is likewise a CLI mapping defect.

Test custom-Host routing separately from real loopback traffic and retain platform audit interception evidence. MCP ping/discovery should not await the cloud SDK. Exit 137 alone does not establish OOM. Record request IDs, sanitized observations, a control, repair and the same acceptance check after repair.

## Record every attempted operation

Use the [action record contract](../../../references/task-workflows.md): agent/model/version (or explicitly unknown), Skill hash, user request, provider, sanitized arguments, return/error, elapsed time, expected/observed effect, independent assertion and cleanup. Preserve failed timelines and write fresh rerun evidence.

Separate code/unit, real-cloud, natural-language agent and installed-client acceptance. Template submission needs ready state plus a real test sandbox/command/file/cleanup. Ordinary file I/O is not persistent storage. Mounts, cache/warm pools, billing, hibernation, snapshots, network policy, expiring previews, desktop handoff and hosted MCP require provider APIs and their own real acceptance. Missing prerequisites remain coverage gaps.

Parent-agent follow-up completed the remaining three template tools: authenticated Team discovery, image submission, ready-state query, real runtime command/binary acceptance and independently verified sandbox/template deletion. The first attempt exposed a generation-1 startup-parameter rejection; default generation 2 plus preflight validation fixed it. Combined tool exercise is 21/21 across the independent and parent runs; the broader requirement coverage remains explicitly partial.


## Second verification and known boundaries

A second independent review found installation examples using the wrong repository/checkout directory and omitting required references. The updated installation guide uses the canonical Alibaba-Agent-Sandbox repository and copies the complete bundle. Runtime edge cases also required repairs: SIGTERM-resistant descendants must keep a task `cancelling`; a shell exiting before its group finishes cannot establish completion; provider-qualified deletion must clear the default/cache; failed deletion must remain retryable; disabling retention on a connected resource must not transfer cleanup ownership. Task management covers the original Linux process group/session. Explicit `setsid`/daemonization can escape it.

See the [new verification record](../../../.agents/evidence/verify/2026-10-18-skill-recheck.md) for fresh inputs, returns, effects and remaining gaps. The previous 21-tool live run does not establish complete original requirement coverage.

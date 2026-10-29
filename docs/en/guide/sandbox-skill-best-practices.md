# Run background tasks with the Agent Sandbox Skill

Use the Skill to ask an agent to upload inputs, run a task in a sandbox, retrieve its output and clean up the environment. The CLI or MCP tools execute the work; the selected Provider determines which operations are available.

## Install and connect

Follow the [Skill installation guide](agent-skill-installation.md). Install `SKILL.md` together with its `references/` directory from the same revision. Then install the CLI, configure credentials using the [authentication guide](authentication.md), and connect your agent to MCP. Check the installed CLI's `--help` or MCP `tools/list` for the available commands and parameters.

Choose a prepared template containing the tools your task needs. For the example below, use a Linux template with Python 3. Load credentials from local configuration or environment variables; keep them out of task prompts and output files.

## Example: summarize an order file

Save this input as `orders.csv`:

```csv
qty,unit_price
2,10.00
1,5.50
3,2.00
```

Ask your agent:

> Upload this order file and a Python script to a sandbox. Calculate the row count, total quantity and total amount using Decimal. Run the script as a background task, save the sandbox and task IDs, reconnect and download result.json. Then delete the sandbox you created.

The script can use:

```python
import csv
import json
from decimal import Decimal
from pathlib import Path

with Path("/tmp/orders.csv").open(newline="") as source:
    rows = list(csv.DictReader(source))
result = {
    "row_count": len(rows),
    "total_amount": str(sum(
        (int(row["qty"]) * Decimal(row["unit_price"]) for row in rows),
        Decimal("0.00"),
    )),
    "total_qty": sum(int(row["qty"]) for row in rows),
}
Path("/tmp/result.json").write_text(json.dumps(result) + "\n")
```

The downloaded JSON should contain these values:

```json
{"row_count":3,"total_amount":"31.50","total_qty":6}
```

Check the downloaded file itself before reporting the result. A successful task submission only means the task was started.

## Run and reconnect with MCP

1. Inspect `get_capabilities` for the selected Provider's declared operations. Use `create_sandbox` with the prepared template and a suitable `timeout`; save the returned sandbox ID. `get_sandbox` reads its metadata, and `verify_sandbox` checks command execution and file transfer.
2. Upload `orders.csv` and the script to `/tmp/orders.csv` and `/tmp/summarize_orders.py` using `upload_file`. Supply `sandbox_id`, `path`, canonical `content_base64` and its SHA-256 as `sha256`. The tool reads back the remote file to check the transfer.
3. Call `start_task` with `sandbox_id` and `command: "python3 /tmp/summarize_orders.py"`. Save the returned `task_id`. This retains the sandbox across MCP disconnects.
4. After reconnecting, call `get_task` with the original `sandbox_id` and `task_id`. Reuse those IDs instead of submitting the job again. If submission fails with an uncertain result, inspect the existing sandbox before retrying.
5. When the task reaches `succeeded`, call `download_file` for `/tmp/result.json`. Decode `content_base64` into a local file, compare its length and SHA-256 with the response, and check the JSON values above. For a `failed` task, inspect the returned error, exit status and available logs.
6. After retrieving the result, call `kill_sandbox` with the ID you created. Report any deletion failure so the same resource can be retried.

## Task and transfer limits

Background task tools need Linux, `sh`, `python3`, `nohup`, `base64` and `/proc` inside the sandbox. Their state and logs survive a client disconnect, but are lost when the sandbox expires or is deleted. `get_task` returns bounded log tails; check the truncation fields when diagnosing long output.

To cancel a task, call `cancel_task` with its sandbox and task IDs, then poll `get_task` until it reaches a terminal state. Check that observable work has stopped. `running`, `cancelling` and `unknown` are not completion. Cancellation sends SIGTERM to the original Linux process group. Processes that ignore SIGTERM can remain `cancelling`; processes that create a new session with `setsid` or daemonize can leave the managed group.

MCP downloads are limited to 1 MiB. For larger files, use the CLI and compare local and remote hashes:

```bash
abx download SANDBOX_ID /tmp/result.json ./result.json
```

## Keep resource ownership explicit

Only sandboxes created by the MCP session and left ephemeral are automatically deleted during normal shutdown. Connected user sandboxes are borrowed and stay intact. `start_task` or `retain_sandbox` preserves a created sandbox until its platform lifetime expires or it is explicitly deleted; disabling retention does not transfer ownership of a borrowed resource.

Observation does not extend the sandbox lifetime. Use `set_sandbox_timeout` when you need more time, and check its returned metadata. If the Provider omits lifetime information, the actual value remains unknown. Delete only resources created for your task or explicitly designated by the user, and keep task results separate from cleanup results.

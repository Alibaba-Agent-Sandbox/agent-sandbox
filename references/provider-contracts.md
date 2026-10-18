# Provider boundaries and failure attribution

Use `get_capabilities` and `abx provider info ID` to inspect the selected provider. Check real behavior separately. Basic CLI/MCP workflows can be shared; another provider must implement its lifecycle, execution, file and process contracts and satisfy task-runner dependencies. Provider-qualified IDs keep different backends' IDs distinct.

`get_sandbox`/`list_sandboxes` are observational and do not renew resources. `set_sandbox_timeout` explicitly requests renewal and reports `accepted` separately from `timeout_verified`. A backend may omit timeout/region: these are unknown, never client-default evidence. Compare actual `started_at`/`end_at` when available, and preserve ISO timestamps. Querying an environment is not permission to take ownership of it.

Keep these statuses separate: implemented, unit-tested, live-tested, unsupported, blocked and not run. Storage mounts, snapshots, deep hibernation, template caches/warm pools, cost data, network/VPC policy, preview expiration, browser takeover/replay and hosted MCP need actual provider-specific APIs and per-provider acceptance. Ordinary files are not persistent volumes; a port URL is not an expiring preview; local MCP HTTP is not an official hosted service. No FC application deployment is included.

## Diagnose with evidence

| Observation | Permitted conclusion | Required follow-up |
| --- | --- | --- |
| Local route returns 307 but wire request returns a platform audit page | Environment intercepted the request | Preserve the response marker and direct/local-host controls; fix the test's routing or platform configuration |
| MCP ping waits for eager SDK loading | Client startup/readiness defect | Make protocol discovery independent of cloud import; test a cold process |
| Raw response lacks timeout, UI displays 300 | Client fabricated default metadata | Return unknown and inspect platform expiration timestamps |
| Remote command returns exit 7 | Command/code failed | Read stderr; repair and rerun the same acceptance check |
| Exit 137 only | Signal termination observed | Obtain memory metrics/termination event before claiming OOM |
| `FunctionNotFound`, then sandbox/template query 404 | Backing resource unavailable | Correlate template/build IDs, request IDs and platform deletion events; do not call this a Python code error or infer who deleted it |
| Client/network timeout after submission | Submission outcome uncertain | Query original IDs/state before retrying |
| Unsupported field or `E8004` | Current adapter lacks the requested contract | Report the missing capability; do not silently drop it or switch providers |

Attribution can be mixed: a platform resource disappeared and the client rendered misleading metadata. A missing historical termination/deletion event remains an unresolved cause even if a later healthy-template test passes. Record the required platform evidence explicitly.

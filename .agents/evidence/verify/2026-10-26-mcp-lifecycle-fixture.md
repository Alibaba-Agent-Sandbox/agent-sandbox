# Verification: maintained real MCP lifecycle fixture

Result: PASS, 15 real CLI STDIO checks, exit 0.

The fixture `e2e/mcp-lifecycle.mjs` now defaults to the actual `base` template's 2 CPU / 2048 MB. `ABX_E2E_CPU` and `ABX_E2E_MEMORY` allow explicit expectations for another selected template. Creation passes those values and a separate metadata request asserts both exact values; no resource assertion was removed. The old hardcoded 2 CPU / 1024 MB request correctly failed after explicit-resource validation was added.

Provider-qualified resource references remain in all calls and cleanup. Metadata/list comparisons use the raw ID returned by `parseSandboxRef`, because metadata models expose unqualified IDs.

After the coordinating task's latest build completed, executed from the CLI repository with authorized credentials inherited without logging:

```bash
node --check e2e/mcp-lifecycle.mjs
node e2e/mcp-lifecycle.mjs
```

Both exited 0. The actual [machine-readable result](2026-10-26-mcp-lifecycle-fixture.json) records 15 passing checks: real tool discovery, invalid argument rejection, creation and independent CPU/memory metadata, eventual list visibility, external-ID inspection and timeout updates, observer EOF preserving the resource, real file/command effects, exact owned deletion and read-only absence verification. No other resources were deleted. No full-repository CI pass is implied; its failures remain in the coordinating task's evidence.

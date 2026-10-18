# Reproducible Skill acceptance assets

- `independent-agent.md` and `reviewed-actions.jsonl`: 111 reviewed actions with actual sent/returned data and observed effects from independent agent `skill_acceptance`.
- `trace.jsonl`: original sanitized CLI actions; `mcp-trace.jsonl`: original sanitized independent MCP actions.
- `mcp-harness-corrections.json`: preserved incorrect state-name assertions and their factual corrections. No failed attempt was overwritten.
- `outcome.json`, `mcp-outcome.json`, `mcp-remaining-outcome.json`, `mcp-final-outcome.json`: distinct attempts, including the cancellation error-flag defect and fixed-build rerun.
- `SUMMARY.json`: independent findings plus a separately labeled parent template follow-up. Independent agent exercised 18 tools; parent exercised the remaining three with real control/runtime APIs.
- `template-before-fix.*`, `template-after-fix.*`, `template-cleanup.json`: startup/generation rejection, corrected real build/runtime acceptance and independent owned-template cleanup.
- `platform-observations.json`: raw-field names and only non-sensitive observed fields; actual runtime credentials/URLs/accounts/tokens are excluded.
- `network-controls.json`: matching local Host reaches service; custom Host is intercepted before the service; malformed response bytes are rewritten by the execution platform.
- `input.csv`, `analyze.py`, `heartbeat.py`, `result.json`, `mcp-result.json`: public task fixtures and actual downloaded artifacts. Both result files are 53 bytes and share SHA-256 `9c808afca68751e859669502476d9570d6fe5a0a6ac1c8fb774d40ec3346d6f8`.

## Reproduce

Build the CLI with its lockfile (`npm ci`, `npm run build`). Load the repository Skill and its references in an agent. Use the task and CSV in the bilingual best-practices guide. For MCP evaluation, start `scripts/skill-evaluation-bridge.mjs serve --repo REPOSITORY --env-file ENV_FILE --state-dir RUN_DIR`, then use its `list`, `tool NAME JSON`, `restart` and `shutdown` actions. The bridge talks to a real STDIO child, enforces owned-resource writes and records a Skill hash. It is evaluation infrastructure, not a hosted product service. Mask credentials and private metadata before collecting evidence.

The original CLI run did not record a starting Skill hash; this missing provenance is retained explicitly. Later MCP traces include the hash captured by the bridge. The exact child model identifier was not exposed. A single agent evaluation cannot establish a statistical success rate or cross-provider equivalence.

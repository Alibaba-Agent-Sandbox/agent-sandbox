# Second Skill verification assets

This is a new review of the delivery in PR #44. Historical evidence stays immutable.

- independent-before-fix.jsonl: actual independent local failure reproductions against a881563 (its content is the PR #44 tree). Resistant descendants were force-stopped locally; no cloud or credentials used.
- runtime-actions.jsonl / template-actions.jsonl: fresh sanitized real MCP inputs, returns, expectations, observations, timing, agent and Skill hash. Expected error cases are labeled explicitly by their expected effect.
- actions.md: user-readable table of every fresh action, with complete machine records alongside it.
- runtime-summary.json / template-summary.json: separate runtime and template results.
- result.json: actual downloaded artifact, independently re-read and checked.
- installation.json: raw URL controls and complete installed bundle hashes; tests file delivery, not all IDE activation.
- checks.json: actual local and remote check outcomes, including skips and execution-platform failures.

The root recheck agent performed the live cloud operations. The independent reviewer only reviewed/reproduced locally; these are distinct roles, not two independent live natural-language evaluations. Exact model runtime identifier was not exposed.


## Replay

The successful scenario runtime/template drivers are retained as runtime-replay.mjs and template-replay.mjs. Build the selected repository revision first. Supply a private environment-file path; its contents never belong in evidence:

```bash
node runtime-replay.mjs REPOSITORY ENV_FILE NEW_RUNTIME_OUTPUT_DIRECTORY
node template-replay.mjs REPOSITORY ENV_FILE NEW_TEMPLATE_OUTPUT_DIRECTORY
```

Run sequentially with the documented tested-template/AK-SK/Team prerequisites. These are acceptance drivers for the recorded scenario, not hosted services or arbitrary image inspection. They create only their own short-lived resources and clean up their recorded IDs. Raw SDK/bootstrap failures must be sanitized before publication. Keep every failed run in a new output directory.

network-controls.json repeats the local Host, raw-response and TLS controls in this restored environment. Raw response bytes were again rewritten into an HTTP502; its error body now includes the word garbage, so that boolean differs from the historical control without changing the demonstrated interception.

local-full-suite.json retains all11 local failures and actual assertion excerpts; normal CI is recorded separately. Its56 skips remain skips. No raw full-suite logs or credentials are published.

replay-validation-actions.jsonl and replay-validation-summary.json retain the successful real replay of the lint-corrected template driver. actions.md includes these7 extra events (54 total). ci-archive-lint-failure.json preserves the failed packaging head and its implementation attribution.

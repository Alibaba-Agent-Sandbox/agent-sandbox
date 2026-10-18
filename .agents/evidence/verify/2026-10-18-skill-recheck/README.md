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

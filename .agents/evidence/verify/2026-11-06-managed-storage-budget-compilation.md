# Verification: managed storage budget compilation

- Date: 2026-11-06
- Scope: CLI PR235, continued fifth unpublished candidate.
- Result: PASS for focused compiler/final-wheel parser, strict types and build; full/cloud gates pending.

The integration owner reported an actual CAExited Dispatcher startup, with private native logs
identifying Unknown managed budget field in final ManagedConfig.from_dict. The original CLI compiled
storage.backend into the numeric budget map. The accepted schema fixes this as a deployment descriptor.
Only that key is now excluded; the schema, SDK parser and all numeric budgets are unchanged.

Two focused tests passed, then passed again using the actual executable template source through
ABX_MANAGED_TEMPLATE_FILE rather than only the embedded fixture. Its complete spec6 manifest and
actual Server Dockerfile were copied into owned scratch; cloud resources remained isolated doubles. The first checks production applyPlan's compiled ENV for all three roles,
exact numeric budgets and unchanged original manifest. The second runs the actual final CI-wheel
interpreter with -I and stdin full compiled JSON: all three role configs are accepted; restoring
backend and adding unknownBudget each raise ValueError. It imports the installed SDK, not copied
models or a stub parser. The optional interpreter was explicitly supplied for this real-component
run. Default CI does not have unpublished managed SDK dependencies and explicitly skips this case.
No pass is claimed for that default skip. Strict TypeScript and build passed. The template-source
mode changes only test input, never the original recipe or installed SDK.

The earlier fourth candidate and failed cloud receipts remain unchanged. The integration owner may
perform an independently journalled ENV-only recovery of its exact owned unpublished Dispatcher,
with full native identity/image/command/ENV comparison and readback, solely to restore normal signed
status/drain/destroy. This record does not claim that cloud recovery or any endpoint change occurred.
Native endpoint examples and timeout labels remain under separate read-only investigation.

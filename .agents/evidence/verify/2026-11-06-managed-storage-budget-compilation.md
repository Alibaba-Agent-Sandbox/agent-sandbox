# Verification: managed storage budget compilation

- Date: 2026-11-06
- Scope: CLI PR235, continued fifth unpublished candidate.
- Result: PASS for focused compiler/parser, complete local/remote gates and installed package; joint cloud recovery remains pending.

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

## Complete candidate gates

Full make ci ran with the CI-pinned Python/provider fixtures and explicitly enabled installed-wheel
parser test: 4711 unit passes, 4737 parity passes, five existing optional skips in each run. The ledger
has907 passes, zero failed/skipped/missing and11 moved owner cases verified. Strict types, lint,
hygiene, clean build and package entry passed. Repository health:105 passes,11 historical warnings,
zero failures. The default remote jobs explicitly skip the optional installed-interpreter case; their
success does not stand for this separately executed cross-package component run.

Head ebd7b93eb90db61fff46c60d5d3a0cd4fc1de124 passed remote Node20/Node22, typecheck/lint,
installer and package build plus Docs/Express workflows:
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42168259101 .

The separately installed fifth npm package passed release-artifact checks and actual app help
snapshots. All697 packaged dist files equal the final source build. Tar SHA256:
3dea33a8d3e1cdf5d93b84e78301d23528a455592401add4136ef28b5a77dcb2; consumer lock SHA256:
37744e8977621d04905f82e1f096553c04bffb472336aac10358a71061510fbc.
Its product endpoint remains regional; this change does not claim resolution of endpoint, cold-start
or later native media-type observations. Later SDK /invoke octet-stream delivery is a separate
reviewed change and requires a new Server image. No CLI release or full joint acceptance is claimed.

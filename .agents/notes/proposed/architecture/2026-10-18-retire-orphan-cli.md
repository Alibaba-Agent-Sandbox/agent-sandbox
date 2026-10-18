# Decision: Retire CLI implementations with no executable consumer
Status: proposed

## Problem

Nine legacy Python SDK port modules are unreachable from the CLI executable,
including type imports. They compile and ship in npm, while current docs still
present them and a removed command framework as active architecture.
Issue: https://github.com/alibaba-agent-sandbox/agent-sandbox/issues/49.

## Decision

Remove unused Image/TemplateManager, named session persistence and models,
GlobalConfig, SecretStore, generic retry and PortClient implementations. Prune
their exports and dedicated tests; remove the now-empty session barrel. Retire
the deprecated metadata-only TemplateProtocol.create(dockerfile) method whose
only production consumer was TemplateManager. Keep current image and official
FC template methods. Correct Commander/current ownership guidance in both languages.
Clean previous dist output before TypeScript emission so an incremental build
cannot keep shipping JavaScript for the retired source modules.
Preserve the independent MCP entry, active underscore compatibility helpers,
parity ledger, all golden files and historical evidence.

## API Design

No CLI command or option changes. Deep imports of removed internal dist modules
are a compatibility change; the bilingual retirement guide lists replacements.
The executable package is not a substitute for the standalone Node HTTP SDK.

## Alternatives considered

- Keep ports for hypothetical consumers: maintains unsupported duplicate SDK code.
- Remove every unreachable file: would remove the independent MCP entry and useful barrels.
- Call deleted tests passes: dishonest; report their removal and retain the CLI ledger.

## Dependencies

No package dependency changes. Python SDK persistence remains owned by
https://github.com/alibaba-agent-sandbox/python-sdk.
Node HTTP SDK remains owned by https://github.com/alibaba-agent-sandbox/nodejs-sdk.
Registry/website consume source docs; no catalog schema or UI feature changes.

## Test Strategy

Compare executable import and bundle graphs before/after. Search source and
other repository consumers; inspect open feature PRs for rebase impact. Run full
tests, types, ESLint, build, parity, npm package and component checks. Compare
golden and ledger hashes to base and record removed dedicated tests separately.

## Acceptance criteria

- Retired modules and legacy create method have no production consumer.
- npm artifact omits retired code; active command/MCP/provider paths remain.
- CLI parity ledger and golden captures remain unchanged.
- Current English/Chinese architecture and contributor instructions match source.
- Required checks and real-component acceptance pass before merge.

# Decision: Clarify CLI legacy retry configuration
Status: proposed

## Problem

The CLI configuration table labels max_retries as an active tuning control,
while the builtin HTTP client makes one attempt. Users cannot infer its actual
scope from the table. https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/57

## Decision

Correct English/Chinese configuration and architecture references, remove the
active tuning example and document engine/auth recovery separately. Keep CLI
config names/defaults and the value forwarded by ExecProvider to EPP intact.
The shared contract decision belongs to
https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/60.

## API Design

No executable, command, key-name, schema, default or EPP payload change.
The accepted old values are compatibility data and do not schedule builtin
HTTP retries. A plugin's policy remains owned by that plugin.

## Alternatives considered

- Implement automatic retry in the CLI only: diverges from the SDK and changes
  mutation/timeout behavior outside a documentation correction.
- Drop accepted keys: breaks current config/extension consumers.

## Dependencies

Python configuration owner:
https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/60.
Node configuration-name exports stay unchanged. Registry and website consume
the corrected CLI source documentation rather than a copied guide.

## Test Strategy

Inspect CLI HttpClient and ExecProvider field usage, verify source/config schema
bytes unchanged, check bilingual local links/records/hygiene and latest CI.
No new cloud experiment is needed to establish unchanged prose-only behavior.

## Acceptance criteria

- CLI guidance clearly says the builtin client ignores retry settings.
- Existing config/EPP consumers and command behavior remain unchanged.
- Bilingual documentation and owner checks pass before merge.

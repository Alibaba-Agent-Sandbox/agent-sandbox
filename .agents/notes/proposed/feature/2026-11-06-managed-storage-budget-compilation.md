# Decision: Keep the storage backend descriptor outside runtime budgets

Status: proposed

## Problem

A real owned FC Dispatcher startup returned CAExited. Private native logs identified the final SDK
ManagedConfig rejecting an unknown managed budget field. The CLI passed the complete schema storage
object, including backend=bounded-database, to a runtime that accepts only numeric storage budgets.

## Decision

Remove only the schema-validated backend descriptor when compiling ABX_MANAGED_CONFIG_JSON. Preserve
every numeric budget and the original immutable manifest. Do not relax the SDK's unknown-field or
budget validation. The root integration and runtime owners independently confirmed this boundary.
Keep the earlier frozen package and failed receipts unchanged; use a separate fifth candidate.

## API Design

No manifest, binding, command or runtime wire contract changes. The deployer's descriptor selects
the existing bounded database implementation; the compiled runtime receives its existing budget keys.

## Alternatives considered

- Allow arbitrary runtime storage fields: rejected because it weakens strict input validation.
- Remove every nonnumeric field without naming it: rejected because unknown inputs must fail closed.
- Edit an earlier failed receipt or replay its apply: rejected by recorded uncertain cloud effects.
- Expand default CI Python dependencies just for this fix: rejected in favor of an explicit reusable
  opt-in component test using an already installed matching final wheel.

## Dependencies

The accepted spec6 schema fixes backend to bounded-database. SDK PR156 at final candidate218ad48
provides ManagedConfig.from_dict, which remains strict and unchanged. The runtime owner supplied the
already installed CI-wheel interpreter; -I prevents CWD and PYTHONPATH replacing its imports.

## Test Strategy

Assert every role's actual compiled ENV contains exactly the manifest's numeric storage budgets,
without modifying its backend descriptor. Pass all three full compiled configurations from production
applyPlan through the final installed SDK parser in a subprocess. Require positive acceptance and
negative rejection after restoring backend or adding an unknown key. Keep this optional interpreter
input explicit; default CI reports the unavailable component check as skipped, not passed.
Run full local/remote gates and root's later real FC bootstrap/cleanup independently.

## Acceptance criteria

- The final installed SDK accepts the full role bootstrap emitted from the complete manifest.
- All numeric budgets remain exact and descriptor/unknown fields are still rejected by the SDK.
- No old candidate, plan, receipt or durable admission fence is rewritten.
- Cloud recovery and new deployment results remain separate from local parser component results.

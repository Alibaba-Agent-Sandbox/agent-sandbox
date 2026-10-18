# Verification: CLI layer dependencies

- Date:2026-10-18
- Result:PARTIAL; full/hosted and component results pending.
- Base:45479ea, combined auth and orphan cleanup source; cleanup PR53 now merged.

Existing command/error/provider regression and protocol/HTTP tests:205 PASS.
Full typecheck and emitted build:PASS. Full ESLint:zero errors; an extraction
introduced one unused import, removed before publication. Existing warnings
remain. AST graph144 modules:no strongly connected component contains cli/main.
No command-to-root import remains; transport/protocol import utils helpers.
Standard real-cloud built CLI lifecycle slice:7 PASS, one created/zero leaked.
Create/info/exec/text+JSON/100KiB binary upload+download/kill/leak-check all pass.
Full local normal suite:3651 PASS /12 FAIL /56 SKIP. All12 failed identities
match the same-environment baseline; no new failed identity. The local launcher
omitted paired provider/server source configuration for optional checks;
latest-head hosted matrix and a configured targeted repeat remain required.
No green full-local claim is made.
Golden/parity path byte changes versus45479ea:none. Health105 PASS /11 existing
WARN /0 FAIL; hygiene PASS. The earlier health failure was an existing merged
auth-capture directory slug lacking an index; a new capture index resolves it
without editing the immutable capture/evidence. Latest-head hosted full Node
matrix/types/lint/package/links/installer remain required before acceptance.
No golden capture is deleted or rewritten; compatibility re-exports retain values.

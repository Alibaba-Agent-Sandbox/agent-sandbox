# Contributing code and checking repository health

Install the lockfile dependencies with `npm ci`, then run `make ci` and
`bash scripts/check-repo-health.sh`. The health gate uses the existing TypeScript
toolchain to inspect actual import syntax; examples inside strings and comments
are not imports. Product Python files remain rejected. Python parity oracles
under `parity/` and explicit test assets under `tests/fixtures/` remain test data.

The canonical source repository and Issue endpoint are validated exactly.
Runnable CLI recipes live in [examples](../../../examples/README.md).

Historical captures and accepted notes are immutable. The small reviewed
`scripts/repository-health-history.json` ledger ties specific historical findings
to the exact SHA256 of their original files and records relocated owners or
unavailable historical captures. Each recognized context remains a warning;
`--strict` fails warnings. Editing the bytes or adding an unregistered finding
makes the normal gate fail again. The ledger is not proof that an unavailable
capture passed, and it cannot exempt current product files. New local paths,
broken links and missing ADR references still fail.

Keep a separate note, evidence, bilingual docs and changelog in each changed
repository. Verify the latest head's complete CI and required real components
before merge. [中文](../../zh/guide/contributing-code.md)

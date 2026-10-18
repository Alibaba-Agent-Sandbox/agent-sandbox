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

## Dependency major upgrades

The CLI supports Node 20 and 22. Automatic patch/minor updates continue for
Commander, TypeScript and Node types. Their major updates require a separate
migration PR proving the supported runtime matrix, parser/help/exit behavior,
type/lint tool peer compatibility and artifact acceptance before the bot ignore
is removed. Current pins stay on Commander 14, TypeScript 5.9 and Node 22 types.
Commander 15 requires Node >=22.12 and changes argument diagnostics; TypeScript
7 exceeds the current typescript-eslint peer range; Node 26 types introduce a
Buffer signature incompatibility. These blocked major upgrades are declined,
not recorded as passing CI. See PRs [7](https://github.com/alibaba-agent-sandbox/agent-sandbox/pull/7),
[9](https://github.com/alibaba-agent-sandbox/agent-sandbox/pull/9) and
[10](https://github.com/alibaba-agent-sandbox/agent-sandbox/pull/10).

The GitHub action's own runtime is separate from the `node-version` it installs:
`actions/setup-node@v7` still installs the explicitly selected Node 20/22 used by
CI and Node 22 used by releases. No package release is requested by this update.

Compatible dev-tool patch upgrades must also pass against current main as a combined lockfile. This review retains Vitest5.0.4 and typescript-eslint8.71.2 on Node20/22; a passing old bot head does not validate a later combined tree.

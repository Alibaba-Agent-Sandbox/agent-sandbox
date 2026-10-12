# Decision: Black-box E2E suite, differential harness and Definition of Done

Status: implemented

## Problem
The Node.js `ebx` is being ported from the Python CLI by many contributors at once. Unit tests with
mocks proved logic but not behaviour: nothing exercised the real cloud, nothing compared the port with
the Python original, and there was no shared rule for when a task counts as finished. Work was being
reported as complete on the strength of mocked tests alone.

## Decision
1. **Definition of Done** ([`../../DEFINITION-OF-DONE.md`](../../DEFINITION-OF-DONE.md), English and Chinese):
   a change is done only with unit tests, an E2E run against real components recorded in
   `.agents/evidence/verify/`, an ADR in the right state directory, English and Chinese docs and a
   CHANGELOG entry. E2E that cannot run means BLOCKED, never done. Credentials never leave gitignored
   `.env` files / the environment and are masked in everything the suites capture. Linked from
   `CONTRIBUTING.md` and the PR template.
2. **`e2e/` black-box suite** (Node, no dependencies): table-style scenarios run any binary selected by
   `EBX_BIN` against the real cloud with an isolated HOME/cwd, CI variables stripped, output masked and
   normalised, every sandbox tracked and killed in `finally`, a final leak check, and exact skip reasons.
   Suites: `offline`, `cloud-readonly`, `cloud-lifecycle`, `catalog`, `docker-deploy` (opt-in).
   `npm run e2e`, `npm run e2e:offline`, `npm run e2e:cleanup`.
3. **`parity/diff/` differential harness**: one stub HTTP server (platform REST + envd Connect RPC) and a
   runner that executes identical argv against `EBX_ORACLE` and `EBX_BIN`, comparing exit code,
   normalised output, written files and recorded HTTP traffic. 120 cases, 88 seeded from the original
   evidence registry.
4. `scripts/check-repo-health.sh` exempts `DEFINITION-OF-DONE.md` from the "every file under
   `.agents/notes/` is an ADR" rule (it is a rule document, not a decision).

Files: `e2e/**`, `parity/diff/**`, `.agents/notes/DEFINITION-OF-DONE.md`,
`.agents/evidence/verify/2026-10-12-e2e-foundation.md`, `.github/CONTRIBUTING.md`,
`.github/PULL_REQUEST_TEMPLATE.md`, `package.json` (scripts only), `CHANGELOG.md`, docs.

## API Design
N/A — this decision does not involve API changes. The user-visible entry points are the npm scripts
`e2e`, `e2e:offline`, `e2e:cleanup` and the environment variables `EBX_BIN`, `EBX_ORACLE`,
`EBX_E2E_TEMPLATE`, `EBX_E2E_TIMEOUT_MS`, `EBX_E2E_DOCKER`, `EBX_E2E_ALLOW_KILL_ALL`, `EBX_E2E_KEEP`.

## Alternatives considered
- **vitest for the E2E suite** — rejected: the suite must run against binaries of any language and
  must not depend on the TypeScript toolchain being healthy while the port is in flux; a plain Node
  runner has no dependencies and a stable report format.
- **Only the mock-based differential harness** — rejected: it cannot detect platform behaviour (auth
  errors, envd quirks, eventual consistency) and the stub is written from the same understanding as the
  port; the real-cloud suite stays the source of truth.
- **Golden-file snapshots of the oracle** — rejected as the primary mechanism: they freeze the oracle's
  bugs. Scenarios assert stable contracts (exit codes, JSON shapes, key text) and the oracle's quirks are
  listed in the baseline instead.
- **Rely on code review for "done"** — rejected: the rule must be mechanical and checkable (PR template,
  health gate).

## Dependencies
Node >= 20 (built-ins only) for both tools; real credentials for the cloud suites; the Python oracle for
`EBX_ORACLE` (any `ebx` binary can play that role); Docker plus ACR only for the opt-in deploy suite.

## Test Strategy
The tooling is verified by running it: the E2E suite against the Python oracle on the real cloud twice
to measure flakiness (baseline in [`e2e/BASELINE.md`](../../../../e2e/BASELINE.md)), oracle-versus-oracle
differential run must report 0 differences, and `parity/diff/selftest.mjs` must detect a deliberately
mutated binary. Offline scenarios run in seconds and are suitable for CI without credentials.

## Acceptance criteria
- `EBX_BIN=<oracle> npm run e2e` has 0 failures on the real cloud, twice in a row, with 0 leaked sandboxes.
- `EBX_ORACLE=X EBX_BIN=X node parity/diff/diff.mjs` reports 0 differences; `selftest.mjs` passes.
- No credential value appears in any captured output, report, evidence file or tracked file.
- `DEFINITION-OF-DONE.md` is linked from CONTRIBUTING and the PR template; the repo health gate accepts it.

## Evidence
- [`2026-10-12-e2e-foundation`](../../../evidence/verify/2026-10-12-e2e-foundation.md)

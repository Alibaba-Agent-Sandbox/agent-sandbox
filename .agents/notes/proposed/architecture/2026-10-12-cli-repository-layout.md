# Decision: CLI repository layout and publishing as `agent-sandbox/agent-sandbox`

Status: proposed

## Problem
The Node.js CLI (`@agent-sandbox/cli`, bin `abx`) is being published as its own repository. It needs packaging
metadata, CI/release workflows, a clear `.agents/` scope and a policy for links into the Python SDK repository,
without Python leftovers or machine-local paths.

## Decision
The full review lives in [`docs/design/repository-layout.md`](../../../../docs/design/repository-layout.md).
Summary:

- Publish `@agent-sandbox/cli` from this repository with npm provenance on `vX.Y.Z` tags (`release.yml`).
- Keep the Python-mirroring `src/` tree until the parity gate; re-home it in one mechanical commit afterwards.
- `.agents/` holds only CLI-owned records. Four ADRs moved to `agent-sandbox/python-sdk` because they document
  SDK or server code (`transport-config`, `server-command-registry`, `custom-commands-schema`,
  `docker-builder-acr-push`); the single-distribution `[cli]` extra ADR is superseded.
- Cross-repository references are absolute `https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/...` URLs.
- Python leftovers are removed and recorded in `.agents/notes/` (see `2026-10-12-open-source-hygiene`).

## API Design
N/A — this decision does not involve API changes.

## Alternatives considered
- **npm workspace with the Python SDK** — different toolchains and release cadences.
- **Unscoped package name `abx`** — already taken on npm by a third party.

## Dependencies
`scripts/check-repo-health.sh`, npm organisation `agent-sandbox`, GitHub repository `agent-sandbox/agent-sandbox`.

## Test Strategy
CI runs typecheck, lint, unit tests and `scripts/check-repo-health.sh --strict`.

## Acceptance criteria
- Health script exits 0 with `--strict`.
- `npm publish --dry-run` succeeds with the declared metadata.

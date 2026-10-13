# Decision: Tag-triggered npm release workflow replaces the release-event publish workflow

Status: implemented

## Problem
`.github/workflows/publish.yml` published to npm when a GitHub Release was published. Releases are cut by hand
after the tag, so the npm publish depended on a second manual step and could not verify that the tag and
`package.json` agree. The layout review (`2026-10-12-cli-repository-layout`) asks for a tag-driven release.

## Decision
- Add `.github/workflows/release.yml`: on a `vX.Y.Z[-pre]` tag it checks that the tag equals the
  `package.json` version, runs `npm ci`, typecheck, build and unit tests, `npm pack --dry-run`, then
  `npm publish --provenance --access public` (job permission `id-token: write`, protected `npm` environment,
  `NPM_API_TOKEN` until a trusted publisher can be configured after the first release).
- Remove `.github/workflows/publish.yml`: its steps are a strict subset of `release.yml`; keeping both would
  publish the same version twice. `release-binary.yml` is unchanged and still runs when the GitHub Release is
  published.
- Add `docs-links.yml` (lychee: offline relative-link check on pull requests, full check weekly), `.nvmrc` (20),
  `eslint.config.js` with `npm run lint` (also run by `make ci` and the `lint` job in `ci.yml`).
- Removed Python leftovers: none remained to delete. `benchmarks/bench_cli_startup.py` was already replaced by
  `benchmarks/bench_cli_startup.mjs`; `scripts/build_hermes.sh`, `deploy_all_templates.sh` and
  `deploy_remaining.sh` were already rewritten to call the `abx` executable (see
  `2026-10-12-open-source-hygiene`) and are kept because they have no replacement.

## API Design
N/A — this decision does not involve API changes.

## Alternatives considered
- **Keep `publish.yml` and add `release.yml`** — publishes twice for one release.
- **Trusted publishing (OIDC) only** — requires the package to exist on npm first; revisit after 0.3.0.

## Dependencies
GitHub environment `npm`; repository secret `NPM_API_TOKEN`; npm organisation `agent-sandbox`.

## Test Strategy
Dry run with `npm pack --dry-run` in CI; the first tagged release exercises the publish step.

## Acceptance criteria
- Pushing `vX.Y.Z` publishes `@agent-sandbox/cli@X.Y.Z` with provenance, and fails when the versions differ.
- `scripts/check-repo-health.sh` passes its `release.yml` checks.

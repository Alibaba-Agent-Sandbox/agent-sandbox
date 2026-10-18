# Testing and the Definition of Done

How `abx` is verified end to end, and the rule that decides when a change counts as finished.

> 中文版本:[../../zh/guide/testing-e2e.md](../../zh/guide/testing-e2e.md)

## Three layers of verification

| Layer | Tool | Real components? | Credentials | Typical time |
|---|---|---|---|---|
| Unit tests | `make test` (vitest) | no (mocks) | none | seconds |
| Differential harness | `node parity/diff/diff.mjs` | no (stub cloud), but two real binaries | none | about 1 minute |
| Black-box E2E | `npm run e2e` | **yes** (real cloud, real binary, real filesystem) | `.env` or environment | 5 to 10 minutes |

Only the third layer can close the "E2E" item of the Definition of Done.

## Run the E2E suite

```bash
cp .env.example .env            # fill in real credentials; .env is gitignored
ABX_BIN="node dist/bin/abx.js" npm run e2e     # after npm run build
npm run e2e:offline                            # no credentials needed
npm run e2e:cleanup                            # dry-run janitor for leaked sandboxes
```

The suite is language-neutral: it runs any binary selected by `ABX_BIN` with an isolated HOME, no CI
variables, masked output and tracked cleanup. Every sandbox it creates is destroyed, and a final
`leak-check` scenario fails the run if one survives. See [`e2e/README.md`](../../../e2e/README.md) for
suites, scenario format and environment variables. Recorded results are in
[`e2e/BASELINE.md`](../../../e2e/BASELINE.md).

## Compare two binaries

```bash
ABX_ORACLE=abx ABX_BIN="node dist/bin/abx.js" node parity/diff/diff.mjs --verbose
```

Identical argv runs against both binaries and a stub cloud; exit codes, normalised output, written files
and the HTTP traffic are diffed. Details: [`parity/diff/README.md`](../../../parity/diff/README.md).

## Credentials

Real credentials live only in gitignored `.env` files or environment variables (`ABX_SANDBOX_API_KEY`,
`ABX_SANDBOX_BASE_URL`, `ABX_SANDBOX_DOMAIN`, `ALICLOUD_ACCESS_KEY_ID`/`ALICLOUD_ACCESS_KEY_SECRET`, `ACR_NAMESPACE`, `ABX_LLM_API_KEY`,
`OPENAI_BASE_URL`). Never print, log or commit them; the suites mask them in everything they capture.

## Definition of Done

A change is done only when all of these hold:

1. unit tests added/updated and passing;
2. E2E executed against real components;
3. the result recorded in `.agents/evidence/verify/<date>-<topic>.md` (no secrets, no leaked resources);
4. an ADR/note under `.agents/notes/{proposed,implemented}/<category>/<date>-<slug>.md` whose `Status:` matches its directory;
5. docs updated in English and Chinese;
6. a `CHANGELOG.md` entry under `[Unreleased]`.

If the E2E cannot run, the change is **blocked**, not done. The full rule with the evidence and ADR
templates is [`.agents/notes/DEFINITION-OF-DONE.md`](../../../.agents/notes/DEFINITION-OF-DONE.md).

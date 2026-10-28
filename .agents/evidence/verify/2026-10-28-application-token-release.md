# Verification: Authenticated application-token repair and CLI 0.5.8

- Date: 2026-10-28
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/207
- Result: PARTIAL — candidate npm/binary checks and real application E2E pass; current-head CI and release publication pending.
- Scope: application-token guidance plus version-only 0.5.8 preparation, unchanged dependency resolutions.

## Corrected prerequisite discovery

The initial report only inspected process/runtime credentials and missed the existing workspace
root dotenv file. It did not establish absence of project credentials. The existing dotenv now
supplies GitHub and Express credentials directly to child environments; values are neither
printed nor copied into repository files. GitHub identity and repository access were verified.
The earlier local result remains historical and is superseded for delivery status by this run.

## Executed checks

- `node e2e/initialized-template.mjs --application` against the built candidate: PASS.
  Missing application authentication prompted, generated a saved token, injected it into a real
  Express application, verified authenticated discovery and reused the saved token in a later
  command. Hidden input was not echoed. The owned sandbox was killed; independent HTTP 404
  confirmed absence; the temporary user configuration was removed.
- Updated the same E2E harness to recognize the prompt's explicit ABX_SERVER_TOKEN label and
  corrected its bilingual runner documentation. No cloud authentication was relaxed.
- `npm run build` with package/lock version 0.5.8: PASS.
- `ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence`: PASS, 119 tests; new version
  snapshot lives in release-20261028-0.5.8; historical release snapshots unchanged.
- Focused setup/environment/guidance/golden/real-PTY suite: PASS, 158 tests in five files.
- Prior complete local suite: 20 failures also reproduced on unchanged base; remote full CI
  will establish the release environment result. No checks are skipped to hide those failures.

## Candidate distribution and cloud checks

- Packed `@agent-sandbox/cli@0.5.8`, installed the actual tarball under an isolated prefix,
  and ran `scripts/check-release-artifact.mjs`: PASS (version, isolated guidance, single JSON,
  standard/native help, terminal menu and complete license notices).
- Built standalone Linux x64 0.5.8 and ran the same artifact checks: PASS.
- Ran `e2e/initialized-template.mjs --application` through the installed npm candidate: PASS,
  including generated token injection, subsequent authenticated command discovery and independent
  HTTP 404 cleanup of the one owned sandbox. The isolated saved configuration was removed.
- The generic API-key guided runner initially timed out. Its missing-key child environment still
  contained alternative build credentials and its menu marker used an obsolete colon. Isolate
  those alternative credentials for this API-key-specific scenario and use current terminal
  input/marker matching. Rerun via the installed npm candidate: PASS, hidden command-only key,
  real create/exec continuation, no credential persistence and independently confirmed deletion.
- Full `e2e/initialized-template.mjs` via the installed npm candidate: PASS, real hidden API-key
  entry, generated saved application token, catalog selection, billable create confirmation,
  remote execution and independent HTTP 404 cleanup. Its first run timed out at step zero because
  the fixture expected the old `input masked)` suffix; matching the stable Sandbox API key prompt
  prefix handles the current AK/SK option text without changing product behavior.
- Typecheck and ESLint on the 0.5.8 candidate: PASS; zero lint errors and 275 existing warnings.
- Repository health: PASS=105, WARN=11, FAIL=0. Hygiene and scoped diff/secret checks: PASS.
- PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/208.

## Release gates

The user explicitly requested release. Version 0.5.8 is prepared through the existing PR/tag,
five-platform binary, immutable npm candidate, public installation and website mirror workflow.
Do not publish a draft until every platform succeeds; verify actual merge/publication state.
Candidate artifact and final remote results will be appended here before merge/publication;
pending work is not a pass. Credentials never enter Actions configuration or public evidence.

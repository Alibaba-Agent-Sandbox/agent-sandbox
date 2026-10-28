# Verification: Authenticated application-token repair and CLI 0.5.8

- Date: 2026-10-28
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/207
- Result: PARTIAL — candidate regressions and real application E2E pass; remote CI and release verification pending.
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

## Release gates

The user explicitly requested release. Version 0.5.8 is prepared through the existing PR/tag,
five-platform binary, immutable npm candidate, public installation and website mirror workflow.
Do not publish a draft until every platform succeeds; verify actual merge/publication state.
Candidate artifact and final remote results will be appended here before merge/publication;
pending work is not a pass. Credentials never enter Actions configuration or public evidence.

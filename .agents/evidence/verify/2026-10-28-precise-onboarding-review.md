# Verification: Precise onboarding adversarial review

- Date: 2026-10-28
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/212
- Base: fc37ad54288383eca30cce50029289331a9d5bef
- Result: PARTIAL — scoped behavior and actual installed-package cloud use pass; local full suite retains 20 unchanged-main environment failures; remote latest-head gates pending.
- Package: source-derived 0.5.8 candidate, built with npm lockfile, packed and installed under an isolated prefix. No release/tag was published.
- Environment: Linux, Node v22.22.2, Python 3.13.13; Express selected explicitly from the existing ignored project dotenv. Secret values and target overrides were supplied only to test child processes and are not recorded.

## Observed defects and corrections

The added regressions on unchanged production source failed for pre-intent Abort wrapping and missing-authentication source/verbosity (71 passed, 2 failed). The corrected 75-test focused run covers both, source-consent decline and post-intent recovery. An initial full run exposed a stale PTY wrapper expectation of seven scenarios after adding an eighth; the wrapper now checks eight and passes in the subsequent full run. No timeout or behavior assertion was relaxed.

## Cross-repository entry-point review

This is an entry-point/content review, not a new all-template/backend qualification run.

| Owner and reviewed revision | Surfaces inspected | Conclusion / disposition |
| --- | --- | --- |
| agent-sandbox fc37ad5 | Guided config, template launch/preparation catch, provider field help, coding-agent setup, EN/ZH launch/config guides | Fix demonstrated cancellation and irrelevant help; retain actual mutation consent. |
| python-sdk 9fdeef5 | README and Express/template server guides | External Python clients still need the same application token explicitly. Do not apply CLI auto-generation to library resolution. |
| nodejs-sdk 129e3d6 | README and gateway/application authentication | The server-only client scope and separate gateway/application credentials are material limits; do not remove them as verbosity. No runtime change. |
| awesome-providers 188b04c | README, runtime/provider installation and acceptance boundaries | Provider/plugin setup and actual managed mutations need separate permission scope. Do not replace provider-specific requirements with generic AK/SK claims. |
| awesome-templates d2112df | README launch and credential guidance | Published 0.5.8 guidance still has a save selector. Do not rewrite pinned instructions as if unreleased PR211 behavior were public. |
| registry 282734e | Template launch page, install pin, conditional application-token hint, task/cleanup steps | Old 0.5.6 pin and unexplained manual token prerequisite need a published-version correction in owner Issue87. |
| website b745d2a | README routes and Start view CLI/Python/MCP entry points | CLI configuration block has both an environment example and a saved-key alternative, plus an explicit default region. Further reduction is separate from the demonstrated CLI defects; no site source changed here. |
| blogs 7926e3f | README, pinned practice installation/authentication instructions | Preserve executed versions and external-client credentials. A historical practice is not current auto-setup or all-template qualification. No article rewritten. |

## Commands and actual results

| Command / check | Result |
| --- | --- |
| npm ci --no-audit --no-fund | PASS; locked dependencies; npm reported two blocked package install scripts |
| npx vitest run tests/test_cli/test_guidance_contract.test.ts tests/test_providers/test_template_launch.test.ts (before fix) | Expected FAIL: 2 regressions reproduce the defects |
| npx vitest run tests/test_providers/test_template_launch.test.ts tests/test_cli/test_guidance_contract.test.ts tests/test_cli/test_template_onboarding_pty.test.ts --reporter=dot | PASS:75 tests, including actual terminal wrapper |
| npm test -- --reporter=dot --reporter=json --outputFile=unit.json (report outside repository) | First full run:4584 passed,21 failed,5 skipped; own PTY scenario-count expectation corrected |
| npm run parity:coverage (with the same pinned SDK/provider fixtures as CI) | Ledger PASS:907 passed,0 missing/failed,11 moved and verified; actual full Vitest report:4637 total,4612 passed,20 failed,5 skipped |
| Unchanged-main exact six failing file rerun | The same20 failed full test names reproduce on fc37ad5; final full-run failure set equals the unchanged-main set. Proxy/loopback transport and provider/engine assertions are outside this patch; no full-green claim. |
| npm run typecheck; npm run lint; npm run build | PASS; lint0errors,275existing warnings |
| npm pack; npm install --global --prefix PREFIX TARBALL; node scripts/check-release-artifact.mjs PREFIX/bin/abx | PASS:actual installed version/help/native/standard/JSON/cancellation/notices |
| npm run check:hygiene; bash scripts/check-repo-health.sh; git diff --check | PASS:hygiene,105health passes/11historical warnings/0failures, clean whitespace |
| ABX_BIN=INSTALLED_ABX node e2e/onboarding.mjs | PASS:eight terminal scenario groups; decline/Ctrl-C, no intents, hidden input, no repeated scope, concise automation errors, one JSON document |
| ABX_BIN=INSTALLED_ABX node e2e/initialized-template.mjs --guided-application | PASS:fresh-home guided platform key, automatic application auth, real creation/exec, subsequent discovery and hello, wrong-tokenHTTP401 |

The production-file identities under review are:

```json
{
  "src/cli/template_launch.ts": "af8aedb7c8e55aa36e51e70c234e874ddd117af5bdc16b10197d1b1fcb43df18",
  "src/cli/config_guidance.ts": "d94af77585b7e23e25cf69f985f2fccb28e10359a44e498a73de7f66c32d152f",
  "src/providers/alicloud_express/cli/configuration.ts": "cf610671f4d80d5b64d1b3a0e75003ceb66244f3416b8869979fd59d2d899898"
}
```

## Cleanup

Both the source-built and final packed/installed cloud runs deleted only their owned sandbox and independently received HTTP404. Isolated temporary configuration was removed by the harness. Cancellation creates no cloud resource intents. No managed API key was created or renewed; no Docker/image work was needed.

## Remaining gates and limits

Owner health/hygiene passed. Latest-head remote CI/review and merge must be checked before publication. Existing local full-suite failures are recorded above, not skipped or converted to passes. This patch does not publish a new CLI version, refresh historical template acceptance, or certify every project interaction.

# Verification: Default saved guidance and automatic application authentication

- Date:2026-10-28
- Base:7aac212d6a9017e19f79d4ac60848857a9a4ffa8
- Issue:https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/210
- PR:https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/211
- Result:PARTIAL — scoped regression and actual Express acceptance pass; mandatory remote CI/review is pending at this evidence point. Full local suite has the same20 unchanged-main failures, explicitly retained below.
- Candidate:built Node CLI source, package version0.5.8; no release/version/tag change.

## User experience and source scope

The user replaced the earlier command-only default with automatic current-user persistence. The earlier phase at4c7f049 is preserved in its own dated evidence. Final setup asks for missing values directly, saves supported fields by default, reads them back before continuing and never displays a Configuration scope selector. Explicit existing options/environment values remain unpersisted overrides. Application authentication is generated and reused without a second setup phase. Normal API-key setup omits managed-key permissions/expiry text and internal missing-key/remediation dumps; verbose diagnostics and the actual AK/SK mutation consent retain their detail. Sensitive AccessKey identifiers are hidden using the existing provider sensitivity metadata.

## Commands and actual results

| Check | Result | Evidence |
| --- | --- | --- |
| Updated focused regressions/goldens/real-PTY | PASS |283 tests in eight files; includes default persistence, explicit temporary overrides, source/provider isolation, partial credential pairs, type validation, cancellation before writes, readback conflicts, storage errors and managed-key consent boundaries |
| `npm test -- --reporter=json --outputFile=parity/.vitest-report.json` with CI-pinned SDK/provider sources | FAIL |4582 passed,20 failed,five skipped. All20 failure identities exactly match unchanged main7aac212 across the six existing engine/provider/transport files. No newly failing identity remains |
| `npm run typecheck` | PASS |Strict TypeScript |
| `npm run lint` | PASS |Zero errors;275 existing warnings |
| `npm run build` | PASS |Built the actual candidate used below |
| `npm run parity:coverage -- --no-run` with combined actual unit and integration JSON reports | PASS |907 ledger entries and11 moved entries verified; an additional26 actual integration tests pass. This does not relabel the broader local suite as passing |
| `make dist-check` | PASS |Actual package entry and reference closure |
| `ABX_CAPTURE_ONBOARDING=1 node e2e/onboarding.mjs` | PASS |Seven real terminal scenarios; no save-scope selector or token prompt, default private persistence, hidden input/Ctrl+C, billing rejection, and automation/piped-output boundaries |
| `ABX_BIN=<built candidate> node e2e/initialized-template.mjs --guided-application` | PASS |Real Express fresh-home terminal key entry, default saved platform/application credentials, no scope menu or managed-key text in API-key path, real creation/exec and later native discovery/hello business invocation from processes with credential environment variables removed |
| Same real Express flow:wrong application token | PASS |Incorrect token remainsHTTP401; authentication is not disabled |
| Independent owned cleanup | PASS |Exact newly created sandbox deleted and independently absentHTTP404; isolated saved configuration removed |

The updated test fixtures initially retained old scope answers and command-only assertions. These produced17 failures, then one stale environment assertion after fixture updates. The first new real-terminal run also waited for a hidden AccessKey-ID prompt; this exposed that shared guidance ignored the provider's sensitive-ID metadata. It now uses that existing metadata and has a regression. Final283-test results include these corrections; no timeout or authentication assertion was relaxed.

## Reproduction and output

Use the existing ignored project dotenv only in the test child environment. No root environment value is printed or copied into repository records. The terminal capture is [default saved configuration](../cli/2026-10-28-default-saved-configuration.md). It declines billing and retains the existing generic preparation diagnostic; the separate positive cloud scenario above establishes actual successful application use.

Source files under test, SHA256:

```json
{
  "src/cli/config_guidance.ts": "c62db7824e0ef30f4ecb5aed055cb08ba370cd52289f2815d4701885b1b3b939",
  "src/cli/template_environment.ts": "8c7a9f78dd87aa96069e5c170b1fcc038571c2b13b3c084507ff7e449dff2070",
  "src/cli/configuration_help.ts": "83abaaa982e584679d0dffe9be1b00afadc72fc56cb6c260d71f36a080297b31",
  "src/cli/commands/sandbox.ts": "94f575c6bff0a5068d9aa0604745175deea8a282f960ef19a239b603bcae7ed9"
}
```

## Cleanup and remaining gates

The task-generated ignored parity JSON is moved out of the repository after its results are inspected so health checks do not ingest machine-local test paths. All historical captures and earlier phase evidence are preserved. No Docker image/template build is needed by the real managed fixture. No cloud management key or CI secret is created, restored or renewed. Remote current-head CI and review determine readiness; no merge or public release is claimed at this evidence point.

## Final local record checks

The first parity reuse attempted only the standard unit report, which intentionally excludes two integration files, and retained an obsolete test-name mapping after the default-persistence change. It correctly reported27 missing entries. The excluded26 integration tests were then actually executed and passed; their actual results were combined with the unit results for parity only, and the one changed-contract mapping now points to the executed default-persistence regression. The immutable historical ledger is unchanged. Final parity:907 passed, zero failed/skipped/missing,11 moved entries verified. The original unit report still records20 unchanged-main failures.

Final health:PASS105/WARN11/FAIL0; hygiene and diff checks:PASS. Current-head remote checks for the earlier4c7f049 phase completed successfully, but cannot substitute for the final default-persistence head. The final head still requires its own CI/review.

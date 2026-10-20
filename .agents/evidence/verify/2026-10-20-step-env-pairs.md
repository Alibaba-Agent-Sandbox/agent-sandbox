# Platform ENV pair verification

Result: PARTIAL — scoped actual cloud behavior PASS; current-head remote CI and merge pending.

Base: 4aec47b734be04fbadc932b0bbf4cd7ae0ac1eb4. Scoped source: src/template/build_plan.ts, existing build-plan regression, bilingual build-mode contract and changelog.

- Regression before fix:1 FAIL/6 PASS; incorrect joined key=value argument observed.
- Regression after fix:7 PASS, including literal spaces/equals in values.
- Reproducible npm ci using committed lockfile PASS; npm run build PASS; npm run typecheck PASS; npm run lint exit0 with253 existing warnings.
- Full npm test executed:3988 PASS/10 FAIL/56 SKIP across168 files. The10 failures are in existing loopback HTTP/TLS/WebSocket transport cases; those files are unchanged. This local suite is not reported as passed; latest-head remote CI remains mandatory.
- Legacy native offline black-box suite executed:45 PASS/17 FAIL/1 SKIP, zero cloud resources; not passed and not used to certify the ENV change.
- Configured hygiene/engineering health checks and real cloud continuation are recorded below when complete.

An initial actual source-compiled native step build reached READY and CLI/SDK smoke, but the added process-environment assertion returned a differing value; owned sandbox/template absence independently confirmed. The test used a reserved ABX-prefixed variable, so a corrected ordinary-name probe is running. The guard is not weakened and the failed probe is not promoted. Private resource identifiers/logs remain local.

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/84. No PR/merge/closure claim yet.

## Final source behavior and executed verification

The ordinary-name second probe also failed despite accepted ENV/READY; the reserved-prefix hypothesis was disproved. A third probe confirmed that an independent envd process does not inherit startup-command environment. Neither failed probe is promoted. All owned cleanup independently passed.

The final compiled native CLI now supplies final ENV pairs to explicit generation-2 start/readiness commands using a quoted /usr/bin/env shell wrapper. A fourth genuine step build reached official READY, actual Python SDK creation and CLI/SDK smoke. A named run_script subprocess read the exact requested value containing spaces/equals. Independent owned sandbox/template absence passed. The independent envd process still did not inherit that value; docs explicitly scope the wrapper to startup/readiness processes. Generation1/default entrypoints remain provider-defined. [Sanitized actual result](2026-10-20-step-env-runtime.json).

Focused build-plan/deploy suites26 PASS, including a real local shell roundtrip with quotes/equals/command-substitution text, complete compound-command scope, duplicate-key overwrite and no injected marker file. Final npm test executed3990 PASS/10 unchanged local transport FAIL/56 SKIP; the three HTTP/TLS/WebSocket files are unchanged. Latest-head remote Node20/22 CI remains mandatory. Build/typecheck/lint PASS (existing lint warnings); configured hygiene PASS; engineering health105 PASS/11 WARN/0 FAIL before this final evidence append. Old native black-box offline45 PASS/17 FAIL/1 SKIP remains a failed legacy-surface run, separate from the actual source-native ENV cloud acceptance. No full-suite or standard-interface pass is claimed locally.

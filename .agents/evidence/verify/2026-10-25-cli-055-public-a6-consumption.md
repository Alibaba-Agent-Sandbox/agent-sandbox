# Verification: CLI 0.5.5 final runtime dependency

- Date: 2026-10-25
- Result: PARTIAL — public SDK6 installation, generated dependency installation and real component checks completed as detailed below; final owner CI and CLI5 publication pending.
- CLI base: public0.5.4 merge3ff60603606466e0154ceaa7c1c051651084de0e; functional correction commit e561eee and current server-example commit56b8dd2.
- Issues: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/177 and https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/178.
- SDK dependency review: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/131, reviewed merge8e610a3658040d8d6973e7951f9590ea50a4d70a. Official publisher40225846586 attempt1 completed successfully. Independent maintainer checks matched all four candidate files, PyPI metadata and downloaded file hashes. Fresh official installation of client==0.4.0a6 automatically installed server==0.4.0a6; pip check passed. Source pinning and public installation are recorded separately.

## Final scope

Use the existing shared exact Python client/server0.4.0a6 pin for generated applications, standard Python scaffolds and MCP artifacts, with the normal locked vendor generator and provenance checks. Keep CLI0.5.5 as the minimal next patch. No new runtime mechanism, compatibility namespace, output mode or workflow flag is introduced.

The first managed coding-agent install now uses the existing stderr information channel; stdout stays one final JSON result. The [functional verification](2026-10-25-managed-agent-json-output.md) preserves the genuine public4 failure, safe exact recovery, failing-before/passing-after regression and true fresh-HOME candidate result with public SDK4. That result is not relabelled SDK6.

The four current server examples use command/start. The tutorial now selects the actual official npm5 target rather than claiming a released checkout must be built locally, separates platform/model/application credentials, keeps canonical ABX configuration while explaining legitimate standard E2B aliases, and explicitly runs commands.py in a prepared guest application template with the same application token. Source downloads and registered platform IDs remain distinct. The [public4 real HTTP receipt](2026-10-25-cli-command-docs-public-a4.json) covers greeting/schema/authentication and exact PID absence; the [new public6 HTTP repeat](2026-10-25-cli-command-docs-public-a6.json) passes all four original code blocks, actual schema, greeting, missing-token 401 and independent absence of each owned server PID.

## Preparation and historical boundaries

A preliminary publicSDK5 consumption delta was locally generated and tested before the final namespace audit found more documentation defects. Its source patch/hash and actual 367 focused passes/7 provenance passes are retained outside the repository. It was not pushed, merged, published or relabelled SDK6.

The final reviewed SDK6 source can be used to prepare the final exact pin and regenerate standard assets. After official publication and independent file readback, fresh base installation and fresh generated MCP requirements installation both succeeded from the official index. No test was skipped to work around a nonexistent dependency.

The Docker regression uses the production builder to inject a wheel built from the exact SDK release-tag source, compares all installed server-module bytes, runs as non-root and preserves original RUN behavior. It is not a claim that the local wheel's archive bytes equal the PyPI wheel. Fresh generated MCP requirements separately install actual public PyPI dependencies. Their local network HTTP check failed as recorded below; it is not described as successful HTTP verification.

## Current verification

- Normal locked standard vendor regeneration and final build/typecheck pass; provenance 7/7 passes. Focused final dependency tests passed 367/367 before the final help-only correction.
- Fresh official public6 base installation, automatic exact server pairing and pip check pass. The four [current document HTTP examples](2026-10-25-cli-command-docs-public-a6.json) pass against this installation, with each owned process independently absent afterward.
- The actually generated MCP artifact uses only official-index `agent-sandbox-client[mcp]==0.4.0a6`. A separate new venv installed those requirements and pip check passed.
- Its [real network HTTP probe](2026-10-25-cli-055-mcp-public-a6-http.json) FAILS with `socket hang up`, after zero cloud requests; its owned server process stopped. The first unauthenticated readiness POST failed immediately before a startup log was observed; no readiness or handshake status had been established. The [diagnostic](2026-10-25-cli-055-mcp-public-a6-http-diagnostic.json) preserves this boundary. Do not replace it with an in-process result. A separate [real HTTP diagnostic after actual Uvicorn startup](2026-10-25-cli-055-mcp-public-a6-http-after-ready.json) passed missing/wrong-token 401, initialize, all 15 tool names and schemas, with zero cloud calls and the owned process stopped. This isolates the initial failure to the pre-ready probe, without asserting why the initial connection reset occurred.
- The separately labelled [ASGITransport test](2026-10-25-cli-055-mcp-public-a6-asgi.json) passes initialize and five real cloud tools: create, command output 42, UTF-8 write/read and kill. An independent SDK lookup confirms the exact owned sandbox is absent. This does not verify network HTTP transport.
- Full final local tests: 4401 PASS / 10 FAIL / 50 SKIP (189 passed files, 3 failed files, 5 skipped). The ten failures remain in local proxy/TLS/WebSocket adversarial transport checks; they were not skipped or changed. Build, typecheck and ESLint pass (0 errors, 275 existing warnings); hygiene passes. The first health invocation found a machine-local path in the untracked generated parity JSON; that report was preserved outside the checkout before repeating health (106 PASS / 11 historical WARN / 0 FAIL).
- After the last help/diagnostic changes: build and typecheck passed again; current evidence, standard executable and prompt-dispatch tests pass 215/215.
- Current generation help now uses explicit `--prompt`; its affected help snapshot is generated into the new 0.5.5 dated directory, with an additional actual [offline evidence capture](../cli/cli-055-config-init-20261025/README.md). Earlier evidence remains unchanged.
- [Create syntax audit](2026-10-25-cli-055-create-syntax.json) demonstrates the existing standard/generic distinction without credentials or cloud creation. Generic create accepts positional ID or `--template`; Express standard create accepts the positional ID. This audit does not establish live provider readiness. The Express error hint is correspondingly limited to Express; it no longer incorrectly claims generic create cannot use `--template`.

The verifier now retries only connection-refused and connection-reset errors inside its existing bounded pre-ready loop. It still fails immediately if the server exits and preserves every authenticated handshake/catalog assertion after readiness. A [new cold-start real HTTP run](2026-10-25-cli-055-mcp-public-a6-http-cold-retry.json) passes the unmodified business assertions after two pre-ready resets, with zero cloud calls and its owned PID stopped. The original failing run remains above. This is a verifier startup-race correction, not an established product HTTP or host-network defect.

The maintained-entry scan includes hidden workflow files. Remaining old workflow strings are migration instructions, rejection fixtures or verifier receipt identifiers; old runtime pins remain only in explicitly labelled historical captures. The normal CI and publisher test-source pins now select reviewed merged SDK8e610a3658040d8d6973e7951f9590ea50a4d70a and provider126a50e3c4e4c6792019b9c96674d35a9518d8ad; stale under-review comments are removed. A fresh local parity run used these exact committed producer sources, not the dirty provider working tree: 907/907 ledger entries pass, all 11 moved SDK tests are found. Its underlying full run is reported separately below.

## Pending

- Final full owner/source checks and exact-head remote CI, including the real Docker wheel gate and independently installed network MCP artifact gate. Preserve the local network HTTP failure regardless of remote outcome.
- Normal review/merge, immutable CLI5 five-platform artifacts, GitHub/npm publication and fresh public developer cases. Case4 uses explicit native steps; this does not prove the default Git-source Docker preparation path.

Final current-producer underlying Vitest counts: 4466 PASS / 20 FAIL / 1 SKIP. Parity ledger coverage success does not erase these full-suite failures. The machine-local generated JSON is preserved outside the source checkout. The last new evidence-folder link also initially failed the dated-record slug check; the new capture folder was renamed to the existing capture-layout convention and final health was rerun, without changing the checker or old evidence.

Independent final review found and corrected one remaining Chinese MCP requirements table (old Git-source/uvicorn description) and two installation-guide sentences that prematurely described the pending CLI5 artifacts as published. Both languages now describe actual requirements and the current publication status. This delta changes documentation only; normal exact-head CI is rerun.

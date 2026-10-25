# Verification: CLI 0.5.4 runtime consumption and typed template absence

- Date: 2026-10-25
- Result: PARTIAL — local preparation; Python 0.4.0a3 is not yet publicly verified and CLI 0.5.4 has not been released.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/173
- Candidate: isolated branch from main e3ca2f160b9d50438a1ce6c758cf52b1bd2b6d72; Node/Linux.

## Scope

Consume the matched readiness-fixed Python client/server release in the shared exact runtime pin, generated applications, standard Python scaffold and MCP artifact. No CLI readiness implementation or new fallback is introduced. Regenerate standard runtime/templates through the existing locked vendor script and preserve previous goldens.

Native GetTemplate maps only the official SDK structured statusCode=404 and code=TemplateNotFound to existing TemplateNotFoundError E2001. Other status/code combinations, authorization, transport and message-only errors remain failures rather than proof of absence. The existing global error mapping returns exit 4 for E2001.

## Executed checks

- Locked main/vendor npm installation: PASS.
- Focused official-template and cloud-harness regressions: 100 PASS after removing the old E5000/string acceptance. The first development run retained a stale harness diagnostic expectation; its failure is not a product pass.
- Runtime/code-generation/scaffold/MCP/official-template/evidence suites: 393 PASS; after precise Python installation-hint label cleanup, the affected executable/template/harness suites: 123 PASS. Typecheck/build/hygiene and locked standard provenance (7 checks): PASS. The new 0.5.4 version golden was generated with the existing evidence runner; historical directories are unchanged.
- The final tree exposed a health-check false positive from newly merged dated JSON receipt links: 105 PASS / 11 historical warnings / 1 FAIL. The checker previously collected only Markdown stems while claiming to check ADR/evidence references. It now recognizes actual dated JSON files; strict Markdown ADR validation is unchanged, no missing-file ignore or synthetic wrapper is added. Final health/link scan after this fix: 106 PASS / 11 historical warnings / 0 FAIL.
- JSON-reference regression against the actual health script: a real dated JSON target passes; deleting it still fails. Temporary fixtures are removed. `make dist-check`: PASS (actual package entry and skill-reference closure).
- Actual read-only comparison using this session's exact previously owned/deleted template: public CLI 0.5.3 returns exit1/E5000; candidate 0.5.4 returns exit4/E2001. No new resource is created. The candidate text output also confirms E2001/exit4. The ID is omitted from the [sanitized readback](2026-10-25-cli-054-typed-template-readback.json).

- Full local `make ci`: 4382 PASS / 10 FAIL / 50 skipped. The 10 failures are the same local loopback/proxy/TLS/WebSocket diagnostics previously observed; the failed run remains retained. Typecheck, lint and build completed before the test failure. Later parity/distribution stages were not reached in that command; final clean remote owner checks remain required. This is not an all-green local CI claim.

## Pending

- Public Python 0.4.0a3 publication/readback, generated MCP fresh dependencies and real HTTP/auth/tool catalog, exact runtime wheel image gate.
- Final owner tests/build/typecheck/lint/provenance, independent review, immutable tag, five actual platform artifacts, GitHub/npm release and fresh public developer reruns.

Candidate package strings and source pins do not establish public installation or release success. Older 0.5.3/0.4.0a2 case receipts retain their original versions.

# Verification: CLI 0.5.4 runtime consumption and typed template absence

- Date: 2026-10-25
- Result: PARTIAL — Python 0.4.0a3 is published; final CLI artifact checks and CLI 0.5.4 publication remain pending.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/173
- Candidate: isolated branch from main e3ca2f160b9d50438a1ce6c758cf52b1bd2b6d72; Node/Linux.

## Published Python dependency

Python client/server 0.4.0a3 tag v0.4.0a3 points to a7d6aa3e5e16fcf8cde1d91465f4a5fc53f5a030. The normal [publication workflow 40209677091](https://github.com/Alibaba-Agent-Sandbox/python-sdk/actions/runs/40209677091) completed SUCCESS. Independent release/PyPI four-artifact byte hashes and fresh exact-client installation (matching server automatically installed), pip check and actual imports passed. The CLI's generated MCP requirements are additionally installed and exercised separately below; another agent's package readback is not substituted for that artifact test.

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

## Public-dependency artifact checks

- The actual CLI-generated requirements contain only official PyPI `agent-sandbox-client[mcp]==0.4.0a3`. A new venv with no development PYTHONPATH installed client/server 0.4.0a3 and all required MCP/ASGI dependencies; `pip check`: PASS.
- Local actual network HTTP: FAIL, socket hang up/ECONNRESET before initialization, no cloud requests. The owned process stopped. This is retained in the [local HTTP receipt](2026-10-25-cli-054-mcp-local-http.json); clean remote actual HTTP/auth/tool-catalog CI remains required.
- Separate in-process `httpx.ASGITransport` against that actual generated app with public a3: PASS. Five real cloud tool calls create a sandbox, run code producing42, write/read identical UTF-8 bytes and kill it; independent SDK typed NotFound confirms exact owned absence. This is **not network HTTP**, and is not combined with remote CI into one remote-host run. [Receipt](2026-10-25-cli-054-mcp-public-asgi-cloud.json).
- Exact local candidate npm tarball, installed into a new prefix, passes `check-release-artifact.mjs` with version0.5.4, real executable menus/guidance, one structured JSON result and all retained notices. This proves the installed candidate, not a public npm0.5.4 publication. Runtime source under test is local1de4d50878b1aa97a1851a4845e10b59c4ce2692; the subsequent record/changelog delta adds this evidence.

## Pending

- Generated MCP fresh dependencies and real HTTP/auth/tool catalog, exact public runtime wheel image gate.
- Final owner tests/build/typecheck/lint/provenance, independent review, immutable tag, five actual platform artifacts, GitHub/npm release and fresh public developer reruns.

Candidate package strings and source pins do not establish public installation or release success. Older 0.5.3/0.4.0a2 case receipts retain their original versions.

## Inherited security correction

This patch retains the generated application token validation shipped in public CLI 0.5.3, described by [GHSA-2fp3-8j5r-349q](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/security/advisories/GHSA-2fp3-8j5r-349q). The advisory's confirmed affected release is 0.5.1 and patched release is 0.5.3; this record does not expand that range. Public 0.5.3 positive and missing/wrong-token behavior was independently exercised in the prior versioned case receipts.

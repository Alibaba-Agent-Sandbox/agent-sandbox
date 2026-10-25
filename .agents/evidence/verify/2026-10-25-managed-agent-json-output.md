# Verification: first managed installation preserves JSON stdout

- Date: 2026-10-25
- Result: PARTIAL — focused regression and genuine candidate cloud run verified; final dependency/release gates pending.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/177
- Base: public CLI 0.5.4 source 3ff60603606466e0154ceaa7c1c051651084de0e.

## Genuine published failure

An actual public 0.5.4 standalone invocation used a fresh HOME and a PATH containing Node/npm/git but no ambient Qwen executable. The CLI installed its official managed Qwen Code build, generated a template and returned exit0 after 77.67 seconds. The subprocess used separate stdout/stderr pipes; only stdout was passed to `json.loads`.

Stdout contained an intermediate object with keys `status,message`, followed by the final object with keys `ID,Status,Template,URL,TemplateID,Services,EnvdVersion,provider`. The first object reported managed Qwen installation completion. The final object started after 119 characters, so the strict JSON consumer correctly failed. The original failed experiment remains unchanged outside this repository; no private IDs or raw cloud output are copied here.

Recovery used only the final object from this exact invocation and correlated its template with this invocation's known-owned template. One known-owned sandbox and one known-owned template were independently absent: SDK `SandboxNotFoundError` and CLI E2001 respectively. No account-wide listing/deletion or new cloud creation was used for recovery.

## Focused regression

- Actual dispatcher, output manager and generated-launch pipeline are used; external agent installation, generation and cloud APIs are test fixtures, not claimed as real cloud.
- Before correction: the new regression FAILS at `JSON.parse(result.stdout)` with a second JSON object.
- After changing only the installation-completion call from `success` to `info`: 90 PASS across `test_create_nl`, `test_create_backend` and `test_progress_activity_e2e`.
- The regression checks strict stdout parsing, final owned result shape, actual installation invocation and the completion diagnostic on stderr. It does not remove lines or change the consumer.

## Genuine candidate run

A new HOME and PATH without an ambient Qwen binary forced the actual official managed installation again. With only the output-channel correction, creation completed in 65.94 seconds. The unchanged strict JSON consumer parsed one final stdout object; installation completion was present only on stderr. All 54 runtime assertions passed, including CLI execution/file/process operations, PTY, SDK application calls, real POST authentication and the remote server matching the public a4 client. Exact owned sandbox and template deletion returned independent typed absence. See the [sanitized candidate receipt](2026-10-25-managed-agent-json-candidate.json).

This run used a candidate build carrying the base package version 0.5.4 and public Python 0.4.0a4. It proves the source correction, not public CLI 0.5.5 or the pending SDK 0.4.0a5. The original public 0.5.4 failure is preserved.

## Local source checks

- Locked `npm ci`: PASS. Typecheck and lint: PASS (0 lint errors; existing warnings retained).
- Full `make test`: 4401 PASS / 10 FAIL / 50 skipped. The failures are the known host loopback/proxy/TLS/WebSocket cases across three test files. They remain enabled; this is not a full local green claim. Clean remote Node20/22 owner checks remain required.
- The evidence runner regenerated current version/create snapshots into the new 0.5.5 directory, preserving all previous version snapshots. The registered deterministic evidence tests: 118 PASS; actual capture: 12 create cases and 1 version case.
- Repository health: 106 PASS / 11 historical warnings / 0 FAIL after replacing an initial temporary dependency symlink with an actual locked installation. No symlink is staged or published.

## Pending

Final public SDK consumption/generation checks; owner CI, independent review, five platform binaries, official GitHub/npm publication and fresh public developer reruns. Candidate package strings do not prove publication.

## Current command-registration examples

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/178. A separate current-docs scan found the tutorial and CLI reference in both languages still importing a nonexistent module-global `registry` from the server package. Public server0.4.0a4 raises ImportError for that [original import](2026-10-25-cli-command-docs-original-import.json). The four current examples now use the existing `command`/`start` exports and a normal `__main__` startup guard; no alias or runtime mechanism is added. The explicitly historical e2e-template-workflow captures remain unchanged.

Each corrected **actual document block** ran in its own real local HTTP subprocess with public server0.4.0a4. Command discovery reported the required string argument, POST returned `Hello, World!`, missing authentication returned401, and every exact owned PID was independently absent after termination. [Receipt](2026-10-25-cli-command-docs-public-a4.json). SKILL, references and standard scaffold sources contain no matching removed global-registry import. Final coordinated SDK6 replay remains pending; these a4 observations will not be relabelled.

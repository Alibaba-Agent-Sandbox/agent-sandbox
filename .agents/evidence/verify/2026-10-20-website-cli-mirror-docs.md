# Verification: website CLI mirror installation documentation (agent-sandbox)

Date: 2026-10-20
Result: PARTIAL — verification in progress; remote CI, merge and registry public readback remain delivery gates.

Scope: CLI README translations, the binary guide, getting-started/MCP/workflow/troubleshooting guides, agent installation guidance and CHANGELOG. Changes are documentation only. Website behavior is delivered by https://github.com/Alibaba-Agent-Sandbox/website/pull/19 and https://github.com/Alibaba-Agent-Sandbox/website/pull/20 . Node.js 22.22.2, Linux x64; no credentials are recorded. Original checkouts and merged historical evidence are preserved.

## Checks

- `npm ci`: PASS using the unchanged package-lock.
- `bash scripts/check-repo-health.sh --quiet`: PASS, 105 passes, 11 existing warnings, zero failures. Relative Markdown links and ADR structure included.
- `npm run check:hygiene`: PASS.
- `make ci`: PARTIAL / exit 2. Hygiene, typecheck, ESLint and package build passed. Unit tests: 4,032 passed, two skipped and 20 failed in six existing engine/provider/raw TCP/TLS/WebSocket test files. Examples include loopback network responses/errors differing from expected raw protocol output and certificate/proxy expectations. No runtime or test files changed. Parity coverage and final dist-check did not run after the test step failed. These local failures are disclosed; current-head hosted Node 20/22 CI remains required before merge. No claim is made that the full local suite passed.
- Fresh public website installation: PASS. With version/base/discovery overrides unset, the real Linux x64 binary was downloaded from the website, SHA-256 verified, and version 0.4.0/help executed. Temporary installation removed.
- Full public macOS ARM64 download: PASS, 120,653,264 bytes; SHA-256 `60113dcc982bb8c9817f78801cd4a82560178abadb7342c78416792dda167a77` matches the website sidecar and upstream release. This verifies downloads, not macOS execution.
- Public installer/provenance: PASS, delivered SHA-256 `6bd461d980c794ede2d10c799a42b999bf1142b9bee1231b13aeab9cb6902b6c`; mirror metadata lists all 12 files.
- Scoped Markdown-only diff, new relative links, ADR structure/status and POSIX default-entry coverage: PASS. Only deliberate bilingual GitHub fallback examples remain among active CLI guides; registry default examples all use the website domain. `git diff --check`: PASS.


## Boundaries

No executable implementation, shared UI, dependency or cloud provider behavior changes. Windows/macOS executable execution is not claimed on Linux. Real installation/download checks verify the documentation's delivery endpoints, not cloud sandbox APIs. No cloud sandboxes are created by this task. Current-head hosted CI and public deployment results are checked independently before final reporting.

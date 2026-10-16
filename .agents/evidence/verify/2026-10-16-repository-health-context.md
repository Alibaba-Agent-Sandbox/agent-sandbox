# Verification: repository health context

- Date: 2026-10-16
- Change: [Issue 38](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/38).
- Result: PARTIAL; current health passes, regression/runtime/remote gates are ongoing.
- Environment: Node.js 22.22.2, Linux; current branch based on main `7854c31`.

## Executed checks

Original `bash scripts/check-repo-health.sh --quiet`: 94 PASS, five WARN, ten FAIL.
After syntax, provenance and current document repairs: 104 PASS, twelve WARN,
zero FAIL. Historical contextual findings remain warnings and two old unavailable
captures remain explicitly unavailable. The new bilingual contributor page is
added after this run; its final result will be recorded separately below.

The original lockfile matches the existing development checkout byte for byte.
An attempted hard-link dependency reuse failed across filesystem devices. A
concurrent `npm ci --cache <temporary-cache> --no-audit --no-fund` exited one
without a diagnostic beyond its log location. Neither attempt is an install pass.
A normal independent dependency copy from the same-lock existing installation is
being used for local validation; full remote CI still installs using `npm ci`.
An initial Vitest attempt through NODE_PATH could not resolve ESM dependencies
and did not run tests. No shared dependency files were modified.

## Historical boundaries

The seven ledger files have exact hashes and specific finding keys; original
bytes remain unchanged. The old CLI reduction ADR is present in `superseded/`.
Ten SDK research slugs resolve to verified source files in python-sdk. Two old
capture references in accepted notes are absent from current sources and the
available path history: their absence is disclosed, not replaced with invented
evidence. Product code cannot receive historical context.

## Remaining verification

Focused positive/negative controls, full local/runtime CI, real CLI recipes,
latest-head remote checks and independent review are still pending. No cloud
resource has been created by these maintenance checks so far.

## Final local results

- Six focused regressions PASS (final 4.29 seconds). These cover canonical URLs,
  actual imports versus comment/string examples, a real undeclared runtime
  package causing the complete checker diagnostic, missing development-toolchain
  refusal, parity/fixture boundaries, actual removed-CLI invocations and
  hash/finding/path invalidation of historical context.
- Final checker: **105 PASS, 11 WARN, zero FAIL**, exit zero. Seven historical
  context warnings remain visible; the other four optional warnings concern
  formatting/ownership/release-hook suggestions. No strict-mode success is claimed.
- All seven registered historical files are byte-identical to `origin/main`,
  and their SHA256 values match the ledger. All relative document links resolve.
- Typecheck, build and ESLint: PASS; lint reports zero errors and 221 existing
  warnings. Path/secret hygiene and `git diff --check`: PASS.
- Full local runtime suite: **3709 passed, 26 failed, 56 skipped in 60.30 seconds**.
  Ten files fail: template commands (six), transport network adversarial (six),
  template branches (five), WebSocket adversarial (three), and one each in
  adversarial MCP headers, Qwen extraction, MCP HTTP wire, MCP Python JSON oracle,
  adversarial CLI commands and refused-connection transport. Host-network/proxy/
  TLS and unavailable Docker are implicated, but an exact baseline comparison was
  not executed, so these are not asserted to be identical baseline failures.
  No unrelated tests or network restrictions were changed. The complete latest
  normal remote runtime matrix must be green to establish supported CI behavior.
- The current branch's built CLI ran the strict real Express black-box scenario
  through the corrected SDK harness: **one passed in 12.05 seconds**. All seven
  required feature rows executed: lifecycle/list, command execution/streaming,
  file read/write, kill and repeated kill. Credentials stayed in memory.
- Initial all-tag janitor dry run saw one parallel tagged resource and deleted
  zero. Subsequent read-only metadata counts showed no `cli-provider` sandbox
  and no owned loader-review sandbox, with one other tagged resource preserved.
  The isolated CLI Node engine stopped successfully. No unrelated resource was
  deleted and no owned CLI resource remained visible.

The maintenance diff contains no product command changes; the installer test
replaces a hardcoded temporary file URL with a portable nonexistent fixture URL.
Latest-head CI and independent review remain required before merge.

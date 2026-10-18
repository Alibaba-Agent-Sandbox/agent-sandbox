# Verification: retire orphan CLI ports

- Date: 2026-10-18
- Result: PARTIAL; exact final-head hosted checks and frozen-artifact cloud repeat pending
- Base: main 2eca074ae8ccf59ad3ce2ffd1382b97993eb3dc6
- Scope: nine retired source modules, empty session barrel, legacy template create,
  dedicated tests/exports, clean-build step and bilingual current architecture/migration docs.
- Environment: Linux; Node 22.22.2; npm 12; npm ci from unchanged package lockfile.

## Source and artifact verification

- TypeScript graph including type/literal dynamic imports: 151 -> 141 source
  modules, 134 runtime modules before and after. Independent esbuild graph:
  134 active internal modules after cleanup.
- Independent MCP entry agent/mcp_main.ts, active underscore compatibility
  helpers, DockerBuilder and official FC template adapter remain.
- Open CLI PRs 23/31/35/37/40/42 have no modifications to the retired modules.
  Cross-owner source search found no executable consumer; historical archive
  mentions are preserved.
- Typecheck and build PASS. ESLint: zero errors, 218 existing warnings.
- npm pack dry-run: 432 files; retired module outputs absent, main/MCP and
  Docker/official-template outputs present. The first ad-hoc reader expected
  npm's old JSON array shape; adapted it to npm 12's keyed object and reran.
- Incremental-build regression: seeded obsolete dist/api/image.js, ran the real
  build, confirmed stale output removed and active dist/bin/abx.js re-emitted.
  Clean prior dist before compiling, so old outputs cannot survive retirement.
- Byte comparison of 113 golden-capture/CLI-ledger files against base: PASS,
  all unchanged. No historical evidence is deleted or rewritten.

## Test outcomes

- Full normal unit suite: 3696 PASS / 24 FAIL / 2 SKIP. The same runtime base
  with identical dependencies repeated the nine failing files: 57 PASS / 24 FAIL.
  Twenty-three failed identities match; the changed tree also exposed a stale
  session-store reference in current parity guidance, which was fixed. Its exact
  documentation regression then passed. The baseline alone also failed the
  FORCE_COLOR/NO_COLOR warning assertion, a run-dependent observation; it is
  not called a pass. No claim that the full local suite is green.
- The 26 intentionally excluded CLI integration tests were run separately:
  26 PASS. Combined reports establish CLI parity 907/907, zero failed/skipped
  ledger entries and zero missing. Reports represent two executed commands,
  not a fabricated fresh full-suite run.
- The 11 SDK-moved ledger declarations were separately AST-verified against
  python-sdk 145341d: all class/method targets found, zero missing. This proves
  ownership/declaration, not execution of those Python tests by CLI parity.
- Repository health: 105 PASS / 11 historical WARN / 0 FAIL. Hygiene and
  diff whitespace checks PASS. Generated local-path-bearing parity report was
  moved out of the source tree after parity checks; it is not committed.

## Real components and cleanup

The first standard CLI E2E overlapped clean-build output replacement: 65 PASS /
33 FAIL / 54 SKIP, no sandbox created/leaked. Failed launches saw absent dist
output, so this is retained as a failed orchestration run, not product acceptance.
A fresh run starts only after the completed build, with all emitted JavaScript
hashed and frozen. Its result/cleanup will be recorded separately. Docker is
unavailable; Docker deployment is explicitly skipped, not passed.

## Remaining gates

Latest-head full hosted Node 20/22, links, type/lint, installer and package gates;
frozen-artifact cloud repeat and review. Keep draft while required gates remain.

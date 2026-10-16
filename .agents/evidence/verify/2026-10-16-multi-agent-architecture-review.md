# Verification: multi-agent architecture, behavior and open-source review

- Date: 2026-10-16
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40
- Result: PARTIAL — concrete defects fixed; architecture and release acceptance remain open.
- Audited baseline: 4396046e6c7f; companion SDK baseline 9df2cc19b974. Verification below covers the scoped follow-up source changes in this PR, not merely the old baseline.
- Environment: Linux x64, Node 22.22.2; actual standalone, local fixtures/filesystem, and a read-only Express request. Credentials supplied at runtime; values and cloud response data omitted.

## Review method and conclusion

Three independent agents reviewed provider architecture/operation semantics, maintained code quality, and open-source governance/documentation. The primary agent checked the findings, integrated scoped fixes, built the final artifact and ran product-entry probes. This is a scoped engineering audit, not a certification or proof that all eight repositories are defect-free. Node SDK implementation remains excluded.

Repository ownership and explicit standard/provider Python entry points are reasonable. The CLI still has distinct standard and native frontends. Static metadata, typed management command registration, common-operation adaptation and conditional backend availability remain separate concerns. Registration alone does not solve the missing pieces.

## Confirmed defects fixed in this follow-up

| Finding | Resulting behavior | Evidence |
| --- | --- | --- |
| Root output flags selected the native create implementation | Standard operations retain their frontend; unsupported native root flag combinations fail explicitly before side effects | Product-entry tests and final SEA create/parser probe |
| Standard CLI used legacy config values with layered source metadata | One resolved source snapshot supplies scoped Express URL/key and provenance, including explicit selection over ambient OpenSandbox | Two local HTTP product-entry tests; actual Express list from the final SEA |
| Reserved/invalid namespaces became opaque IDs | Every colon-qualified resource resolves or fails E8002/E8001 before backend work | Regressions first failed on the baseline; final SEA malformed/reserved probes |
| Standard command aliases did not share the native remote-argument scan boundary | Existing exec spellings preserve remote --provider/--opt as command arguments | Selection and routing tests; this does not add native aliases |
| Notice generator stopped at module-only package.json files | 35 real source package identities, including the previously missed 17, retain license files; missing attribution fails generation | Manifest/notice regression, repeat generation and final SEA --licenses |
| Extracted upstream legal comments were absent from SEA license output | Retained Platform.js/statuses copyrights are included in embedded notices | Final SEA checks for the actual copyright strings |
| Architecture/contributor docs described only the old implementation | Bilingual architecture, migration and contributor descriptions distinguish both frontends and their actual scope | Document diff and repository checks |

Python's explicit-Express configuration fix belongs to https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/47.

## Open findings and plan

| Priority | Verified finding or limitation | Required next step |
| --- | --- | --- |
| P1 | PROCESS_RULES lacks openTerminal/pty and the direct terminal construction path lacks the provider feature check | Gate both paths; an undeclared PTY must fail E8004 without plugin/WebSocket calls |
| P1 | resumeConnect catches all HTTPStatusError values; a 403 can fall through to GET and return a paused sandbox as success | Preserve permission/rate/server errors, limit documented route fallback and validate resumed state |
| P1 | Native provider CLI has no pause/resume; connect remains a line REPL; generic templates lack an adapter | Normalize common operations and implement provider adapters with actual-backend evidence |
| P1 | Multiple argv scans and separate frontends still have different option/output/error semantics; native aliases are not uniformly exposed | Resolve one immutable invocation before handler dispatch; use a provider-by-operation product-entry matrix |
| P1 | Feature declarations do not model implementation, CLI exposure or account/runtime prerequisites | Separate these dimensions; unknown availability must remain unknown and never trigger another backend |
| P2 | protocol and transport modules import api/_pyerrors, contrary to the downward-layer rule | Move pure helpers down and add a static dependency check |
| P2 | Corrected standard notices are not a full final-SEA/upstream-prebundle license inventory | Generate and validate complete artifact SBOM/notices, including native bundled dependencies |
| P2 | PR CI lacks full installed npm/SEA contract checks; cross-repository CI inputs use moving refs | Add artifact checks, fixed or explicitly recorded dependency revisions, and all-platform release verification |
| P2 | Python provenance/patch notes lack executable replay and maintained-output verification | Implement source import/patch replay and wire-behavior drift gates in the owning repository |

The proposed [operation plan](../../notes/proposed/architecture/2026-10-16-provider-operation-unification.md) gives the staged design and acceptance criteria. It is not implemented by this review. Pending registration PRs remain separate: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35 and https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38.

## Commands and observed results

- Six-file targeted Vitest run: standard_dispatch, standard_configuration, standard_executable, provider_flag, registry_scoping and sandbox_provider — **104 passed**.
- Full `npm run typecheck` — **PASS** after the final dispatch/selection changes; maintained source and tests checked.
- `npm run build` and `npm run build:binary` — **PASS**. Final standalone SHA256: a7390529cc4be510db8de5a098ab7561bf61e393c6e9e252ba34175620003ac3.
- `node scripts/build-standard-cli.mjs` repeated with before/after SHA256 comparison — **PASS**, runtime, linked legal text, notices, embedded notices and source manifest identical.
- Final SEA product probes — **PASS** for corrected licenses, namespace rejection, root-output flag rejection and an actual Express list using scoped credentials/URL with explicit provider overriding ambient OpenSandbox. Cloud output was parsed in memory and not stored.
- The earlier full hosted Node 20/22 matrix and all other PR checks passed on baseline 4396046. That is **not** proof of the follow-up head; its CI must run after commit/push.

## Cleanup and limits

The cloud check was read-only and created no resources. Local fixtures use temporary HOME directories and cleanup in finally. This review does not claim a live OpenSandbox-server run. Successful conditional Express pause/snapshot still requires an enabled function/account/runtime fixture; previous actual backend rejection evidence remains unchanged. The draft PR is not ready for full acceptance or merge.

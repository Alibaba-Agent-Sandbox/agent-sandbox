# Verification: command recovery review

- Date: 2026-10-23
- Result: PARTIAL — current-head CI and final verification pending
- Source: CLI base 6df41f624249c316654fbd5c6d36c34a7beca0b8; templates base 068119d022d96358a5031a35c0b6690f75e2fa13 plus scoped patch.
- Environment: Linux, Node 22.22.2, Python 3.13.13. Credentials supplied from ignored environment; values and raw cloud output not retained.

## Verified so far

- CLI npm ci, build and typecheck passed; lint passed with 277 warnings and zero errors. Standard provenance: 7 passed. Repository health: 105 PASS, 11 historical WARN, zero FAIL. Hygiene passed.
- Template checker: no nonconformant templates; document checker: 218 documents, zero failed links. Controller regressions: 93 passed, 186 subtests passed; the separate actual-parser integration also passed (4 unittest cases, 157.731s).
- Actual CLI parser validates list/create/kill/delete contracts without cloud mutation. A later parallel local run timed out on help at 30s; shared-filesystem startup also caused 21 executable tests to exceed their 20s test deadline. Serial/temporary-filesystem verification and remote CI are pending; these failures are not counted as passes.
- Real Express smoke: detached create, exec, kill and list readback passed. A subsequent harness-helper run passed preflight and real template inventory schema, then failed the later exec/cleanup sequence. A short 60-second TTL under slow startup is a hypothesis, not an established cause; the 300-second retry passed preflight, actual template-inventory schema, detached ID parsing, real create/exec, the harness cleanup helper, and full standard sandbox-list absence readback. The private owned-ID recovery journal was removed after confirmed absence. No owned sandbox remained in that readback. No new template/image was built in these probes.

## Commands

CLI: npm ci; npm run build; npm run typecheck; npm run lint; npm run test:standard-provenance; bash scripts/check-repo-health.sh; npm run check:hygiene; vitest targeted/full runs. Template: pytest on test_express_cli_contract, test_express_cleanup, test_sdk_creation, test_ci_image and test_spec_tools; check_template.py --all; check_docs.py. Actual parser selected by ABX. Real probes use current built CLI and owned sandbox only.

## Limits

No full Codex Docker/ACR rebuild or new template qualification is claimed. Error reporting is a bilingual design proposal only: no diagnostic setting, worker, FC/SLS resource or HTTPS ingestion deployment exists. Real reporter opt-out/performance/abuse testing remains on Issue #107.

## Review follow-through

Initial CLI CI failed on ten historical oracle-default assertions and one clarification-output snapshot. The old Python fixture is preserved; explicit current project recovery defaults now override only minimal-constructor cases, while formatting and caller-supplied suggestions retain their contract. A fresh dated clarification snapshot was captured. The template actual-parser CI passed. Current-head reruns are required after these corrections.

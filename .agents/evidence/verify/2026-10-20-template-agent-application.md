# Verification: Template Agent application deployment

- Date: 2026-10-20
- Base: `73d5ee3f9af747a406fcdda4b5613d047ba1918c`
- Result: PARTIAL
- Environment: Linux, Node v22.22.2 source build; exact dependencies installed with lockfile.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/80

## What changed

One template entry, optional application configuration, explicit host plan/apply/
status/reconcile/destroy, bounded hooks, atomic FC creation and native ownership
verification. Existing sandbox operations do not run application deployment.

## Commands and results

| Command / scenario | Result | Evidence scope |
| --- | --- | --- |
| `npm ci --ignore-scripts` | PASS | Existing lockfile; later exact new dependencies added with npm install and lock update |
| `npm run typecheck` | PASS | Strict TS, including new modules and tests |
| `npm run build` | PASS | Package compilation and existing standard runtime copy |
| Final `npm run lint` | PASS | Exit 0; 0 errors, 265 warnings. Warnings include scoped test files and are not all claimed to be historical |
| Application regressions (initial 14) | PASS | Offline/stale plans, actual hooks, receipts, native replacement, uncertainty, bounded subprocesses |
| FC inspector tests (20) | PASS | Official credential/SDK loading and serialization, STS snapshot, typed absence and create-only failures; no cloud transport |
| Shared v3 contract tests (12) | PASS | Version/schema/semantic/filesystem validation; no hooks |
| Focused application/contract/provider preparation run (38 tests) | PASS | Includes create-only preparation handoff; 120-second diagnostic timeout accommodates cold module loading |
| CLI fixed surface (11 tests) | PASS | Diagnostic run with 120-second timeout; default run timed out on cold canonical command imports |
| Final targeted regressions (4 files, 64 tests) | PASS | Application/inspection/contract/CLI focused validation after review corrections; does not replace the full suite |
| Startup refinement: v3 contract, legacy parser and capability tests (3 files, 59 tests) | PASS | `npx vitest run tests/test_template/test_contract_v3.test.ts tests/test_utils/adv_pyos_parity.test.ts tests/test_api/test_capability.test.ts --maxWorkers=2`; normal 20-second per-test deadline, no override; exit 0 |
| Startup refinement: `npm run typecheck` | PASS | Exit 0 after the final static-import/cached-validator change |
| Startup refinement: `npx eslint src/utils/template_contract.ts` | PASS | Exit 0, no warnings; only the version-gate helper changed, with no build/dist mutation in this follow-up |
| Final `npm run check:hygiene` | PASS | Exit 0; no machine-local paths or credential-like strings |
| Final `bash scripts/check-repo-health.sh` | PASS | Exit 0; 105 pass, 11 warnings, 0 fail; includes this record and final source changes |
| Full `npm test -- --maxWorkers=4` | FAIL | 18 test files failed, 152 passed; 83 tests failed, 4003 passed, 8 skipped. Registry error compatibility and test-isolation defects were corrected and passed later focused runs; remaining full-run failures are unclassified, not asserted to be pre-existing or unrelated |
| Real CLI cloud-lifecycle suite | FAIL | Rejected unsupported `--json` before resource creation; 0 resources created, 0 leaked. This is not a cloud-lifecycle pass |
| Final npm pack dry run | PASS | Built CLI entry, app command, FC adapter, hook schema and template v3 schema present; no package published |
| Built CLI blackbox | PASS | Single-template in-sandbox example plans offline; apply without --yes fails before receipt/resource creation; temporary files removed |
| New guide/record relative links | PASS | Local targets resolve |
| Full new FC application apply/update/destroy | BLOCKED | No Docker executable, no managed application PostgreSQL binding or reviewed runtime image/tool bundles |

## Contract provenance

Template owner schema SHA256:
`afaa4a30fd24a5c5e4f4e28465d421e7076e612ab75e20c1a33c1d582c385a50`.
Canonical source: https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/141.
No user schema fields are silently ignored by the new application path.

## Review corrections

Independent adversarial review drove file-protocol validation, one operation ID,
afterReady native references, complete tool bundle hashes, execution-environment
sanitization, atomic function creation instead of s upsert, native incarnation
checks, partial cleanup filtering and explicit provider ownership. Reported nested
registry secrets and authenticated DSNs now fail before plan persistence. Final
review additionally closed ambient Serverless Devs environment/plugin overrides,
source-edit blocking of frozen deployment cleanup, sensitive/unknown toolchain
fields and generated-state symlink redirection. Reconciliation verifies frozen
hook inputs before executing afterReady hooks.

The shared version gate now constructs and compiles its cached Ajv validator only
on the first v3 validation. Legacy/v2 reads skip construction and compilation.
The Ajv class and JSON schema retain static imports for standalone bundling; this
does not eliminate Ajv module-import cost or establish a startup-time benchmark.

## Cleanup and limitations

Mock unit resources use isolated temporary directories and are removed after each
test. Hooks clean their process group and scratch directory. Serverless Devs uses
fresh temporary workspace/home directories, removed after invocation. No manual FC
application deployment was performed. The attempted CLI cloud-lifecycle suite
failed before creating resources, so it created and leaked zero resources.
The Python owner separately verifies its new runtime against a real cloud sandbox;
that is not FC deployment acceptance for this CLI.

Full new FC application deployment remains blocked by the unavailable Docker
executable and managed application PostgreSQL binding, with no reviewed deployed
runtime image/tool bundle acceptance. The full default test run remains failing
despite later focused passes. These are outstanding completion gates; this record
does not mark the implementation production-ready or the full suite green.

No broad rollback, borrowed infrastructure deletion, production alias cutover,
object-store implementation, arbitrary coding CLI remote binding or exactly-once
external tool guarantee is claimed. Local operation locks are not a distributed lock.

## Main integration

Merged current main `4aec47b` after the original verification. Both Unreleased
entries and both engineering-record links were retained when resolving append-only
conflicts. Provider conditional-operation changes from main are preserved.

Post-merge `npm run typecheck` passed. Application, FC inspector, v3 contract and
new main Provider conditional-command tests passed together: 4 files, 72 tests
(`--maxWorkers=2 --testTimeout=120000`). This does not clear the full-suite gate.

Final static-import/cached-validator build passed after main integration. Required
built entry points and schema assets had already passed package inspection.

Full-suite provenance limitation: the long local full-suite/parity attempts
overlapped build-output regeneration. Their failures are recorded, but they are
not a clean baseline comparison or acceptance run. A stable build followed by
complete CI remains required. The parity attempt has no accepted final result
at this snapshot; it is not counted as a pass.

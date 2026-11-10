# Verification: unified deployment and template command boundaries
Result: BLOCKED

## Scope and baseline

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/244.
Baseline: 2f84e3f802e5f6abd98a528c457b844a9307041d.
Isolated branch; original workspace checkouts were not edited or staged.
No npm/PyPI/binary release is claimed. Public instructions identify source-only new commands.

## Verified behavior

- Root deployment previews validate without building or creating resources; source
  snapshots preserve source identity and exclude local private inputs.
- Names resolve the saved Provider target, known Sandbox identity and existing
  application receipt. Same-template applications receive different cloud names.
- Unknown create results retain intent and are not replayed. Real local process
  interruption and stale-lock recovery preserve active/unknown-host locks.
- Borrowed builds survive deployment deletion and reject cleaning while referenced.
  A real launcher pre-request identity mismatch can now release the consumer through
  delete; missing-field/unknown historical records remain conservative.
- A real different-UID file read verifies the source-mode correction; the private
  snapshot outer directory remains inaccessible to other users.
- One real Express Sandbox was created through the built deploy command under a
  unique local name, inspected with status, executed a shell command with independently
  asserted output, then deleted. The deletion path independently queried NotFound.
  All five CLI operations (including initial read-only list) returned zero; the output
  assertion passed. That owned Sandbox is confirmed absent. No database, managed FC
  deployment, image or cloud management key was created in this run.

## Local checks and baseline failures

Initial complete post-integration run: 4,569 tests, 4,483 passed, 81 failed, 5 skipped.
Failures included obsolete command fixtures and environment-intercepted transport.
The old command fixtures are being migrated and must be checked in the final result;
this initial count is not a completion claim.

The exact unchanged baseline reproduced 20 failures in engine, provider transport,
malformed TCP/TLS and WebSocket tests across two selections. Responses include the
host network-audit HTTP501/502 behavior; assertions were not loosened. A separate
shared config fixture differs on the pre-existing Python-only security_token field;
this change does not invent matching CLI support or modify the shared contract.

Focused root checks passed 166 tests with one skip (managed lifecycle and existing
Sandbox service behavior), plus 12 new deployment/recovery regressions. Other exact
checks are recorded in single-cli-protocol and template-authoring-boundaries evidence.
Final integrated checks and CI are recorded below when run.

## Blocked and not verified

This host has no Docker executable and no configured existing PostgreSQL binding for
a new managed application. Full generated MCP cloud deployment and managed FC
apply/update/logs/destroy have not been rerun. No RDS was created to fill this matrix.
Local generated HTTP MCP and OS permission checks are not Docker/cloud acceptance.
Required end-to-end and CI gates must remain explicit; the CLI PR stays draft while
those requirements are unmet, per the repository Definition of Done.

Independent review also retained explicit CLI timer validation: 0 is unbounded, positive deadlines are capped at 2,147,483 seconds before connecting to prevent Node timer overflow. Retired Express line-editor oracle tests were replaced by the existing real PTY suite and retained generic Provider REPL suite; no old command alias was restored.

## Active E2E consumer migration

The active capability/all-commands/read-only/lifecycle/Docker scenarios and their
runner use the unified command surface. The list consumer requires complete
`items/partial/errors` results; deletion acknowledgements are followed by exact
resource and inventory checks. Uncertain creates and retained build artifacts
keep the private recovery workspace. No submission is replayed during recovery.

- Actual compiled CLI capability/all-commands run: 8 passes, one expected cloud
  cleanup skip; all 113 discovered command nodes were checked for help and safe
  local invocation.
- `cloud_contract_safety.test.ts`: 63 passing local regressions, including
  incomplete inventory, failed creation with a reported ID, and retained Docker
  build resources.
- `npx tsc --noEmit`: pass after object-wrapped parameterized cleanup fixtures.
- Scoped ESLint: zero errors; three existing unused runner parameters/imports
  remain warnings.
- Docker preparation/deployment was not run: this host lacks Docker. The actual
  pipeline remains present, gated by explicit Docker opt-in and existing cloud
  credentials; parser/unit checks do not constitute cloud acceptance.

Cloud lifecycle execution is coordinated separately below; the local migration
checks above did not create cloud resources or provision management keys.

Independent review caught a redundant SOURCE argument in the Docker harness's
`deploy --build` invocation. Removed it and passed the actual scenario argv
through CliRunner and real build admission: an intentionally mismatched Provider
digest is rejected with effectsStarted=false, before any cloud call. The combined
deployment command and E2E safety selection passed 72 tests; TypeScript compilation
passed again. The real Docker cloud pipeline remains unrun.

## Integrated source and real cloud verification

The integrated Vitest run included both normally excluded CLI and template-init
integration files: 4,601 tests, 4,569 passes, 27 failures, 5 skips. Twenty failures
match the unchanged baseline transport failures described above; one is the
pre-existing cross-repository configuration fixture difference. Six failures
identified current documentation/fixture/admission issues and are tracked in
the follow-up selections below. This full-run result is not represented as green.

Repository health passed (106 checks, zero failures); content hygiene passed.
The explicit Skill installation links and current Provider build-inspection
guidance passed a focused 42-test selection.

Real Express cloud suites used the frozen built CLI, an existing base template,
and existing credentials supplied only to child processes. Read-only and
lifecycle suites produced 69 passes and three failures: a named deployment
list entry omitted the template field, and silent/noisy execution did not
produce the required deadline error. Both created Sandboxes were deleted and
independently confirmed absent; zero leaked IDs or unresolved create attempts.
No template, image, database or management API key was created. The historical
run remains recorded as a failure even after the targeted fixes below.

The later full Vitest JSON report was not a frozen-source run: it started at
11:02:54 UTC, loaded the E2E safety suite at 11:03:55, and ran the newly added
Docker parser fixture at 11:04:26, across the SOURCE-argument correction. Its
Docker assertion failed without the actual error body in the JSON report. A stale
module transform is a plausible explanation, not a proven product race. The
frozen 72-test selection passed again; the diagnostic now includes actual output
if this recurs. Fixed-head CI remains the integrated authority.

Real cloud observation identified a separate useful-field omission: list merged
remote status into named records but omitted the same remote template identity
that raw Sandbox rows expose. Independent review agreed to preserve that field,
without additional cloud queries or weakening the lifecycle assertion. The five
list-partial tests now pass, including named/raw identity agreement and absence
of runtime authorization from output. The new test first hit the intended missing
authentication gate; its final fixture supplies a dummy key with stubbed transport.

The broader CLI/E2E selection finished with 1,529 passes, 4 failures and 4 skips
(72 files). Docker admission passed in that run. Failures were the list fixture
loaded before its dummy-key correction, one old volume-mount result fixture and
two package-entry fixtures; these are separately corrected and rechecked by their
owners. This broader diagnostic run is not claimed as a clean integrated pass.
TypeScript checking passed after the final named-list field/test changes.

Final frozen correction selection (list-partial, package-entry, volume-mount
safety, and deploy-command tests): 4 files passed; 28 tests passed and 3 existing
volume fixture variants skipped. The corrected Docker parser and named remote
template projection assertions passed without cloud calls.

Parity ledger validation passed all 907 historical entries with 148 explicit
contract replacements; 11 moved Python entries were found in their owning SDK.
This check used the integrated report with the two 42-test follow-up suite
results substituted by file; it is a composite coverage check, not a new fully
green suite execution. The temporary machine-path-bearing report was removed
before hygiene/commit. Removed account-wide kill progress coverage maps to the
explicit rejection of its retired entry point; no bulk-deletion alias returned.

## Frozen corrective verification

The final built CLI passed eight actual cloud checks: creation, complete named
inventory with template identity, status JSON, silent and continuously emitting
execution deadlines, deletion, idempotent deletion and independent leak check.
Both timed-out process IDs were independently queried in the process inventory
and confirmed absent. The one additional owned Sandbox was confirmed deleted;
zero unresolved creates or unconfirmed IDs remained. This targeted run resolves
the three earlier cloud failures, but does not substitute for the blocked
Docker/MCP/managed FC cases.

The final deadline/package/mount selection passed 34 cases with three explicit
mount opt-in skips. An additional frozen correction selection passed 28 with
three skips. Final build and actual npm dry-run package/reference-closure checks
passed. Final ESLint had zero errors and 259 warnings. TypeScript passed after
the deadline and named-list changes.

No package was published. All four owned Sandboxes created during this task
(one initial smoke check, two broad lifecycle cases, one corrective run) were
independently confirmed absent after cleanup. No cloud database, template,
image or management API key was created for these checks.

The branch merged main d0a8302f3a921a4572b9ee237bd093bb43e74d5d after the
implementation commit. Main added preview/community documentation and the QR
asset, not runtime changes. The engineering index conflict retained both sets
of links; bilingual announcements, QR asset and historical records were kept.
Post-merge repository health (106 checks, zero failures) and hygiene passed.

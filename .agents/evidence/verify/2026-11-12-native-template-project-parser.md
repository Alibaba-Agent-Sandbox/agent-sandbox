# Verification: native template project parser

- Date: 2026-11-12
- Result: PARTIAL
- Base source: 16e0a2bfe50ac89b1d6c8ee21e3bcc995cd12614 plus the scoped parser changes.
- Environment: Node22.22.2, Linux, official pinned parser package. No cloud or model calls.

## What was verified

The official Devs parser resolves the native project and private payload in an
isolated child. The scoped tests use the actual installed package, real temporary
project files and private process pipes; they do not mock expression resolution.

## Commands run

- `npm install --save-exact @serverless-devs/parse-spec@0.0.29 @serverless-devs/engine@0.1.6-beta.2 --ignore-scripts --no-audit --no-fund`: exit0.
- `npx vitest run tests/test_template/test_devs_project.test.ts`: first run5/6;
  corrected the test to native `json(file(...))` because `file` returns text;
  final initial run6/6, exit0; the follow-up original-configuration-source
  regression brings the current targeted run to7/7, exit0.
- `npx eslint src/template/devs_project.ts src/template/devs_runner.ts tests/test_template/test_devs_project.test.ts`: exit0.
- `npm run typecheck`: exit0.

- `make lint`: exit0, 259 existing warnings and zero errors.
- `make typecheck`: exit0.
- `bash scripts/check-repo-health.sh`: exit0, 106PASS/11WARN/0FAIL.
- An exploratory `make test` completed4532PASS/5FAIL/57SKIP across216files.
  The five failures involve FORCE_COLOR/NO_COLOR, three retired deployment helper
  argument fixtures, and the sibling Python config-key copy. This run overlapped
  addition of the follow-up test and is not acceptance for the final tree; a frozen
  final-tree full run remains required. No retired command has been restored.

## Results

PASS: native environment/vars and application payload; FC memorySize4096 retained;
output reference order; relative file input from actual project cwd; child-only
dotenv; missing environment name and field path without other resolved values;
declared action listed without running its command.

## Cleanup

Tests remove only their temporary source and runner directories. No external
resources were created.

## Not verified

Canonical v1 parser/consumer migration, final plan/receipt secret handling,
general Serving lifecycle, complete repository gates and real cloud/model E2E
remain continuing work. Parser fixtures do not satisfy those gates.

## Closed local consumer phase

Public resource admission now uses canonical template v1 intent/resolved schemas from
awesome-templates 5cf448296361b3bcd8341bd8ae8131f2ca703496. SDK launch JSON/vectors
are pinned to ab50ad8e750b15221c25ccf231caffdc3f196983. The CLI-owned pure JavaScript
planner accepts public v1; its complete runtime dependency set is launch_plan.mjs
and launch-v1.json. Execution metadata is private and has no public spec discriminator.

Actual consumers include static acquisition/capability discovery, source launch/build,
Managed ephemeral native FC properties/bindings/instance input, current scaffolds and
AI Dockerfile authoring, and catalog v3 metadata. Raw ports resolve URLs without
inventing service protocols or health requirements. Unknown plugins require their
selected real synchronous validator; absent, failed and async validators stop before
resource effects. Public Registry fetch does not receive GitHub credentials.

Managed plans omit all FC and guest environment values and metadata values; only
names, original references outside those maps, and necessary resource controls remain.
The original configuration directory is recorded as a path, never environment values.
Native actions/flow and unowned Managed automatic/auxiliary resources fail before effects.
Observation/cleanup resolve only existing control credentials and cloud ownership,
without model, database-login or source-build dependencies. Their existing control
hash and dispatcher state-instance pin remain enforced; no cleanup key is generated.

- Latest phase build, typecheck, lint, hygiene: exit0.
- Latest health check: exit0, 106PASS/11WARN/0FAIL.
- Eleven focused files: 194PASS, exit0 (includes shared launch vectors, actual parser,
  private native values, real Zod plugin admission, mixed-resource rejection, raw ports,
  canonical discovery and current scaffolds).
- Two focused Managed state-machine regressions: 2PASS, exit0; native Worker memory4096
  plus Worker-only guest environment; independent saved receipt after source removal
  permits observation and owned destruction using the existing private control store.
- Earlier Managed full file: 110PASS/1SKIP, exit0. Subsequent control/planner/ports changes
  mean that result is historical and does not replace a final-tree full run.
- Source/config/record changes remained local. No cloud/model resource was created.

## Full-suite inventory and continuing gates

The build-then-test inventory at 17:20 UTC completed 4568PASS/43FAIL/5SKIP in218 files
with one unhandled rejection. Later explicit planner/control/port corrections changed
that tree, so this is a failure inventory, not final acceptance. The prior npm-only
inventory lacked built dist inputs and must not be used to judge installed CLI behavior.

Failure groups in the build-then-test inventory:

| Files/group | Failing tests | Required follow-up |
| --- | ---: | --- |
| integration adopt/progress, agent adopt, CLI adopt | 15 | Migrate fake-model source and preserve activity/whitelist assertions |
| application setup, real PTY onboarding, Express source workflow | 9 | Migrate source fixtures; retain fresh-user and real preparation assertions |
| capability, old-source recovery, binary-scalar document | 5 | Use v1 public admission and current safe errors |
| generation defaults and guided platform steps | 8 | Separate retained native Provider capability from unsupported v1 source generation |
| template guide | 1 | Assert current nested field guidance |
| adversarial unknown tag/NUL | 2 | Strict reader rejection restored; update safe error expectations |
| template gate gaps | 2 | Canonical source/metadata semantics |
| config-keys owner copy | 1 | Verify actual owner source/generation mapping; do not hand-edit copied contract |

The unhandled BuildModeError originated in the guided-configuration native-steps test
and requires fixture/cancellation cleanup investigation, not a passing-text adjustment.
Active historical v5/steps tests must be migrated before calling CI complete.

Remaining delivery gates: final frozen full suite; SDK/CLI quiet-process cancellation
verification; binary/SEA distribution of the isolated official parser; fresh-user
interactive persistence of arbitrary application inputs; general owned Serving lifecycle;
real cloud/model apply/update/drain/destroy; dependent Registry/website/blog source pins;
review/CI/publishing. No source merge or package release is claimed by this record.

## Second local phase: full-suite reconciliation and FC credentials

The first frozen reconciliation completed 4615PASS/1FAIL/5SKIP in218 files,
without unhandled errors. The remaining failure was the shared configuration-key
export: the SDK already declares optional `security_token`, but the CLI copy did
not. Independent SDK and parent review confirmed the FC `abx` profile read its key
pair from layered configuration while taking the token directly from the ambient
environment, so the metadata difference exposed a real inconsistent snapshot.

The official SDK exporter was run from committed source
1079841307f1f63253ae68fdda6e6d2d1e77e851. Its output matched that revision's
committed JSON fixture byte for byte, then the existing CLI generator regenerated
the copy and TypeScript metadata. Source SHA256:
`e8c9c2de0dfed2864ea4384cabe4c2bff69826f56bef994a145fd54fdea1bda1`;
export SHA256:
`570cbd01fede88858e99e64fb9b83f7dba968094f5f69ccbed8183b27ed3261a`.
FC credentials now read the optional token in that same snapshot. A real loopback
HTTP server, official STS/FC serializers and signer verify the actual token header
for `abx`, `env` and named/default Devs profiles without sending cloud requests.
This does not enable STS for Express template preparation or cleanup.

After removing the unused direct engine dependency, `env -u NODE_PATH npm ci
--no-audit --no-fund` exited0. The installation policy reported blocked optional
postinstall scripts; they were not bypassed. The actual subsequent build, signer
requests and full checks passed. The existing isolated runner also prepares and
invokes a trusted local fixture through the actual installed official component
loader, verifies constructor logging and the real `getCredential` callback, and
does not import the removed engine. No arbitrary cloud lifecycle is inferred.

`env -u NODE_PATH make ci` then exited0: hygiene, typecheck, lint, build and
dist/npm package checks passed. The main suite had219 passing files and
4621PASS/5SKIP. The parity command's separate full JSON test run had
4643PASS/0FAIL/5SKIP; its ledger covered907/907 APIs, zero missing and11 verified
Python-owned moves. These are two separate executions, not combined test counts.
The earlier unhandled rejection was eliminated by retaining the genuine lower-level
native recipe fixture and observing its preparation completion; no error handler
or assertion was weakened. Retired public YAML and commands were not restored.

That complete run precedes the following shared-reader/native-wire narrow delta,
which receives its own final checks below. Node20/remote CI, binary/SEA parser
distribution, cross-repository release pins, arbitrary application-input persistence,
general owned Serving lifecycle and cloud/model E2E remain separate delivery gates.

## Shared source reader and Managed resource admission

The CLI now consumes immutable canonical owner revision
ef695803cb78bf82b8473195fcb37b3e6357a363, including its shared raw YAML vectors.
`readProjectDocument` delegates source bytes to the same Core1.2 reader as the
other consumers; acquisition no longer performs a legacy YAML preparse. The
reader rejects non-string/complex keys before JavaScript object conversion,
aliases, duplicates, unsupported tags/directives, invalid UTF-8, non-finite or
unsafe JSON values and inputs above1MiB. No custom scalar resolver is maintained
by the CLI. All13 valid and25 invalid raw vectors pass through the real CLI
filesystem entry, including byte and generated-size cases.

A separate actual parser probe found the official native parser's timestamp
resolution lost a date-shaped string as an empty object. Its wire input is now
JSON text (valid YAML), preserving string types, multiline values and native
env/vars/file/output semantics. Both the low-level actual parser and full source
reader/admission/compile path cover this regression. Source errors give a v1
repair suggestion; codegen retains the staging/retry hint without nesting the
old capability-grant suggestion or another formatted error.

The first complete reader-tree CI had4657PASS/5FAIL/5SKIP across221files and
exited2. All five failures were legacy error expectations in two adversarial
files: two expected nested error formatting, three expected the prior YAML
type/line-column preparse. Rejection, non-promotion and source redaction remain
asserted under the shared safe reader policy. Its product diff SHA256 before
and after that run matched:
`a44734c8362f0c5d3cbe485a48b661c5126b0c8d46da11b4eec8e5fb23bf63b1`.

Parent and SDK/runtime review also identified a genuine Managed omission: four
declared native resources were admitted but only the three roles were consumed.
A real built `readManagedProject` probe confirmed the extra production-domain
resource was ignored. Managed admission now rejects every resource not referenced
by the role-ID set before lifecycle effects, without restricting generic owner
schema intent. Actual native-parser tests accept three custom role IDs and reject
extra domain and VPC resources. User guides accurately require existing custom
domain/network resources, rather than promising their creation.

The final focused run passes159 tests across10files, including shared YAML raw
vectors, original-source resolution, secret-free snapshot consumption, the real
component loader, official signer requests, extra-resource admission, all five
error-policy corrections and codegen/adopt non-promotion. The following full CI
is recorded separately once complete.

### Final frozen local result

`env -u NODE_PATH make ci` exited0 after the complete reader/resource-admission
delta. Main suite:221 passing files,4665PASS/0FAIL/5SKIP. Independent parity
JSON suite:4687PASS/0FAIL/5SKIP. Ledger:907/907 passed, zero missing,11 verified
Python-owned moves and148 changed-contract replacements. Hygiene, typecheck,
lint, build and npm dry-run package/reference closure checks passed. There were
no unhandled errors. The5 skips remain skips, not cloud acceptance.

The content fingerprint for1163 tracked and newly added source/test/script/E2E
and package files was unchanged during the run:
`b5881c21ac0eebcda0de9011d0bb3527002a3285f75ffb3672e0cdd490fb7fb5`.
Record-only updates after that run do not change this tested product fingerprint.

The extra health check initially found one ADR metadata failure: its `Status`
contained an explanatory phrase instead of matching its `proposed` directory.
The field is now `proposed`, with the continuing acceptance limits retained in
the next paragraph. The repeated check exited0,106PASS/11WARN/0FAIL.
`git diff --check` and the immutable template-source hash check also exited0.

This closes the local Node22/npm/source CLI consumer phase. It does not close
Node20/remote CI, binary/SEA parser distribution, arbitrary application-input
interactive persistence, general owned Serving lifecycle, the parent's real
cloud/model apply/update/drain/destroy run, cross-repository publication or review.
No cloud resources, model calls, package publication or merge occurred here.

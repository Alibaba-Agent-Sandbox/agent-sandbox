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

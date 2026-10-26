# Verification: Express Template Cache commands

- Date: 2026-10-26
- Change: `2026-10-26-express-template-cache-commands` (proposed)
- Issue: [186](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/186)
- Result: PASS for scoped unit/CLI and real cache CRUD; full repository/remote gates remain separate
- Binary: CLI0.5.6 candidate from `2e32256` plus the task's new Provider module/registration, built with the exact updated npm lockfile
- Environment: real Express cn-hangzhou; Node22.22.2; official SDK `@alicloud/sandbox20260820@1.2.0`; credentials supplied only through environment variables

## What was verified

Four actual Provider operations now share offline help, strict schemas, generic effect/confirmation gates and the existing engine dispatcher. They use the verified official2026-08-20 Sandbox endpoint, not invented paths or the older API. A newly built task-owned generation-2 template was used for the actual CLI cache acceptance; no user's existing cache was mutated.

## Commands run

```bash
npm install --save-exact @alicloud/sandbox20260820@1.2.0 --ignore-scripts --no-audit --no-fund
npx vitest run tests/test_providers/test_template_cache_commands.test.ts tests/test_providers/test_conditional_commands.test.ts tests/test_providers/test_alicloud_commands.test.ts tests/test_providers/test_management_commands.test.ts
npm run typecheck
npm run build
npx eslint src/providers/alicloud_express/template_cache_commands.ts tests/test_providers/test_template_cache_commands.test.ts e2e/skill-template-cache-acceptance.mjs e2e/skill-template-acceptance.mjs
node scripts/capture-cli-evidence.mjs --command help-provider --out .agents/evidence/cli/2026-10-26-express-template-cache-commands
ABX_SKILL_CACHE_TEAM_ID=REPLACE_ME_TEAM_ID ABX_SKILL_CACHE_TEMPLATE_ID=REPLACE_ME_TEMPLATE_ID node e2e/skill-template-cache-acceptance.mjs --output NEW_JSON_RECEIPT
bash scripts/check-repo-health.sh
```

The Team/template placeholders omit actual account resource identifiers. The source template was newly built for this task, not selected from unrelated user resources.

## Results

| Scenario | Result | Observation |
|---|---|---|
| Pure offline discovery | PASS | Four strict command descriptors; lazy SDK is not loaded |
| Focused Provider suites | PASS |149 tests across four files, including37 new Template Cache cases |
| Validation, auth and endpoint | PASS | Explicit Team; strict fields; AK/SK only; endpoint fixed to selected region; unsafe region rejected before I/O |
| Exact generated requests | PASS | Official create/describe/list/delete models and method arguments; single attempt; SDK retries disabled |
| Actual state/projection | PASS | Creating remains creating; absent state stays absent; scope mismatch and malformed metadata fail; secrets/unknown fields are excluded |
| Cursor semantics | PASS | One explicit page per call; opaque token preserved; empty/absent terminal token becomes null |
| Errors and effect gates | PASS | Typed auth/not-found/conflict/quota/timeout errors; raw response text withheld; no mutation replay; create/delete require generic CLI confirmation |
| Actual CLI CRUD | PASS | Nine checks, exit0; initial getE8005, create/get/list/delete, repeated delete returns false |
| Actual state progression | PASS | `creating`, progress0,584MiB → `ready`, progress100,584MiB |
| Independent cache cleanup | PASS | Official DescribeTemplateCache404 and exact inventory absence |
| Backing owned template cleanup | PASS | Official GetTemplate404 and exact owned-name/ID inventory absence |
| Current golden snapshots | PASS |119 cases; only help-abx/help-provider select the new dated golden folder; older merged captures retained |

The [sanitized actual CRUD receipt](2026-10-26-express-template-cache-commands-events.json) preserves state observations and independent cleanup. [Regenerated provider help evidence](../cli/2026-10-26-express-template-cache-commands/README.md) contains seven executed help cases, with no live cloud calls. The final focused test count and repository-wide checks are also reported by the parent task's current verification; they are not inferred from this scoped live run.

## Cleanup

The acceptance scenario refused a pre-existing cache and created only the explicitly supplied task-owned reference. It deleted that cache, independently observed404 and confirmed inventory absence, then verified idempotent repeated deletion. The test owner subsequently deleted the newly built backing template and independently confirmed GetTemplate404 and inventory absence. All earlier task-owned exploratory templates were also independently read absent. No shared cache or unrelated template was modified.

## Problems found

The earlier generic Provider catalog count assertion expected26 commands. It now expects30 because these four commands are intentionally registered. Initial local test-only missing-import/mock-typing issues and a no-unsafe-finally lint issue in the acceptance harness were corrected before the final scoped checks. They were not counted as cloud passes.

## Not verified

WarmPool configuration, billing/cost savings, other providers, every regional/account admission policy or a startup latency SLA. The parent task separately measured three before and three after samples on an earlier owned template; cache metadata absence does not prove a globally cold image and six observations do not establish an SLA. Full repository CI, required review, publication and merge remain separately gated.

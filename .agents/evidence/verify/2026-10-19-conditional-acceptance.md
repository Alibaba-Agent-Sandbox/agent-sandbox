# Verification: conditional Express acceptance

- Date:2026-10-19
- Result:PASS — real local acceptance; exact-head hosted CI follows push
- Backend: actual Alibaba Express, isolated generation2 fixture
- Credentials: local ignored config only; never uploaded or printed

## Design and provisioning

Read official generation2/snapshot contracts before changes. Read-only POP inventory
found two existing ready generation2 templates. Actual built CLI submitted a new
unique same-region official runtime-v2/base:v0.0.53 template with generation2,
CPU2, memory2048MB, disk15360MB and explicit Team; build reached ready.
Existing templates/account policy were not changed. Thus the earlier absence of
conditional verification was incomplete investigation, not missing local API keys.

## Prior failures retained

Initial new pause test incorrectly passed strings instead of SandboxState enum;
fixed the test input. The next run exposed409 deletion during lifecycle transition,
brief snapshot-index lag, and repeated snapshot DELETE returning204/True. A scoped
real diagnostic confirmed list visibility after3 seconds. Tests now wait only for
known transition conflicts/index consistency, verify actual resource absence and
preserve arbitrary backend errors. No client/backend success was fabricated.

## CLI artifact results

Locked npm ci/build and real Linux SEA build PASS; SHA256
b721cb5399ac93f3e59188fc07a30d18b13ecabf9b93c4dcfbd9a9183a593aa7.
ABX_BIN=<actual standalone> node e2e/conditional.mjs:
actual pause/resume memory/files PASS; snapshot/create/list/restore/clone
isolation/delete PASS; owned residuals sandboxes0/snapshots0. Native from-image
provisioning and standard conditional commands were exercised separately.
Typecheck/build/lint/health/hygiene are checked with this proposed change; no
Actions cloud/model workflow was added.

## Consumer and cleanup dependencies

Consumers now use native api.sandbox imports that were actually checked against
accepted SDK main81cca585 and standard candidate0d9da632. Review owner PRs:
https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/13
https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/115
https://github.com/Alibaba-Agent-Sandbox/blogs/pull/4
https://github.com/Alibaba-Agent-Sandbox/website/pull/11
Registry aggregates those sources; UI/catalog contracts did not change.

Only this run's sandbox/snapshot/template resources are eligible for deletion.
The owned fixture is removed after both artifacts finish, then independently
queried for absence. Hosted results and actual merge state are separate from
this local receipt. Earlier failures remain point-in-time history.

## Final independent cleanup

Actual standard CLI template delete --yes removed the unique owned fixture.
Independent API GET returned404; paginated queries across all3 test run tags found
zero owned sandboxes, and the snapshot list was empty. No existing template was
modified or removed. An initial cleanup invocation incorrectly included native
--json on the standard parser and was rejected before mutation; correct standard
syntax then succeeded.

## Maintained checks

Strict typecheck/build/lint (zero errors/252 existing warnings), hygiene and health
105 PASS/11 immutable-history WARN/zero FAIL. Full local unit run3915 PASS/
10 known managed raw-TCP/TLS/WebSocket proxy FAIL/56 SKIP; the raw protocol cases
received502/proxy-framing behavior. Assertions were not weakened. Latest full
hosted Node20/22 matrix remains required and will resolve the environment limit.
The library/runtime source is unchanged by these E2E/docs additions.

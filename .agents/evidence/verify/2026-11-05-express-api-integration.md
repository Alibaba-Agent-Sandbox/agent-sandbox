# Verification: Express API completion integration

- Date: 2026-11-05
- Base: b77b75d91617483bc088f28b8eaecf74cbea711a
- Result: PARTIAL
- Issues: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/229 and https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/230
- Companion contracts: https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/152 and https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk/issues/23

## What was verified

Three independent agents challenged the API audit before implementation, exchanged counterexamples, and separated accepted fixes from external cloud provisioning and package scope. The [design review](../research/2026-11-05-express-api-design-review.md) records the decisions. Implementation was split by management, runtime and SDK ownership, then reviewed across those boundaries.

The Python-owned configuration export now includes one canonical STS token name. Both CLI fixture copies and the generated TypeScript registry are synchronized; transport configuration and native credential consumers receive the same credential triple.

## Commands run and results

- First `make ci`: 4645 passed, 20 failed, 53 skipped. Seven intentional help changes, two stale configuration fixture copies and one new vendor import in core were corrected. The isolation assertion was preserved; core now delegates opaque create options to the existing provider hook.
- Final `make ci`: typecheck, ESLint, hygiene and package build passed; tests had 4655 passes, 10 failures and 53 skips across 209 files. The remaining failures concern raw transport, TLS/proxy and malformed WebSocket behavior. On the untouched fixed base, the same three files reproduced exactly those 10 failures. Responses included external HTTP502 or an altered close/handshake response. Product expectations were not weakened to match this environment.
- Help and configuration follow-up: 3 files / 217 tests passed. Seven updated help captures were written to a new dated golden directory; historical captures were preserved.
- `bash scripts/check-repo-health.sh --quiet`: 106 passes, 11 existing warnings, zero failures.
- Standard CLI provenance tests: 7 passed. Reproducible vendor installation and `npm run vendor:e2b` passed without changes to the generated runtime, attribution or source manifest.
- `npm run build:binary`: passed, including the actual executable version smoke check. SHA-256: `12279a0bbeee72ceb35185e9a097eb5e314cef6e1a9ab0e22a9adcf1284fdfc2`.
- Package entry/Skill reference closure checks passed. The first parity run exposed one integration fixture still mocking the shared protocol constructor; correcting it to the provider-owned constructor preserved both sandbox-ID assertions. The integration suite passed all 10 cases, then the 907-entry parity ledger passed all entries with zero missing or skipped. This ledger success is distinct from the 10 full-suite baseline failures above. Local checks do not substitute for the remote Node20/22 matrix.

## Real service observations

Using existing credentials in child processes, the candidate Python SDK and Express provider created private sandboxes, executed commands and file operations, paused and resumed the same previously used object, then executed and read files again. Network replacement and explicit clearing were independently read back. Timeout mutation returned HTTP204. Repeated runs included intermittent E8020 responses; the initial failures remain part of the acceptance history and are not reclassified as passes.

A standalone application diagnosis started a registered function on an exclusive port and consumed the lazy background stream. Sandbox-local GET/POST, public authenticated GET/POST and Python SDK command discovery/invocation passed; anonymous public access returned HTTP403. Earlier HTTP502 results came from the test controller dropping the unconsumed lazy startup stream. A health response alone did not establish that the intended service was running. No product assertion was changed for that failure.

Management and native deployment results are in the [owner evidence](2026-11-05-express-management-completion.md). Local runtime boundary checks are in the [runtime evidence](2026-11-05-express-runtime-completion.md).

## Cleanup

All sandbox IDs were tracked privately and deleted only when owned by this task; a separate GET confirmed HTTP404. The application diagnosis also confirmed zero remaining owned resources. Management resources have their own ownership ledger and absence checks in the owner evidence. No user Key was created, reset or renewed.

## Not verified

Real append-mount data access requires actual OSS, AgenticFS, AgenticBucket and JuiceFS fixtures, including existing role/network inputs. None was supplied; metadata CRUD is not storage-mount acceptance. STS serialization/signing checks do not establish real temporary-credential expiry behavior. No package was published, no unchanged existing cloud resource was mutated, and this record does not certify every cloud API or runtime admission condition.

The PR remains a draft while required service acceptance is blocked. The records remain proposed and the two owner Issues remain open until all acceptance criteria are met.

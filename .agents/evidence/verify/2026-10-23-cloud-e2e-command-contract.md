# Verification: Cloud E2E command contract

- Date: 2026-10-23
- Change: [Issue 124](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/124)
- Result: PASS
- Base: `7958f13d72a02995a21e1d18b7883fb2777da514` (the reviewed implementation in [PR 123](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/123))
- Under test: corrected read-only/lifecycle scenarios, explicit Express setup, strict cleanup and standalone recovery.
- Final cloud run: `20261023152135-4f4a03`, 2026-10-23 15:21:35–15:23:19 UTC.
- Real-cloud binary: CLI 0.4.10 built from the exact reviewed `7958f13` production source; all runner input hashes below matched the coordinator’s executed snapshot.
- Environment: Linux, Node.js 22.22.2; placeholder credentials only for local tests. No credential values recorded.

## What was verified

The runner uses current standard lifecycle commands and the explicit project extension entry.
Safety regressions exercise real identity retention despite downstream failures, negative
credential overrides, create replay prevention, and process/cleanup postconditions.

## Commands run

- `node --check e2e/lib/express-scenarios.mjs`
- `node --check e2e/scenarios/10-cloud-readonly.mjs`
- `node --check e2e/scenarios/20-cloud-lifecycle.mjs`
- `node e2e/run.mjs --list`
- `npm ci --no-audit --no-fund`
- `npx vitest run tests/test_e2e/cloud_contract_safety.test.ts tests/test_e2e/provider_management_skip.test.ts`
- `npm run typecheck`
- `bash scripts/check-repo-health.sh`
- `npm run check:hygiene`
- `git diff --check`
- `ABX_BIN="$VERIFIED_CLI" node e2e/run.mjs --suite cloud-readonly,cloud-lifecycle --json report.json --markdown report.md` (coordinator executed the exact frozen runner with explicit fixture environment below; local report destinations are omitted)

## Results

| Check | Result | Scope |
| --- | --- | --- |
| Syntax and scenario discovery | PASS | Local modules only; cloud operations are not executed by discovery. |
| Safety regressions | PASS | 57 passed, including real local subprocess recovery checks, contradictory negative-create responses, option-shaped ID barriers and paired explicit application-fixture setup. |
| Diff whitespace | PASS | Scoped changes only. |
| First migrated real-cloud run | FAIL | Coordinating reviewer ran both suites: 63 passed, 8 failed, 2 owned sandboxes created, 0 leaked. See breakdown below. |
| Second migrated real-cloud run | FAIL | 69 passed, 2 failed (reserved filesystem blocks and a missing current application file in the deployed image), 2 owned sandboxes, 0 unconfirmed IDs and 0 unresolved creates. |
| Final frozen cloud runner | PASS | All 71 passed, 0 failed, 0 skipped: 20 read-only + 50 lifecycle + independent leak check. Two known sandbox IDs, 0 unconfirmed IDs, 0 unresolved creates. |
| Lockfile install | PASS | 233 packages; two dependency install scripts were blocked by the existing npm policy. No script policy changed. |
| Repository health | PASS | 105 passes, 11 warnings, 0 failures including the final delivery record. |
| Hygiene | PASS | No machine-local paths or credential-like strings in the scoped delivery. |
| Typecheck / changed-file lint | PASS | Final frozen source passed; changed-file lint had three pre-existing unused-variable warnings and zero errors. |
| Remote CI | Pending | Required before acceptance. |

Independent runtime evidence reported by the coordinating reviewer: standard real-cloud
lifecycle/PTY/expiry/kill passed at the reviewed runtime, and OpenSandbox T4
[run 39970670745](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/39970670745)
passed its real lifecycle and cleanup. The final 71-check run separately establishes the corrected
read-only/lifecycle runner result; the earlier runs remain distinct scopes.

## Cleanup

Local tests created only temporary local directories, removed by test teardown. The coordinating
reviewer ran the frozen real-cloud suite after review: both owned sandboxes were destroyed and
the independent final inventory leak-check passed (0 leaked). The final reviewed rerun also
confirmed both created sandboxes absent, with zero unresolved creation attempts. An additional
owned inspection sandbox was independently confirmed deleted. The implementation agent
performed no independent cloud writes.

## Problems found

Old root JSON switches were routed into the standard parser. Standard detached create's
terminal-only environment must not replace project sandbox environment injection coverage.
The old app script path and invented signal PID were invalid test assumptions. The first
migrated run exposed eight remaining assumptions: four native official-template ID/error-shape
mismatches, one structured metrics mismatch, two inferred capability-baseline assertions and
one absent application service (catalog HTTP 502). These results were preserved before the
next frozen source revision. The fixes use same-account native TemplateID inventory, current
precise E5000/API/TemplateNotFound/404 diagnostics, structured metrics, no inferred groups,
and an optional caller-supplied exact manifest startup command with real process admission.
The second run passed 69 checks and identified that reserved filesystem blocks invalidate
used+available==total and that the selected account image lacks the current manifest app file.
The metric check now permits reserved blocks while rejecting over-capacity measurements.
An independent owned-image inspection confirmed the file absence and the coordinating reviewer
confirmed that inspection sandbox was deleted. The final test explicitly uploads the reviewed
application file to the selected manifest destination before invoking the exact start command;
there is no old-path search, SDK reinstall, protocol fallback or alternate startup command.
This is managed-sandbox plus uploaded-current-fixture acceptance, not proof that the original
image preinstalls the file or that native Express source-image construction is available.

Bounded closure review also found optimistic kill acknowledgements could erase live IDs,
malformed process rows could imply absence, negative create tests could lose unexpected IDs,
and timeouts could produce an unjustified clean summary. Shared cleanup/recovery now require
independent valid inventory, persist partial and ambiguous outcomes, and reject unknown IDs.
The local health check initially rejected a temporary dependency symlink; it was removed and
the subsequent lockfile install and health pass use a real local dependency directory.

## Not verified

Latest-head remote mandatory CI remains outstanding until publication of this scoped change.
The managed account image is not certified to preinstall the current application file, and this
run is not Express source-image build acceptance. Failed historical attempts and pending gates
are not counted as passes.

## Exact application fixture acceptance

The final run explicitly uploaded the reviewed application file once before starting the
selected manifest command. The already installed server CLI reported version 0.3.0. The test
verified its protocol-v2 catalog, the real live startup PID, default hello, named arguments,
JSON arguments and unknown-command behavior. `run-named-command` passed in 12.64 seconds.
No alternate application path, SDK reinstall, anonymous retry or protocol fallback was used.

- Reviewed template revision: [4235f53](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/tree/4235f53a8d8c74e504f0441d985ab26243889b4f/python-hello).
- Template manifest SHA-256: `6bfa895461c4e541994b947ed9ff71d4786a524ceb49d3ed0878006e52caf375`.
- Uploaded commands SHA-256: `819dd5d91a67edc9d681b01dc44caac479c6d693d947f1818d5a1253cc9b9ceb`.
- Explicit upload destination: `/home/user/app/commands.py`.
- Exact startup: `agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py`.

This proves the managed-sandbox/current-uploaded-fixture CLI bridge. It does not certify the
preinstalled image contents or the exact source origin of the existing server distribution.
Fresh OpenSandbox T4 above provides separately scoped source-workflow evidence.

## Frozen source identities

The following SHA-256 values identify the final reviewed runner inputs before cloud execution.

| Repository file | SHA-256 |
| --- | --- |
| `e2e/lib/express-scenarios.mjs` | `493b02eab73ac790a2b7fd9b979c6f86dcfd38653c990cc4d09c5e6e901655b1` |
| `e2e/lib/runner.mjs` | `9d9311f085e8d6590fc73cb8ab8edfb7cceac1a600d37212d419d9fa7bf91eee` |
| `e2e/cleanup.mjs` | `7e4fa020ceecab66fe85f6be311433f3f0eec1341e3d2e68150627ad84fc41d9` |
| `e2e/scenarios/10-cloud-readonly.mjs` | `8cd9d16fd677ed516b68fabd135e49a53385ca309161db407696c403b40cc1de` |
| `e2e/scenarios/20-cloud-lifecycle.mjs` | `1658aaa08f04b297ebaf80f8d15d41e66fbfb4b55383dbc3e77bb9a6922391fc` |
| `tests/test_e2e/cloud_contract_safety.test.ts` | `10c4e7b0210cacf564d89119b6dbddc6b4a9def4726a15ed639af204d641846e` |

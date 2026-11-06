# Real Express verification: terminal expiry observation budget

- Date: 2026-11-06.
- Scope: test-only harness correction required by [Issue 237](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/237)'s real-component gate.
- Result: scoped real standard case PASS, with independent owned cleanup; earlier complete-run failures remain preserved.
- Product source, package/lock and all 697 compiled files remain byte-identical to reviewed
  `321eb75d4b88ec42aa9ce9bf1553116ea9be773c`.

## Preserved failures

The initial complete Express run reported 175 PASS, three FAIL and eight SKIP. Two retired-contract
fixtures were corrected and independently replayed without cloud resources, as recorded in
[the initial verification](2026-11-06-cli-0510-express-initial.md).

The second complete run used the reviewed immutable snapshot of `321eb75`. Its actual report is FAIL:
177 PASS, one FAIL and eight SKIP, with zero tracked leaks/unresolved creates. The only remaining
failure was `standard-contract/standard-lifecycle-pty`: its post-terminal lease-shortening check passed,
but the 90 counted polls had not observed HTTP 404. The full scenario took 116.325 seconds, including
its earlier lifecycle/PTY checks; per-poll timestamps were not saved, so its precise polling interval
cannot be reconstructed. The report SHA-256 is
`ea3892b6b79e272d325795e4362188287ac1197ddba6df5f113b6c2ba6d68e5a`.

That run also exposed an external supervisor defect: a periodic encrypted-backup failure caused the
Python wrapper to exit before waiting for its original Node child. Later direct process inspection
confirmed termination, but the original Node exit code is unknown. No synthetic normal result was
written, no ptrace attach occurred after the process disappeared, and neither report is relabelled PASS.
The backup failure's cause remains unknown; a later unchanged backup succeeded.

The corrected image observer produced two complete image entries and independent sandbox/template
absence checks passed. A separately reviewed orphan-recovery authority preserved the unknown exit,
removed only those two exact tags and independently confirmed absence at 15:36:52Z. Its observation
SHA-256 is `7499b3024d827f520691bb8efcef3323570e2689a4a550ed376f59811f79dcff`.
No repository was deleted and no original resource journal/report was rewritten.

## Why the test clock changes

A separately recorded original-binary PTY observation naturally reached typed absence on its 87th
read, about 117 seconds after the first post-terminal response. Its visible lease was 60 seconds;
HTTP 200 responses retained the same endAt, and native absence followed that endAt by about 57 seconds.
That Python observer opened slower HTTP connections than the Node fetch loop. Equal poll counts do
not establish equal elapsed budgets, and the standalone success does not overturn either full failure.

Current official [timeout guidance](https://help.aliyun.com/zh/agent-sandbox/timeout) describes timeout
configuration and recommends explicit kill after tasks. It does not guarantee a 90-poll or 90-second
reclamation SLA. The repository's existing guide already describes asynchronous reclamation. The
pinned upstream CLI still clears renewal intervals, waits for its latest request and requests a short
post-terminal lease. Earlier overlapping renewal requests are a static alternative explanation;
their occurrence in either failure has not been proved, and product code is unchanged.

## Narrow test correction

The helper validates the first native identity, Date and endAt, preserving the original rounded
lease-at-most-60-seconds assertion. It maps the remaining native lease to a monotonic clock exactly
once, then allows 90 seconds of observation grace. This grace is an explicit verification budget,
not a cloud SLA. It never changes a lease, reconnects, resets its deadline or accepts HTTP 200 as expiry.
A later endAt immediately fails. HTTP errors/transport failures and unknown absence also fail.

The complete standard case has a 210-second observation deadline, at most 25 seconds for parallel
owned cleanup and five seconds to exit before its existing 240-second outer guard. A PTY starts only
with its complete 60-second parent budget, exceeding the unchanged Python probe's 45-second bound.
HTTP AbortController covers headers and the entire bounded body. Independent typed getInfo runs in
a read-only child whose timeout kills that child, including body I/O; it never calls connect.

Known owned cleanup continues even if optional diagnostic writes fail, clears ownership only after
typed absence, and still marks the case failed for lost evidence. Unknown deletion is not replayed
by finally. Cleanup failures do not replace an earlier primary failure. An optional private 0600
ledger records owned IDs, native observations and cleanup; it is test infrastructure, not a product API.

## Local verification

Thirty-seven Node tests passed: 24 image-observer cases and 13 expiry/budget/cleanup cases. New cases
cover equal wall-clock limits under fast/slow transports, persistent HTTP 200 at deadline, delayed
observations consuming the original budget, later endAt rejection, invalid identity/time, fatal HTTP
or transport errors, independent/late typed confirmation, real response-body abort, full PTY admission,
diagnostic EIO with successful cleanup, unknown delete without replay, and diagnostic latency before
removal admission. Independent reviewers reran the same 37 cases. Lint, node syntax and diff checks pass.

## Separate real standard gate

The definition of done and E2E runner permit related real scenarios selected with suite/filter controls.
After independent review, the next allocation is only the unchanged complete standard lifecycle case:
detached create/exec/list/PTY/connect retention, interactive create, lease, natural typed expiry,
explicit kill and finally cleanup. It creates two sandboxes and no template/image/database/model key.
An independent ten-minute supervisor retains its real child wait/deadline when backup fails.

The admitted complete standard case ran from 15:50:43.806Z to 15:52:27.721Z (103.915 seconds), with
actual waited exit 0, no timeout and confirmed periodic encrypted backup. Detached create/exec/list,
real PTY state, connect retention, interactive create, native lease/natural expiry, explicit kill and
finally cleanup all passed. Native observation 79 returned HTTP 404 at 15:52:23.965Z. Earlier HTTP 200
responses retained endAt 15:51:53Z; an independent typed read confirmed natural absence. The detached
sandbox had one explicit kill followed by typed absence. A fresh independent controller subsequently
queried both recorded owned IDs and confirmed both typed absent. No template, image or database was
created by this selected case.
Its 79 observations are fewer than the old 90-count cap, so this live success alone does not prove
that the longer observation budget caused success. Controlled fast/slow-clock regressions establish
the count-based budget defect; the real run independently verifies the corrected complete case.

The private append-only ledger SHA-256 is
`8e14695960e065da1419ea1210df96e78f7b9a110eb64c60e924d14b558ff00b`;
the final independent readback SHA-256 is
`f188494c61b017a4ef2cc4e24f1f4b82e3a18a3e35d04af580dd133c7d4e9a6e`.
All 697 dist files were compared with the earlier immutable `321eb75` snapshot, with zero differences.
The test helper, standard case and test-source hashes were reviewed independently before allocation.

The existing 177 passing cases, the corrected selected case and the eight conditional skips are
reported separately across runs. This is not a claim of one complete 178-pass run. A later full managed
template deployment with the actual published CLI remains an independent acceptance gate.

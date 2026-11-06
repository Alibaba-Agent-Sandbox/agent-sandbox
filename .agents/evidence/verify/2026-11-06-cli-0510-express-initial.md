# Initial real Express verification of CLI 0.5.10

- Date: 2026-11-06.
- Result: FAIL. This run is preserved; no retry or passing-result substitution was performed.
- Source: `b544c4ca8233bcbd24691e43638383cef8d6375d`, CLI 0.5.10, Node.js 22 on Linux.
- Scope: once-only original `e2e/express-workflow.mjs` with `ABX_WORKFLOW_FULL_E2E=1`, isolated
  HOME/work/capture directories, existing credentials supplied only to the child, no database or new
  management key. Maximum 40 minutes.
- Actual interval: 14:29:58.289Z–14:37:54.975Z; exit 1, approximately 476.7 seconds, no timeout.
- Private report SHA-256: `e4f56049b520f604dbc6ec7313bc9b7fcaa3cb10cd8697e8798550f8aa4f2e58`.

## Observations

Eight outer business checks passed: Registry source launch with its declared application service,
immutable image/template receipt, CLI info/list, exec, command discovery, named command, direct HTTP
hello, and upload/download/stat/remove. The original finally block also passed independent typed
sandbox/template absence checks. Those nine checks do not establish full-suite success.

The embedded full suite reported 175 PASS, three FAIL and eight SKIP. Its tracker reported zero leaked
sandboxes and zero unresolved creates. The failures were:

| Case | Actual failure | Triage |
| --- | --- | --- |
| `capability/template-profile-no-network` | Required spec 4 and retired `workflows.application.startup` | Stale fixture: the existing scaffold emits spec 5, `provides.app` and `start_cmd` |
| `catalog/search-json-shape` | Required the retired `workflow` JSON key | Stale fixture: the existing catalog emits source locators or managed `manifest`; a source row has `manifest: null` |
| `standard-contract/standard-lifecycle-pty` | Interactive-created sandbox still returned HTTP 200 after 90 polls | Unresolved; first post-terminal lease-shortening assertion passed, but the polling code did not retain status/endAt/date snapshots |

The existing user guide states that Alibaba reclamation is asynchronous. This observation does not
prove a regression in the one-line Gateway readiness change, nor does it establish a cause for the
late expiry. Its assertion has not been removed or weakened.

## Image projection and cleanup

The initial test-only image projection reported zero rows and `unconfirmed`. The actual private
journal contains exactly two image entries, both `retained` with manual cleanup, plus template and
sandbox entries. No third envd image is inferred. The production launch compiler appends a fresh
16-hex suffix to the requested alias; the projection fixture incorrectly expected the unsuffixed
alias. The template correlation and both image tags share the actual complete generated name.
The raw report/journal are unchanged. Native image identities and credentials are not published here.

Compute/template cleanup is independently confirmed by the original run. A separately reviewed
fixed-resource recovery subsequently removed only the original two exact image tags, with no repository
deletion, forced local removal or rewrite of the failed report. Its once-only apply passed at 15:06:07Z;
a fresh process independently confirmed both tags absent at 15:06:28Z. The observation SHA-256 is
`0c2f5f417e01e9468335369ce100ce5765e02f5612a8bd6cf2ec7c5951387ac2`.
The generic recipe repository is retained. These cleanup results establish release of this run's
known resources; they do not claim account-wide absence.

## Follow-up without cloud resources

After independent review, only the two stale fixtures were aligned with the existing contracts.
The scaffold check now asserts spec 5, exact service protocol/version/port/operations/start command
and absence of retired workflow declarations. The catalog check asserts `manifest: object|null`,
the actual source locator for python-hello, and absence of retired workflow/capabilities keys.

`ABX_BIN='node <candidate>/dist/bin/abx.js' node e2e/run.mjs --suite capability,catalog
--filter 'template-profile-no-network|search-json-shape' --json <local-report>` passed both cases
(249 ms and 557 ms). The runner had no cloud credentials and created no sandbox. Its leak check
was skipped because there were no cloud resources. This replay does not turn the original real
failure into a pass.

The image observer was then corrected after three-way review. A successful launch now binds its exact
journal UUID/plan and unique template-reference entry to the complete generated correlation name.
Image tags must equal that name, or its envd derivative backed by an actual image intent. Before the
first launch, the script freezes existing journal UUIDs; an early failure can only project new journals
with a closed generated name and remains unconfirmed. The original compute cleanup selector is
unchanged. Twenty-four pure observer tests passed independently; this does not claim a new live gate.
The first full local rerun caught the repository's `preserve-caught-error` rule in the new prelaunch
directory guard. The guard now retains the error as `cause`; its caller still prints only the static
message, without exposing the cause. The rule was not disabled, and all 24 observer tests pass again.

## Separate one-sandbox expiry observation

A separately reviewed, once-only ten-minute observation used the original `b544` dist bytes and the
unchanged original Python PTY probe, with a fresh HOME, prior native inventory and encrypted admission.
It created one `code-interpreter-v1` sandbox, with no template/image/database/model or management-key
mutation. Private records retained each HTTP status, response Date, endAt and state. The original
90-poll policy was preserved; a separately labelled additional 90-poll diagnostic was available but
never used.

Actual interval: 15:02:39.413Z–15:04:44.372Z. The first post-terminal response had a 60-second lease.
All HTTP 200 observations retained the same endAt, 15:03:45Z. Poll 87 returned HTTP 404 at 15:04:42.728Z,
and an independent SDK read confirmed typed absence. Owned processes were absent. The sandbox had
expired naturally, so finally performed no DELETE. No create/delete was retried.

Result SHA-256: `e51277028deb2a35dce0e5e0b001e4b117681c68a3c6b88ff28e0b2b3147c6f5`.
This establishes success of that separate original-window observation. It does not identify the cause
of the earlier full-suite expiry failure or rewrite the original FAIL. The expiry assertion and
product behavior remain unchanged. A fresh complete Express gate is still required.

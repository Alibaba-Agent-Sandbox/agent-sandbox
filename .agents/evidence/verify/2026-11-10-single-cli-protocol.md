# Single frontend / protocol subtask verification — 2026-11-10

This record covers the isolated implementation subtask. It is not a full-repository
release acceptance result. No cloud resources, model tasks, management Keys or package
publication were performed by this subtask.

## Passed local checks

- Seven parser/Provider/HTTP configuration suites: **85 passed**. These include the
  shipped executable, canonical Provider operations, retained list/info schema discovery,
  retired entry rejection, root JSON output, SDK import without argv/env side effects,
  explicit Provider endpoint/key resolution and actual local snapshot requests.
- Sandbox API/protocol/lifecycle-wire suites: **114 passed**. A real local HTTP server
  observed `autoPause`, optional `autoResume.enabled`, and unchanged named Volume mounts.
  Unknown lifecycle fields, invalid pause/resume combinations and unsupported Providers
  were rejected before creating a transport.
- Files/process/system suites: **83 passed** across four files.
- Configuration/session/HTTP subset: **42 passed** in its initial run. This overlaps the
  suites above and must not be added to them as a unique test count.
- The final native-exec/session/configuration subset was rerun after routing and deadline
  refinements: **9 passed**. A later signal-specific extension is recorded below.
- Relevant ESLint checks passed with no errors. Seven source-provenance tests passed.
- Regenerating the SDK runtime, declaration, legal comments, notices, license export and
  dependency manifest produced the same six SHA-256 hashes.

The SDK runtime changed from **4,100,936 bytes** to **1,236,102 bytes**. This is the
uncompressed generated file only, not an installation/RSS/performance measurement.
The generated distribution carries 12 dependency/source attributions; the former
prebundled source records remain retained as provenance.

## Component scope

The PTY tests use an actual POSIX terminal and the session adapter with a controlled
remote handle. They verify input delivery, resize, normal/nonzero exit, SIGINT and raw
mode/listener cleanup. Separate child-process tests verify ordered UTF-8 input, 64 KiB
write boundaries, EOF and nonzero exit propagation. These are host component checks,
not live sandbox terminal acceptance.

HTTP fixtures execute real SDK/client requests to a local server. They do not prove
current cloud API availability, all Providers, every network policy, or cloud billing and
resource cleanup. Existing named-Volume semantics were preserved rather than replaced
with the standalone SDK's Volume management layer.

## Integration checks pending at this record

A full `npm test` run was started before the integrated build was available. Its log
already records missing `dist/bin/abx.js` failures and old public-command expectations.
The root agent owns management command/test migration and the final built-artifact
checks. Those failures must be classified and rerun after integration; they are not
silently counted as passes. Typechecking during concurrent integration exposed root
management/surface changes; no final full-repository typecheck claim is made here.

## Open-stdin signal follow-up

The expanded session suite passed **5 tests**. Its extra executable child keeps stdin
open, receives SIGINT, stops its controlled remote process and exits with the observed
remote status 130 while releasing signal ownership. This specifically checks that
waiting for piped EOF cannot prevent interruption cleanup.

## Final subtask integration run

- The final scoped run covered **22 suites, 293 tests, all passed**, including actual
  child stdin/PTY behavior, the single executable, Provider and saved-name routing,
  JSON/remote exit propagation, lifecycle wire models, configuration and template managers.
- Independent follow-up **87 command/output golden cases** were captured in
  `tests/test_cli_evidence/golden/single-frontend-20261110/` and then compared again.
  Previous golden batches are unchanged. Retired create/direct-deploy snapshots are no
  longer current assertions; source-authoring/deployment behavior has dedicated tests.
- Whole-repository TypeScript typechecking and the integrated `npm run build` passed
  after these changes. The built executable exposes `provider run template.create`
  with the actual optional-Team JSON schema. Final full-suite/release checks belong to
  the integrating change; these scoped counts overlap earlier runs.
- The first full-suite run, before the integrated build and command-test migration,
  had **4,152 passed, 543 failed, 8 pending, 4,703 total**. It is retained as a failed
  intermediate run, not evidence of final acceptance. Failures included absent dist
  artifacts, retired public aliases and unrelated environment/proxy failures.
- Actual CubeSandbox and Node plugin HTTP fixtures also returned HTTP 501 with the
  environment message `项目网络审计已关闭`. No product assertion was weakened to mask
  that failure and these network cases are not counted as cloud/transport passes.

### Signal cancellation counterexamples

Additional real child and POSIX PTY cases use a kill operation that rejects, or never
settles, while the remote wait never settles. Local cancellation finishes within the
2-second bound, disconnects the client and restores terminal state. The error explicitly
says remote termination is unconfirmed. A successful local interruption is not proof that
remote side effects stopped. Background stdin keeps the upstream semantic: piped input
must reach EOF before detaching; an infinite pipe does not detach until interrupted.

### Provider resources and authorization

Express native template list/get/create/delete are public `provider run` operations,
using the existing official SDK request constructors. Team precedence is explicit input,
existing local/operation configuration, then the old same-AK/SK ListTeams fallback.
Create rejects a name collision without deleting or updating it; submission does not
manufacture readiness. Private registry credentials are masked in returned diagnostics.

Other Providers retain their existing optional template manager through four static
command descriptors derived from templates.read/build. Explicit same-name descriptors
win. Discovery does not acquire a manager; invoking a missing optional method fails and
closes the acquired manager. SDK, public parser and authenticated loopback engine tests
exercise the same path, including explicit write/delete confirmation and cleanup.

`--ci` now selects output behavior only. It cannot confirm Provider operations or create/
renew a managed API key. Existing saved keys remain reusable. Automation explicitly calls
`provider run api-key.prepare --yes`; ordinary deploy `--yes` is not credential consent.

Cross-Provider listing returns `{items,partial,errors}`. A failed Provider is never treated
as an empty successful query: partial results contain fixed safe stderr warnings/codes,
all-remote-failure still fails, and interruption stops iteration. `list --local` needs no
cloud configuration. Saved names select their saved Provider/endpoint before preflight.


### Active consumers and final local verification

The active source hints now point to root deployment management, `sandbox` operations,
`template init/build/publish`, canonical config, and `provider run`. The unreachable
`cli/template_install.ts` orchestration was removed. The old Express top-level deploy
wrapper was removed by the authoring task; provider template service helpers remain
available for the existing build path and internal adapter tests, without public aliases.

Release checks, shell build helpers, benchmark help and active E2E scripts use the single
parser. The batch scripts acquire source with `template init --from` and write reusable
artifacts with `template build --out`; `deploy_remaining.sh` selects four names through the
same batch implementation instead of duplicating Python/Docker/registration orchestration.
Provider scripts use explicit `api-key.prepare --yes` for credential changes. Real terminal
Sandbox checks now deploy, explicitly connect, verify borrowed instance retention, and
explicitly delete; they do not expect the retired create-and-autoattach lease behavior.
The native step-failure harness uses `provider run template.create` to observe submitted
build failures, rather than pretending the ready-only authoring build succeeded.

Incremental checks on the local candidate, all without cloud submission:

- Seven relevant Vitest suites: 317 passed, 0 failed (root help/main/output, conditional
  discovery, progress activity, all three shell helper argument traces, and region routing).
- Current golden batch plus non-Express REPL: 122 passed, 0 failed. The 87 current snapshots
  were updated only under `single-frontend-20261110`; earlier batches remain unchanged.
- Built CLI offline suite: 87 passed, 0 failed; one explicit leak-check skip because no
  cloud instance was created. Selected-provider static help and real installed local
  adapter dispatch run as separate subprocesses.
- Provider installer plus local-process integration: 23 passed, 0 failed, 0 skipped.
  This uses the fixed sibling Python SDK example, actual local child processes and files,
  explicit deletion, and a failing command's exit code.
- Standalone provider boundary fixture: qualified read, namespace conflicts and missing
  template-manager methods all passed using the actual parser/filesystem.
- Local POSIX onboarding script: 8 checks passed, including hidden-input interruption,
  explicit consent, persisted credentials, automation and piped-output noninteraction.
- Release-artifact checker against a frozen built dist: passed version, command/help,
  no-key structured failure, source initialization/overwrite, real terminal cancellation
  and complete license notices. The local entry was executable as npm-installed bin
  entries are; this does not claim a packaged SEA or publication.
- Whole TypeScript typecheck passed. Relevant source and E2E/helper ESLint reported no
  errors (existing warnings retained). Changed JavaScript/shell and embedded Python
  syntax was checked; `git diff --check` passed.

Two execution setup failures are retained separately: the first Provider helper run used
an older workspace example without operation_contract_version and correctly failed
installation; the second collided with another task's clean-build output replacement.
The successful run used the fixed sibling example and a frozen dist copy. An intermediate
E2E environment helper mistakenly translated deliberate E2B-only test overrides into ABX
values; removing that test-only translation restored the intended credential-isolation
assertions without relaxing product behavior. Credential-fixture normalization stays in
loadCredentials, while explicit extra environment inputs are passed unchanged.

No cloud E2E, new managed key, remote template build, package publication or remote
resource cleanup was performed in this consumer migration. Native/cloud scripts retain
their owned-resource checks, but their updated backend operations are not newly certified
by the offline/parser results above. The earlier HTTP501 audit-transport failures remain
failures and are not converted into passes.

### Final package, cleanup-fixture and execution-deadline follow-up

The final integrated suite exposed two package-entry failures and one volume-cleanup
fixture failure. The package failure was real: six new relative SKILL links referenced
`docs/`, which is absent from the npm file set. Those links now use the canonical GitHub
URLs; packaged local reference links remain local. The volume fixture now returns the
actual `deploy` field `sandbox_id` and expects `delete`; its four-step tracked-resource
and failed-mount cleanup assertions remain intact.

The parent reported real-cloud silent and continuously-outputting commands both failed
the typed total-deadline assertions. The scenario already used the current public parser
and correct argv. SDK `TimeoutError` cannot reliably distinguish command, request and
connection expiry, while the session lacked an owned total deadline and awaited cleanup.
Following independent parent review, the CLI now starts one deadline before `commands.run`,
races both start and completion, and aborts its SDK stream/request on expiry. It uses the
existing `CommandTimeoutError`/E3001 contract. Known PID errors identify the process asked
to stop, but explicitly state termination is unconfirmed. Unknown PID errors say the
start was not acknowledged; a late handle is only cleaned, never retried. Cleanup calls
the same SDK `commands.kill` with a two-second request timeout and abort signal, bounds
the local wait to two seconds, aborts the cleanup RPC and disconnects the local handle.
No kill acknowledgement is presented as independent proof of process exit.

The CLI timer is cleared on all paths, including immediately after a background PID is
acknowledged. SDK background timeout and stdin EOF behavior remain unchanged. Timeout 0
adds no request signal or new request-timeout override. An SDK request timeout arriving
before the owned deadline keeps its original classification; no error-message inference
is used.

Validation: 34 targeted tests passed (session/native output/package entry/volume mount),
including actual silent and continuously-outputting child processes with independently
observed SIGTERM exits; rejected/hanging kill RPC; bounded cleanup with abort; late start
acknowledgement without re-execution; detached command timer removal; unchanged SDK request
timeout; and one E3001 JSON error through `main`. Existing real POSIX TTY and signal tests
also passed in that set. `tsc --noEmit`, targeted ESLint and `git diff --check` passed.
The initial new JSON assertion incorrectly expected a nested error object and was corrected
to the existing top-level code/message contract; product output was not changed to fit it.
Local reports: `/tmp/cli-deadline-fixes2.json`, `/tmp/cli-deadline-tsc2.log`, and
`/tmp/cli-deadline-lint.log`. This follow-up did not rebuild dist or create cloud resources.
The parent will rebuild once and rerun the two original cloud deadline scenarios on its
single owned sandbox, including independent process inventory and resource deletion.
The focused report contains 37 cases total: 34 passed and three existing real temporary
filesystem-mount integration cases skipped because their mount opt-in was not enabled.
These skips are not volume-provider or real-cloud mount acceptance.

Staging the newly added SDK supplementary notice exposed a final blank line at EOF.
The notice refresher appended a newline to license text that already ended in one.
SDK-only notice generation now ends with one newline; the aggregate notice digest was
updated, while all original license-source hashes and nonblank content are unchanged.
The build explicitly retains the prior aggregate separator, so existing generated license
text and runtime/dist bytes need no rebuild or modification. Historical upstream CLI
provenance files were not rewritten. Offline byte comparison proved the old supplementary
fragment equals the newly rendered fragment, both scripts passed syntax checks, all seven
provenance tests passed, and `git diff --check` passed. No network refresh was performed.

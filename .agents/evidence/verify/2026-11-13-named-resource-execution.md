# Named-resource execution verification — 2026-11-13

Result: PARTIAL. Resource-engine and ordinary-service checks passed; the new managed
application cloud acceptance below remains BLOCKED on prepared application inputs.

Scope: the user's final `specVersion: 1` contract, native Express/FC resource
execution, application-owned startup/publication and the existing CLI presentation.
This record supplements the [decision](../../notes/proposed/architecture/2026-11-13-named-resource-execution.md).
Owner contract: [6009ae6](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/commit/6009ae607b1a92fba2b88bef029d47aeef92bcfb).

## Adversarial review and resolved findings

Independent contract, native-engine and Registry/application reviewers challenged
resource readiness, deployment-vs-instance semantics, FC component consistency and
cleanup. Subsequent review repeated after each implementation gap:

- A native FC create conflict could fall back to updating an unrelated function.
  The isolated host now guards first creation. Original fc3 0.1.26 bundle probes
  proved existing-function and 409 cases make no update/tag writes; successful
  creation still completes the original full deploy. A no-op component cannot
  claim creation. These are transport admission controls, not a replacement FC deploy.
- Native component logs had been discarded. The host now injects the complete logger,
  bridges direct output through bounded complete-line redaction and separates results
  from diagnostic events. Actual deadlines terminate owned local process groups.
- Template-native startup would freeze ordinary application authentication too early.
  Ordinary templates use their SDK runner; the managed SDK already starts Guest
  after instance environment/token injection. No dynamic instance is created by deploy.
- Pre-deploy dotenv generation must affect later resources. Native expressions are
  re-resolved without mutating process environment; changes to resource graph or
  template source during actions are rejected.
- Docker COPY could include local private files. A private context snapshot removes
  reserved control files, keeps ignore-file precedence and verifies staged input
  identity. Fingerprints include modes, links and dependency directories. Build and
  push deadlines kill local children; they do not promise remote rollback.
- Native FC auto resources can be shared. Requested and observed references are
  retained separately and accumulated by native function name. Function deletion
  does not claim deletion of RAM/SLS/VPC/NAS/OSS resources.
- Prepared builds have consumers; deletion of a consumer keeps borrowed resources.
  Cleaning a used build is rejected. Failed admission before resource receipt creation
  releases the consumer reservation. Source-independent removal uses saved identities.

## Executed local checks

- Owner contract: canonical JS/Python parity and 514 script tests plus 199 subtests;
  two conditional public-CLI checks were run separately by the owner.
- CLI full run: 4,568 passed, 61 skipped, one stale native-create response fixture
  failed. The fixture was corrected to the actual `ID` field. Its original cleanup
  assertions remain; the subsequent focused run passed 29 tests (3 conditional skips).
- Earlier full run failures from retired manifest fixtures and duplicate instance
  entry assumptions were preserved in local logs and repaired, not counted as passes.
- Historical managed receipt lifecycle remains covered through captured private test
  data; a test-only reader does not restore the retired public application schema.
- Docker builder/context checks: 56 passed, including real subprocess timeout and
  descendant termination probes. Actual Alpine COPY build proved reserved secret
  sentinels cannot be restored by ignore negation; ordinary files and Dockerfile-specific
  ignore precedence remain correct. Temporary context and test image were removed.
- Native host/terminal checks: 80 focused tests passed, including eight real POSIX PTY
  scenarios. Native bundle guard probes used the published fc3@0.1.26 component.
- Typecheck and build passed. ESLint had zero errors; existing warnings are separate.
  Repository health passed with no failures. Final post-integration results are appended
  below rather than replacing these intermediate observations.

## Real cloud operations

Only bounded resources for this task were created; no database or management Key was
created or renewed.

1. New Express API adapter created a template, waited for `ready`, deleted it and
   independently confirmed NotFound. Static API metadata is Sandbox/2026-08-20.
2. New resource executor invoked the official Devs loader and published fc3@0.1.26,
   deployed a Node.js function, invoked its actual code and checked the result. Native
   remove completed and independent function lookup confirmed absence. This was repeated
   after the create-only guard was added; both runs completed and cleaned up.
3. The current `python-hello` recipe was copied unchanged except for the controlled
   target image/region values. Its actual Docker build, ACR push and template readiness
   succeeded. The shipped `run.py` then created a dynamic instance, started the server
   with its private application token and completed authenticated discovery. The instance,
   template and exact owned image tag were removed with independent absence checks.
   The registry repository itself was not claimed as exclusively owned or deleted.

Sanitized phase results for the third exercise:

```json
{"phase":"docker-push-template-ready","status":"ready"}
{"phase":"as-shipped-dynamic-runner","status":"ready"}
{"phase":"instance-cleanup","status":"deleted"}
{"phase":"template-cleanup","status":"deleted"}
{"phase":"registry-tag-cleanup","status":"deleted"}
```

The isolated Docker daemon used a dedicated socket, data directory and bridge, with
no changes to an existing daemon configuration. Its final disposal is recorded below.

## Boundaries

These checks do not claim every catalog image or Provider passed cloud acceptance.
Native Steps produce templates, not a proven exportable/pushed OCI image. Named-resource
adapters currently cover Express and exact-version FC3. Other Provider instance APIs
retain their separate scope. Docker build reuse needs the original local source and
native build artifacts; it is not a cross-machine image distribution format.

Agents API has template-owned release/state-pin/authentication/drain logic and fixed-SDK
local process/contract tests in its owner record. Full new PostgreSQL-backed cloud
publication, retained-session upgrade and model-turn acceptance were not run here:
this workspace has no prepared database/execution-role inputs for that application.
The generic resource and ordinary service exercises above do not substitute for those
business checks. Public release and merge status must be checked independently.

## Final integration checks

After merging CLI main at `57c7632706aac739171fcdb7c2849938e58295ef`, the full
`npm test` run passed 4,570 tests with 61 conditional skips (220 passing files,
five skipped files). The previously failing native `ID` response fixture passed.
The last build lifecycle changes separately passed 26 executor/CLI checks, then
three additional CLI admission cases brought the deployment-command file to 15
passing tests. Those cases reject build-to-build, source-to-build and build-to-source
changes before credential resolution, cloud calls, actions or receipt/consumer mutation.
Independent review confirmed that archived identities preserve ownership and new
build consumers remain borrowed. The final contributor instructions match resource
preparation and explicit dynamic runtime startup.

`npm run lint` completed with zero errors and 262 warnings. `npm run check:hygiene`,
package-entry dry-run checks and repository health passed (105 passes, 11 registered
historical warnings, zero failures). Typecheck and compiled build passed.

The dedicated Docker daemon and containerd were stopped after checking that no
containers/builds/pushes were active. Its owned data, images, cache, socket, context,
bridge and eight bridge/subnet-specific firewall rules were removed. IP forwarding
was restored to the observed original value `0`; six independent cleanup checks
passed. Unrelated firewall rules and installed packages were retained.

A final independent hook review found that a Serving-only prebuild still ran
`complete-deploy` via `finally`, and could swallow its failure on `continue`.
Serving prebuild now runs its build/pre-deploy actions without deployment terminal
hooks; actual deploy retains success/failure/complete behavior. Four success/failure
regressions passed (18 executor tests total), with typecheck and scoped lint passing.

The first full parity run additionally exposed six retired fixed-pipeline ledger
names and an integration assertion that still rejected the now-explicit
`sandbox create` entry. These are corrected against current observable behavior,
not removed from the historical ledger. Six server-guide cross-checks initially
skipped without the server SDK; using the installed published server package
passed all 23 guide tests. The final parity result is recorded separately below.

## Final full parity result

The complete Vitest parity run on `bd4026fc1ac56524d8c1a43425634fb07b5860a3` passed
4,610 tests, zero failed and 55 conditionally pending, including integration tests
excluded by the ordinary `npm test` command. It used the installed published server
package for the six formerly skipped guide checks. The current workspace SDK checkout
did not contain four historical moved-test names; this was a checkout mismatch, not
a CLI test failure. Rechecking the same fresh JSON test report against CI's exact
Python SDK commit `8e610a3658040d8d6973e7951f9590ea50a4d70a` passed all 907 ledger
entries and verified all 11 moved tests (zero failed/skipped, missing or moved-not-found).
The immutable Python ledger was retained. Final full ESLint again reported zero
errors (262 warnings), and final strict typecheck passed.

## Native Steps cloud follow-up

A final independent coverage review found that the prior image-only and Dockerfile
exercises did not prove native Steps execution. A fresh single-template verification
used generation 2 and the same already-tested public runtime-v2 base image. The
new resource executor submitted `USER root` and a `RUN` writing a unique non-secret
marker to `/opt/abx-step-proof`, then waited for ready. One explicitly-created
dynamic instance read that file without writing it; exit status and exact marker
content matched. This proves the step output reached the instantiated template.
No Docker daemon, registry push, model or Serving resource was involved.

Both deletion operations completed. The first verification script incorrectly
expected `E1003` for an absent instance and read `teamID` instead of the saved
receipt's `team` field; its cleanup verification therefore reported failure. A
separate read-only check with the actual types/fields confirmed instance
`SandboxNotFoundError` / `E2009` and authenticated template HTTP 404 /
`TemplateNotFound`. The failed harness checks remain distinct from those later
independent absence confirmations. No additional resource creation was used to
obtain the confirmation. The template receipt records `deleted`.

This confirms native Steps-to-template behavior, not OCI export or pushing the
completed snapshot back to `template.image`.

## Installed package follow-up

The final remote package job exposed a stale release harness that still expected
`deploy --template-id` and the retired manifest shape. Production build/entry checks
had passed; the harness was corrected to the explicit instance command and named
resource preview. A newly built npm tarball (SHA-256
`812e19359904557534bc93367c031f4033d65352c0fb52dda8eb2cc58ed2d1ef`) was actually
installed in an isolated prefix and exercised by the complete release-artifact script.
It passed version/help, named-resource parsing and output-dependency preview, a real
loopback HTTP Provider request with the expected body/Bearer header and no replay
after 403, single JSON output, missing-credential admission, actual POSIX PTY cancel
and complete notices. The HTTP server used synthetic credentials only. ESLint and
diff checks passed. No production code change or cloud operation was needed for
this package-harness correction.

The accompanying current E2E-entry corrections and real Docker-failure checks are
recorded in [their owner evidence](2026-11-13-resource-e2e-entrypoints.md). The second
dedicated Docker test daemon was stopped after that check; six independent cleanup
assertions passed, including complete firewall-rule/policy equality with its
pre-start baseline and restoration of IP forwarding to zero.

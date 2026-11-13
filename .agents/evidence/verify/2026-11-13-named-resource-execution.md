# Named-resource execution verification — 2026-11-13

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

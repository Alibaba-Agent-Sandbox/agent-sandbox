# Native resource workflow verification — 2026-11-25

Result: IN PROGRESS. Local tests are separate from real Docker, cloud resources and
the full catalog/runtime migration. The later static Express check below created
and removed exactly one owned Template; earlier local checks created none.

## Executed local checks

- TypeScript typecheck passed after the focused implementation.
- Focused local build/resource lifecycle/public command suites: 95 passed.
- Additional lifetime parity, failed FC readiness and failed image publication
  regressions: 40 passed across the three affected suites.
- Actual generated CLI help/operation snapshots: 87 passed; updated again after
  the latest command changes. Final integration result is recorded below.
- Earlier component worker, parser and private build-context focused suites
  passed. They use controlled transports/process fixtures, not real cloud calls.
- An earlier repository-wide run on the pre-integration candidate had 4658 passed,
  61 skipped and 39 failures. The failures included removed command contracts,
  pending upstream test corrections and host network/PTY tests; it is not recorded
  as an aggregate pass. Later integration results must remain distinct.

## Behavioral assertions

Build does not obtain cloud credentials, evaluate unrelated runtime secret
variables, execute deploy hooks, create a volume or register a template. Cache
reuse requires matching source and an observed immutable Docker image ID. Changed
sources and missing/mismatched images cannot reuse stale mutable tags. Steps-only
and Serving-only builds report no local build. Unsupported OpenSandbox native
resource deployment fails before secret resolution or cloud requests.

Static deploy submits templates rather than Sandbox instances. Borrowed references
are never updated/deleted. Typed absence is distinct from 401/403/5xx. FC states
failed/pending/missing update metadata do not become ready. Failed push leaves a
pending retained image and never replays hooks or marks it ready. Named instance
creation retains actual IDs and an independent cleanup intent and forwards the
selected lifecycle configuration.

## Real Docker test

`e2e/local-resource-build.mjs` invokes the built CLI and actual Docker with FROM
scratch and one unique local file, then inspects the image and verifies cache reuse.
It has no registry/network base-image dependency and cleans only its returned image.
The existing CI test job runs it on Node 22. Initial candidate 8dda810 ran it in
[CI 45594770419, Node 22 job 139137838296](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45594770419/job/139137838296).
Step 12 succeeded and emitted actual_docker_build=true, cache_verified=true,
cloud_deployment=false. The overall job subsequently failed its old consumer
tests, and the package job was skipped; those failures remain distinct. The later
configuration-path isolation/progress changes also passed the actual Docker step
in CI 45596327189, Node 22 job 139143244669. Both Node 20 and Node 22 unit steps
succeeded; the subsequent parity check failed on seven stale contract-replacement
targets and one old integration result expectation. These are not an aggregate pass.

## Boundaries

No real native FC deployment, OpenSandbox native resource adapter, model
task, Agents API bootstrap, generated token injection, OpenAPI auto-binding, full
registry migration or published package is certified by this candidate. Source v5
startup remains supported explicitly while v1 create is application-empty. Current
guides describe the two formats rather than promising a service from static deploy.

Final integration/CI and subsequent review evidence will be appended separately.

## Main integration and source-acquisition correction

The candidate was normally merged with main c9a068c in 8dda810, preserving the
completed bounded UX fixes. The first integrated full run reported 4674 passed,
61 skipped, 35 failures. It overlapped a dist clean/build, so missing-dist helper
errors from that attempt are not a valid package verdict. Other failures included
changed create result/metadata expectations, old cleanup-file fixtures, a retired
confirmation prompt, progress wiring and host HTTP/WS proxy behavior. These are
kept distinct from subsequent focused correction runs.

The initial concern that remote v1 source acquisition still used the old v5 loader
was incorrect for the current path: acquireTemplateSource calls RegistryClient.fetch,
which copies/downloads without executing that loader. The actual CLI fetched
`Alibaba-Agent-Sandbox/agent-sandbox//docs/examples/native-resources@8dda810` from
public GitHub and `deploy --plan` exited 0 with one agent resource,
createsDynamicInstances=false and builds_or_cloud_changes=false. No deployment
record or cloud resource was created. The temporary child-process configuration
directory used for that read-only probe was removed. Later probes use the existing
configuration-path test seam without changing HOME.

Focused consumer correction: 366 passed across create output, error formatting,
cloud-cleanup safety fixtures and shell helper parsing. Pure-build progress now
uses the existing OutputManager activity with Docker on_output; 45 focused tests
passed including no cloud push/registration and a single JSON result. The catalog
regression additionally covers name resolution, pinned Git source, normal resource
execution and strict rejection of invalid downloaded YAML before credentials.
The five catalog tests passed. The ten progress tests and five catalog tests also
passed together after giving the progress fixture its own private cache directory;
without that isolation a previous fixture's valid cached image correctly omitted
fresh build lines. The CLI behavior did not require disabling cache reuse.

## Real static Express lifecycle

Built CLI from 0291ce6 used existing configured management credentials and Team.
Read-only discovery selected an existing Ready generation-2 template's source
image with no returned registry-auth/network override. That image was borrowed;
its current pullability was established by this deployment, not inferred merely
from the source template's Ready status. Private account/source identities remain
outside the repository.

A unique local resource project contained one Express template using that image,
generation 2, CPU 2, memorySize 4096 and diskSize 15360. It contained no actions,
Dockerfile, Steps, volumes, instances or Serving. Before execution, engine review
confirmed image ownership is recorded only for Docker publication, so this source
image could not enter the owned deletion set. Total execution was bounded to six
minutes, with template readiness limited to 180 seconds; no creation was retried.

Actual CLI invocations and sanitized results:

- `deploy PROJECT --name NAME --plan`: exit 0, status preview.
- `deploy PROJECT --name NAME --build-timeout 180 --yes`: exit 0, status ready.
- `status NAME`: exit 0, status ready; returned native ID matched the saved identity.
- `delete NAME --yes` in finally: exit 0, status deleted.
- An independent native GetTemplate for that exact ID and Team returned supported
  typed NotFound after deletion. No owned identity remained unresolved.

The complete sequence took 138 seconds. Exactly one owned Template was created;
zero Sandbox instances, images, volumes, FC functions, roles or databases were
created. No shared source image was modified or deleted. This proves this static
image-backed Express lifecycle only, not native Steps, FC, instance creation,
Agents API startup, model execution or the catalog migration.

## Final local test and repository checks

The non-overlapping final full local run had 4703 passed, 61 skipped and 11 failed
(221 files passed, four failed and five skipped). The failures were HTTP/WS/loopback
transport fixtures on this host, including MCP 202/307 behavior, refused local TCP,
TLS paths, malformed transport and proxy cases. They remain failures in that run;
the later remote Node 20 unit step independently reported 4779 passed and seven
skipped, with all unit files passing. Parity is a separate subsequent check.

Repository health after required ADR headings and the Node example correction:
PASS 105, WARN 11, FAIL 0. Hygiene passed. The native example now uses Node and a
hello.mjs source so it remains valid in this TypeScript-owned repository. No test
result is promoted to a published-package claim.

## Native FC component check and publication/readiness distinction

The 3e7258c candidate then ran one bounded FC check. Read-only inspection found an
existing execution role. The official fc3 0.1.26 archive's publish.yaml and source
were inspected: explicit role and omitted auto dependencies do not create a role,
SLS project/logstore, VPC/NAS or OSS bucket; a tiny local code directory uses inline
ZIP upload. Component removal does not remove the borrowed execution role.

The private project declared one unique nodejs20 function with that existing role,
CPU 0.35, memory 512, disk 512, timeout 10 and internetAccess false, with no HTTP
trigger, domain, image, mount, database or Sandbox. Preview succeeded. Deployment
returned E7000 after the native function identity was saved. The normal CLI delete
succeeded, followed by independent exact GetFunction typed absence. The complete
sequence took 12 seconds, creating and deleting one function and no other declared
resources. Native Invoke was not reached; no business execution success is claimed.

The probe retained phase codes but discarded the exact deployment error message.
Private state and component cache contained no recoverable stderr/log file. The
original cause is therefore unproved. No second function was created to repair the
probe's evidence capture.

A separate read-only investigation sampled existing GetFunction responses: two
custom code runtime functions omitted state and lastUpdateStatus; eight container
functions reported Active/Successful. Omissions persisted with and without the
LATEST qualifier. With temporary borrowed observation records, the candidate's
actual describeFunction/observeResourceProject path returned unknown for the
custom.debian12 function and ready for custom-container. Those temporary records
were removed and the existing functions were not changed or invoked. Official SDK
field documentation describes Successful after creation, while the pinned fc3
implementation only performs readiness polling for custom-container/micro-sandbox.
The observed omission must not be rewritten as Active/Successful.

Root and API reviewers independently approved distinguishing completed publication
from runtime readiness. After a successful native component call and a verified
owned function identity, omitted optional readiness fields record deployed, with
current readiness still unknown. Known failure, inactive/unrecognized states,
pending deadlines, authentication errors, component timeouts and ownership mismatch
cannot become deployed. A new function must carry the reserved ownership tag;
an existing function must retain its exact native identity. Template readiness is
unchanged. A ready template remains selectable in a mixed project whose Serving
readiness is unknown.

Focused public/resource/catalog regressions: 56 passed, including CLI deploy/status/
delete, missing-state shapes, pending/failed states, mismatched tags, post-update
replacement, inspection 401/403/503, uncertain-component no-replay and ready-template
selection. Typecheck passed. This correction is supported by the independently
observed existing-runtime omission; it is not asserted as the cause of the earlier
nodejs20 failure.

## Final CI and installed artifact corrections

[CI 45598619751](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45598619751)
at 3e7258c passed Node 20 and Node 22 unit and parity checks, plus actual Docker on
Node 22. The newly reached package job failed an obsolete assertion forbidding root
create. The artifact checker was corrected to require explicit create and retain
rejection of retired wrappers. Its next actual installed-npm execution exposed the
old assumption that pure build must request cloud credentials. That assertion now
runs a Steps-only specVersion 1 project and requires no_local_build with no Docker,
credentials or hook execution, in both JSON and CI modes. Actual image construction
remains covered by the independent Docker test. The corrected checker passed against
a locally packed and freshly installed npm artifact. This is private artifact
validation, not a package publication. The complete final-head CI remains separate.

The ownership-tag prerequisite was separately checked read-only: two existing
functions with tags returned their full lowercase key/value tag arrays from native
GetFunction, matching ListFunctions. No tag values or resource IDs were retained in
this record. The new-function guard can therefore compare actual returned ownership
metadata instead of depending only on test doubles.

Pure build's no-op --yes/-y options were removed. Current guides, scripts, help and
artifact consumers were updated; deployment/create/delete confirmations remain.
A reachable generation-update suggestion now directs publication to deploy rather
than implying that local build publishes a template. Five focused suites passed
187 tests after these changes, including the real CLI help snapshots. Provider SDK
management flags with their own cloud behavior were retained.

## Post-correction native FC publication check

At 1ae2d5229e539bbb6e6781c46a4dfb0fc972b00a, the independently reviewed readiness
change was tested with one new, uniquely named function under the same bounded
plan. This was a regression check of the corrected implementation, not a repeat
creation to recover the earlier missing error. No other cloud resources were
created. The existing execution role remained borrowed.

The actual CLI preview succeeded. Deploy exited 0 with recorded status deployed;
status exited 0 with observed status unknown. Native GetFunction omitted state and
lastUpdateStatus, and confirmed the exact function identity and ownership tag.
These results agree with the publication/readiness distinction; they do not assert
Active/Successful or an available business endpoint.

The first native Invoke probe used a string stream chunk where the official SDK
required bytes and failed locally before a response. The probe was corrected to
use a Buffer and reused the same owned function. That invocation also failed; the
retained probe result identifies NATIVE_INVOKE_FAILURE but does not retain a usable
native response or establish its cause. No nonce response or business-code success
is claimed, and no third function was created.

The normal CLI delete exited 0 with status deleted and one JSON result. An
independent exact GetFunction returned supported typed absence. Cleanup reported
no unresolved owned identity. Both FC checks and the earlier static Template check
have confirmed cleanup. Private source/configuration, role references, state and
component-cache copies were removed after retaining sanitized summaries.

The latest private npm artifact was packed and freshly installed, then passed the
installed-artifact checker, including authentication-menu cancellation and isolated
command guidance. Its npm shasum was 4375b5df2dafd90d6e0240a29bcd5c422a5c9fb2. This
is an artifact built from candidate source; it is not a public release. Complete
CI for the final reconciled candidate remains required.

## Named dynamic creation from borrowed resource templates

At 4b67161e735c7c1ddda7a711222865791fb3e195, after merging current main without
changing the frozen alpha.2 release, a private resource project declared two logical
references to one existing Ready Express template. A local service fixture first
confirmed that this structure creates two borrowed records without cloud writes.
The actual CLI then deployed those references without creating templates or images.

Create without --resource exited 2 and listed both choices. One explicit selection
created a uniquely named Sandbox with a 120-second lifetime, returning running.
The returned Sandbox ID matched the saved identity. Named status and an independent
SDK control-plane Get for that exact ID both confirmed the live instance. The
optional comparison between create's returned template metadata and the selected
native template ID was false; that response value was not retained, so this run
does not establish template provenance from returned metadata. The selected ID
mapping is separately covered by local contract tests; the two claims remain
distinct.

Finally, normal CLI delete returned deleted. Independent exact Get raised the
typed SandboxNotFound error. Deleting the borrowed resource project succeeded, and
an independent native template query still returned the original Ready template.
The sequence took 11 seconds and made exactly one Sandbox create attempt, with
zero new templates, images, volumes, functions, roles or databases. No application
startup, OpenAPI binding or model execution was attempted. Private source, config
and deployment state were removed after retaining a sanitized summary.

The final independent API review of 4b67161 approved the narrowed publication,
ownership and artifact-checker merge. It explicitly retained the business Invoke
and native application bootstrap limitations; no native changes entered the
already frozen alpha.2 tag.

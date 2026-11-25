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

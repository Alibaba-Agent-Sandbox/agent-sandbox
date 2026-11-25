# Native resource workflow verification — 2026-11-25

Result: PARTIAL. Local tests are separate from real Docker, cloud resources and
the full catalog/runtime migration. No cloud resource was created for these tests.

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
configuration-path isolation/progress changes still require a new CI result.

## Boundaries

No real native FC/Express deployment, OpenSandbox native resource adapter, model
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

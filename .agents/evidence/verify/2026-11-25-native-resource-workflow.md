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

## Added real test, not yet executed here

`e2e/local-resource-build.mjs` invokes the built CLI and actual Docker with FROM
scratch and one unique local file, then inspects the image and verifies cache reuse.
It has no registry/network base-image dependency and cleans only its returned image.
The existing CI test job runs it on Node 22. This authored test is not evidence of
a successful image build until its job completes.

## Boundaries

No real native FC/Express deployment, OpenSandbox native resource adapter, model
task, Agents API bootstrap, generated token injection, OpenAPI auto-binding, full
registry migration or published package is certified by this candidate. Source v5
startup remains supported explicitly while v1 create is application-empty. Current
guides describe the two formats rather than promising a service from static deploy.

Final integration/CI and subsequent review evidence will be appended separately.

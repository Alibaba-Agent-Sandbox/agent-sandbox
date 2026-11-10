# Template authoring verification — 2026-11-10

Result: PARTIAL — scoped local checks pass; cross-project final gates and cloud
Sandbox deployment are recorded separately. No package version was changed.
Coordination: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/244.

## Executed checks

- Vitest selected 13 template/source/adopt/Provider-launch/model-generation files:
  275 passed. Includes all retained shared launch resource ownership, error privacy,
  interruption and cleanup assertions; legacy UI tests now call the retained service
  or Provider adapter through test-only command harnesses.
- Authoring + natural-language init after shared build-lock cleanup regression:
  54 passed. Includes actual held-lock rejection with zero cleanup calls.
- Earlier authoring/MCP focused selection: 34 passed. Existing local MCP lifecycle,
  authentication and configuration tests remain; only the FC generator entry retired.
- Actual temporary Git repository and bare remote: publish creates a tag at HEAD;
  changed HEAD cannot replace the same remote version. No GitHub write was made by
  this test; git URL rewriting maps the logical GitHub remote to the local bare repo.
- Generated MCP project installed its requirements in a clean Python3.11.15 venv
  from public PyPI (client/server0.4.0a6). Real uvicorn HTTP passed health, absent-token
  401, initialize, tools/list (15 tools), unsupported GET405 and session DELETE200.
  Only placeholder authentication was used; no cloud operation was performed.
- Scoped ESLint: no errors; existing any-type warnings remain in test helpers and
  existing MCP helpers. Newly unused imports from retired tests were removed.
- Typecheck observed unrelated concurrent edits during integration; the final
  repository-wide check is owned by the coordinating change and is not claimed here.

## Corrections and limits

Initial old-suite failures referenced removed install/scaffold/create/launch routes.
Independent archive, source, token retry, permissions, startup and Provider-native
behavior was retained under the actual source/service entry. Old automatic generation
followed by deployment assertions were retired because that product flow was removed.
One new source test expected an adoption hint, but the earlier source resolver
correctly rejects a missing template.yaml/Dockerfile; the assertion now checks that
actual validation and source preservation. The MCP smoke driver initially raced
server startup and was corrected to retry startup connection disconnects only.

A subsequent review found generated docs used an intermediate app info/invoke/remove
proposal. They now use actual registered root status/delete and sandbox command run;
managed application business APIs remain HTTP. The shared cleanup lock was added after
cross-checking the root deployment consumer path, with an explicit contention test.

Temporary local Python/HTTP processes were stopped. Git and source fixtures are owned
temporary test directories. No cloud resources, publication or maturity promotion are
claimed by these checks. Required final CI, exact integrated source checks and any
cloud acceptance must be read from the coordinating evidence, not inferred here.

## Snapshot permission follow-up

Independent review identified that forcing copied files to0600 breaks root-owned
Docker COPY inputs when the service runs as another user. The private outer snapshot
remains0700; internal files/directories preserve source permission bits with special
bits removed. A real local different-UID probe tested Python commands.py and MCP
app.py as root-owned copied files: nobody can read the original0644 modes and receives
PermissionError for the former0600 behavior. Docker is unavailable here, so this is
an OS-permission reproduction, not a Docker image acceptance claim. The initial
probe used this host’s restrictive umask077; fixture modes were explicitly restored
to0644 and the corrected probe passed both controls. Temporary root-owned fixtures
were removed.

The final source typecheck (`npm run typecheck`) passes. Updated model suggestions,
setup-to-deploy delegation, codegen/error oracle and shared launch checks passed
453/455 on the first postreview selection; the remaining generated-comment fixture
and umask-dependent mode assertion were corrected, then their two files passed
33/33. The failed assertions and fixes concern the deliberate command rename and
source-mode preservation, not relaxed runtime behavior.

## Final command and guide migration

- Current English/Chinese guides now use template list/info/init/build/publish, root named deployments and sandbox command/exec/file operations. Consolidated duplicate beginner/template tutorials, retaining configuration audiences, ownership cleanup and the separation of source acquisition from deployment. Fixed-release installation examples are labeled as historical version examples; no new release is claimed.
- Changed Markdown local-file link audit: 73 CLI files at the audit checkpoint, no introduced missing targets. This checks files, not URL anchors or remote HTTP availability.
- Final assigned regression group: 6 files, 76 tests passed. Natural-language backend tests now exercise template init and verify zero deployment calls. Platform-step and adopt-registration tests retain real native adapter behavior through a test-only harness, without publishing a compatibility CLI alias.
- Real POSIX PTY acceptance: 8 assertions passed for source initialization, overwrite decline/confirmation, masked input Ctrl-C, configuration persistence and automatic application token, deployment decline/Ctrl-C before resource intents, and JSON/CI/quiet/piped automation. No cloud requests or real credentials.
- Independent real-launcher build identity mismatch probe: deployment rejects before side effects, delete succeeds and removes the borrowed build consumer. The root lifecycle implementation now records explicit pre-effect state and initializes an empty durable journal before handing off resource work; missing old state is not treated as safe.

## Parity and final boundary review

- Migrated the separately run offline natural-language integration suite: 12 tests passed, including real generated workspace validation and rejection of the removed root/subgroup aliases. Only the coding-agent subprocess is stubbed; no model or cloud call.
- Removed the unreachable Express deploy command object and its loadDeploy/createParams/deployHelp metadata after independent consumer review; retained the native do_deploy build service and adapter tests.
- Missing local source now produces controlled usage guidance with no build call or destination directory. Resource Journal cancellation assertions inspect the durable empty entries instead of assuming no file exists.
- The historical parity ledger stays immutable; explicit replacement mappings describe the retired install/generate/deploy contracts and name current observable regressions. Final merged parity and full CLI verification belong to the coordinating record.

- Final boundary selection after registry-type validation and dead deploy removal: 46 passed (4 files); scoped ESLint and TypeScript typecheck passed. Unknown registry types fail before I/O; Dockerfile-only source remains an explicit adoption path.
- Earlier final hygiene passed. A subsequent run found only the temporary parity/.vitest-report.json containing absolute test execution paths; the coordinator must remove that generated report before the final repository hygiene gate. No allowlist broadening was made.

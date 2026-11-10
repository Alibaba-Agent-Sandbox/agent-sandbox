# abx black-box E2E suite

Run `ABX_BIN=<candidate> node e2e/managed-api-key.mjs` with AK/SK and the Express API URL/domain to verify fresh-home consent denial, explicit key-provisioning consent (`--yes`; `--ci` alone never authorizes it), private cross-process reuse, real sandbox execution and confirmed renewal. This creates one owned key and one sandbox; cleanup disables/deletes the key and verifies both resources are absent. The test identity additionally needs `sandbox:DeleteApiKey` for cleanup. See [permissions](../docs/en/guide/permissions.md).

Run `ABX_BIN=<binary> node e2e/template-build-failure.mjs` with local Docker access to verify a real failing Docker instruction, typed E7020, safe diagnostics and the absence of remote submissions. It uses placeholder credentials and creates no cloud resources.


Run `ABX_BIN=<binary> node e2e/initialized-template.mjs --application` to test automatic application authentication and saved-token reuse against an existing `python-hello` template (override its ID with `ABX_ONBOARDING_APPLICATION_TEMPLATE`). This mode starts the template service, invokes an authenticated business command and independently deletes its owned sandbox. Add `--guided-application` instead to enter a hidden Sandbox API key first, verify default persistence without scope menus, and reuse saved platform/application credentials from another process.

Run `ABX_BIN=<binary> node e2e/initialized-template.mjs` for a fresh-home run of `deploy --name guided-init` using a local managed-base source. It checks billable-deploy confirmation, missing-key guidance, real Express creation, remote execution and independent HTTP 404 cleanup. It verifies masked input and a generated saved application token. Requires the same credentials and terminal support as guided configuration.

A language-neutral, black-box end-to-end suite for the `abx` CLI. It spawns the binary under test
exactly like a user would (argv, environment, stdin, exit code, stdout/stderr, files on disk) against
the **real cloud**. Point `ABX_BIN` at the `abx` binary you want to test.

> 中文说明见 [README.zh-CN.md](README.zh-CN.md).

## Protocol lifecycle verification

Run `ABX_BIN=<standalone-executable> npm run e2e:standard` with E2B_API_KEY and
E2B_API_URL/E2B_DOMAIN in the environment or ignored .env. This focused suite uses
the real Express backend and a real local PTY (Linux/macOS, Python 3 required).
It verifies named deploy, stdout and nonzero remote exits, a persistent shell through
`sandbox connect`, borrowed Sandbox survival after disconnect, and explicit delete
with an independent HTTP 404 check. It does not test removed create/auto-attach or
terminal-exit lease rewrites. Errors are masked before reporting.

Run `ABX_BIN=<standalone-executable> node e2e/guided-configuration.mjs` to verify
ordinary deploy through a real terminal, missing-key guidance, hidden credential
input, persistence within the isolated home, creation and remote execution. Supply a Sandbox API key and an
explicit API URL/domain in the environment. The test removes the key from the
child environment before entering it through the prompt, uses an isolated home,
and kills its owned sandbox with an independent HTTP 404 cleanup check. Requires
Linux/macOS and Python 3. It creates one real sandbox.

Run `ABX_BIN=<standalone-executable> node e2e/guided-template-steps.mjs` after building
the CLI to verify real platform RUN steps without ACR configuration, a Sandbox API
key in the deploy process, or local Docker tools. Supply AccessKeys and a Sandbox
API key/endpoint through the environment. The test reads the existing public
`code-interpreter-v1` source and preserves its image, resources and runtime commands.
Platform RUN steps require generation 2. If that source is generation 1, the test
reports `BLOCKED` before any cloud write; select an already verified public generation-2
source with `ABX_GUIDED_STEPS_SOURCE_TEMPLATE_ID` to run the full test. Sources
requiring private registry configuration are refused. Before publishing, it creates
and executes a sandbox from the existing source and confirms its deletion. It then
creates one unique template and another sandbox, checks a build marker, and verifies deletion through
independent HTTP 404 requests and final template inventory absence. `--inspect`
performs only the source reads. `ABX_GUIDED_STEPS_SOURCE_TEMPLATE_ID` may select
another already verified, ready public generation-2 source meeting the same constraints.
Submission is never replayed. If cleanup cannot be confirmed, the test fails and
retains a mode-0600 temporary recovery file containing only owned resource references;
credentials are never written to that file.

The runner uses the current unified source CLI: deploy and named lifecycle commands,
with runtime operations under sandbox. Exec options precede the Sandbox ID; an
explicit `--` separates the remote argv. The command walk checks every help node
and safe local invocation. Template init creates source; template build prepares a
reusable artifact. A focused pass does not certify the full CI matrix.

## Whole-template startup

After building the candidate CLI, run `ABX_BIN="node $PWD/dist/bin/abx.js" node e2e/unified-template-launch.mjs` with Sandbox credentials and Alibaba Cloud AccessKeys in the environment. The test launches a spec v5 managed `base` template, then prepares a native-steps source using the pinned official base image, starts two HTTP services, checks readiness, verifies both returned endpoints and executes a build marker check. It deletes only its journaled sandboxes/templates and confirms their absence. `--managed-only` omits the source preparation case. This is focused Express evidence, not the full Docker/OpenSandbox catalog matrix. Do not rebuild `dist/` concurrently with a running binary test.

## Quick start

```bash
# 1. credentials: environment variables or the gitignored cli/.env (never committed, never printed)
#    E2B_API_KEY, E2B_API_URL, E2B_DOMAIN, ALICLOUD_ACCESS_KEY_ID/ALICLOUD_ACCESS_KEY_SECRET, ACR_NAMESPACE, ABX_LLM_API_KEY, ABX_LLM_BASE_URL
cp .env.example .env   # then fill in real values

# 2. run against the abx binary
ABX_BIN=abx                           npm run e2e          # `abx` on PATH (default)
ABX_BIN="node $PWD/dist/bin/abx.js"   npm run e2e          # after `npm run build`

node e2e/mcp-lifecycle.mjs             # built CLI STDIO lifecycle; credentials in env, owned cleanup

npm run e2e:offline                   # only the no-credential suite (seconds)
node e2e/run.mjs --suite cloud-lifecycle --filter 'exec|files'
node e2e/run.mjs --list               # all suites and scenarios
node e2e/run.mjs --json out.json --markdown out.md   # machine/markdown reports (secrets masked)
npm run e2e:cleanup                   # dry-run janitor for sandboxes leaked by an interrupted run
```

Requires Node >= 20. No dependencies are installed by the suite itself.

## Guarantees

| Concern | How it is handled |
|---|---|
| Isolation | Fresh `HOME` (and cwd) per suite/scenario under the OS temp dir, `XDG_CONFIG_HOME` inside it; nothing is read from or written to the real home or the repo. Only `PATH`, locale and proxy/CA variables are inherited. |
| CI auto-mode | `CI`, `GITHUB_ACTIONS`, ... are not forwarded, so the CLI does not silently switch to `--json/--quiet`. A scenario that wants it sets `CI=true` explicitly. |
| Secrets | Loaded from env / `cli/.env`; passed to the child only. Every captured byte is masked (`<SECRET>`, `<HOST>`, `<DOMAIN>`, partially masked `abc***xyz` forms) before it is stored, printed or compared. Reports contain no credential. |
| Cleanup | Every sandbox the run creates is tracked; it is killed in `finally`/signal handlers and recorded in `e2e/.state/run-<id>.json` until confirmed gone. A final built-in `leak-check` scenario lists the account and fails if any tracked sandbox is still there. account-wide deletion is never used by default. |
| Determinism | Outputs are normalised (sandbox ids, timestamps, durations, container ids, temp paths, uptime). Order-insensitive matchers where the platform does not guarantee order. Retries only for known-eventual operations, declared per scenario (`retries`, `ctx.eventually`) and reported when they were needed. |
| Skips | A suite/scenario that cannot run is reported as `SKIP` with the exact reason (missing credentials, GitHub index unreachable, Docker opt-in, ...), never silently green. |

## Cloud command contracts

`cloud-readonly` and `cloud-lifecycle` use `deploy --template-id`, root
`list/status/delete`, and `sandbox exec`/files/process/application commands. JSON
inventory is `{items, partial, errors}`; deployment results include `name` and
`sandbox_id`. Native template CRUD uses `provider run template.list/get/create/delete`
with JSON input. Those operations require existing cloud AccessKeys; a Sandbox API
key is a different credential. The test setup explicitly maps legacy E2B variables
to canonical ABX names and preserves negative credential overrides.

Create mutations are never replayed. The runner saves an unresolved attempt before
submission, tracks any returned ID immediately, and resolves an ID-free attempt only
on a definitive rejection. Cleanup requires complete inventory plus exact-ID typed
NotFound; a delete acknowledgement is insufficient. Uncertain attempts and resources
retain both the ledger and private workspace so named deployment recovery remains
possible. Docker preparation uses template build and named deploy; it retains failed
build artifacts until native template absence and artifact cleanup are confirmed.
Without Docker that suite is skipped with its reason, never counted as passed.

Select an already deployed `python-hello` template implementing application protocol v2
and the documented `hello` command for the named-command check. Without `ABX_E2E_APP_START_COMMAND`, the suite requires that service to be running already.
For a selected `startup: exec` workflow on a bare managed sandbox, supply the exact reviewed
manifest start command. For the current python-hello manifest this is:

```bash
ABX_E2E_APP_START_COMMAND="agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py" \
  ABX_BIN=abx node e2e/run.mjs --suite cloud-readonly,cloud-lifecycle
```

If the selected managed image does not contain the reviewed application source, explicitly
set both `ABX_E2E_APP_UPLOAD_SOURCE` and `ABX_E2E_APP_UPLOAD_DEST` together with that startup
command. For example, after setting `PYTHON_HELLO_SOURCE` to the reviewed
[python-hello source directory](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/tree/main/python-hello):

```bash
ABX_E2E_APP_UPLOAD_SOURCE="$PYTHON_HELLO_SOURCE/commands.py" \
ABX_E2E_APP_UPLOAD_DEST="/home/user/app/commands.py" \
ABX_E2E_APP_START_COMMAND="agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py" \
  ABX_BIN=abx node e2e/run.mjs --suite cloud-readonly,cloud-lifecycle
```

The paired source/destination and startup command are validated before application mutation.
The fixture is uploaded once into the owned sandbox; upload failure prevents startup. Record
the selected source revision and byte hash in the run evidence. This mode verifies a managed
sandbox plus an uploaded current application fixture and its CLI bridge. It does not certify
that the original image preinstalls that fixture or that Express source-image builds work.

Startup runs once and must return a real, visible process ID before the protocol-v2 command
catalog and payloads are admitted. No script paths, alternate commands, protocol fallbacks or
restart retries are guessed. A missing or incompatible deployed application fails this check. Process signalling
uses only a process created by the run and validates every process-list ID before verifying
disappearance. Discovery may declare no coarse groups even when real exec/file checks pass;
no shell/files baseline is inferred. Metrics and pip package checks use their current structured
JSON contracts. Native template info uses an actual ID from the same-account native inventory;
its current official missing-template errors are checked as E5000 plus exact API/404 diagnostics. Interactive
create/connect remain covered by `e2e/standard.mjs` with a real local PTY.

## Suites

| Suite | Needs | Content |
|---|---|---|
| `offline` | nothing | `--version`, `--help` of every command group, usage errors (exit 2), missing credentials (exit 3, `E1001`), `config get/set/list/delete/init`, the fixed top-level surface (removed spellings exit 2), MCP `install/status/stop` into a temp HOME, `template init`, local `template search --index-url` |
| `standard-contract` | cloud + Python 3/local PTY | Named deployment, remote exit status, real PTY/connect ownership and explicit deletion |
| `cloud-readonly` | cloud | unified authentication/listing and typed error envelopes, official template ID readback and precise missing-resource diagnostics, secret masking of `config list` |
| `cloud-lifecycle` | cloud | named `deploy` -> `list` -> `status` -> `sandbox exec` (exit-code propagation, `--cwd`, JSON/quiet/CI output and supported command deadlines) -> `sandbox upload`/`sandbox download` (binary round-trip) -> background/streaming/command env -> `sandbox files/process/system/capabilities` -> `sandbox command list` / `sandbox run` named commands -> env/upload at create -> `delete` |
| `catalog` | outbound GitHub | `template search` and `template init --from` against the remote index |
| `docker-deploy` | cloud + Docker, opt-in | `template init` -> `template build` (docker build, ACR push, CreateTemplate) -> `deploy` -> `sandbox exec` -> `template build --clean` |

## Scenario format

Scenarios are plain objects in `scenarios/*.mjs` (table style). Common fields:

```js
{ id: 'exec-exit-code-propagates', title: '...', requires: ['create-json'],   // skipped unless that scenario passed
  argv: (ctx) => ['exec', ctx.state.id, 'echo out; exit 3'],                   // or a plain array
  env: { CI: 'true' }, stdin: 'n\n', creds: false, freshHome: true,
  exit: 3,                                                                     // number | [numbers] | 'nonzero'
  stdout: ['text', /regex/, { not: 'forbidden' }], stderr: [...], output: [...],   // stdout+stderr
  jsonShape: { ID: 'string', Status: 'string' }, json: (j, ctx, res) => {...},     // JSON assertions
  retries: 1, retryReason: 'cold start', timeoutMs: 180000, needs: ['docker'] }
```

Multi-step scenarios use `run(ctx)` with `ctx.abx(argv, opts)` (masked + normalised result),
`ctx.rawAbx` (masked only, for checks that must see real bytes), `ctx.track(id)`/`ctx.untrack(id)`
(register sandboxes for cleanup), `ctx.eventually(fn)`, `ctx.fail(msg)`.

## Provider tiers

Every provider, including OpenSandbox, is tested in the same six tiers (T0 plugin unit tests through T5 the real Alibaba Cloud platform). The table, the rules, and the commands are in [providers/PLAN.md](providers/PLAN.md) ([中文](providers/PLAN.zh-CN.md)).

## Provider plugins (`e2e/providers/run.sh`)

A bash script that installs the reference plugins into a throwaway `HOME` and drives
real sandboxes through the CLI: `npm run e2e:providers` or `e2e/providers/run.sh [offline|catalog|local-process|opensandbox|e2b-compatible]`.
`local-process` (an `sandbox exec` plugin, Python) and `e2b-compatible` (a `rest` manifest) come from `python-sdk/examples/providers`. `opensandbox` is a catalog `node` plugin (`provider.mjs`, `create(kit)`), cloned from
[awesome-providers](https://github.com/alibaba-agent-sandbox/awesome-providers) (`opensandbox/`). The other catalog ids (`e2b`, `cubesandbox`, `alicloud-container`) are `node` plugins in that same tree. The `catalog` target installs `awesome-providers//opensandbox`.

| Target | Needs | What it checks |
|---|---|---|
| `offline` | nothing (git, python3) | hidden-until-used `provider` group, consent and `--yes` rules (`E8012`), install from a path and from a local git repo pinned to a commit, `E8003` conflict and `--force`, `doctor`/`status`, `E8001`, `E8002` (secret on the command line), `provider default`, `E8030`, tamper detection (`E8011`), uninstall |
| `local-process` | python3 | `deploy`, `list`, `sandbox exec` (exit-code propagation), `sandbox upload`/`sandbox download` round trip, `sandbox files list`, `delete`, E4 after kill, all with qualified ids |
| `opensandbox` | a live OpenSandbox: `python-sdk/e2e/opensandbox/local-up.sh` (Docker; key `local-dev-key`, `127.0.0.1:8080`) | install by path and by git, `doctor`, `provider default opensandbox`, the full sandbox round trip with and without `--provider`, secret masking, and `abx provider test` (the contract suite) |
| `e2b-compatible` | `E2B_API_KEY` (+ `E2B_API_URL`, `E2B_DOMAIN`) in the environment | the REST plugin inheriting the generic `sandbox_*` keys runs the same round trip on the live cloud; without the key it is reported as `SKIP` |

Variables: `ABX_BIN` (binary under test, default `tsx src/bin/abx.ts` in a checkout), `PROVIDERS_DIR` (local-process and e2b-compatible only), `OSB_SRC` or `ABX_OPENSANDBOX_PLUGIN` or `ABX_AWESOME_PROVIDERS` (opensandbox checkout; otherwise the script clones the catalog), `OSB_URL`, `OSB_KEY`, `OSB_IMAGE`.
The script scrubs the child environment, never prints credentials, kills every sandbox it created on exit, and exits non-zero on any failed step.

## Environment variables

Provider management checks are available as `--suite provider-commands-offline,provider-management-cloud`.
The first suite needs no credentials; the second uses AK/SK for four read-only FC APIs. No resources are created.
For the isolated API-key lifecycle, select `--suite provider-management-lifecycle --filter existing-team-api-key-lifecycle`
and set `ABX_E2E_PROVIDER_MANAGEMENT_WRITE=1` plus `ABX_E2E_MANAGEMENT_EXISTING_TEAM_ID`.
Only a new randomly named test key is updated, rotated, deactivated and deleted; the existing Team is never changed.
Key values are checked in temporary mode-0600 files and never printed. Team/Volume/quota write scenarios require
the explicit plan/resource-group and additional opt-ins documented in the scenario source; missing prerequisites
are reported as skips. No subscription plan, existing storage or Volume state transition is guessed.

Actual mount acceptance is separate: run `--suite volume-mount-cloud` with
`ABX_E2E_VOLUME_MOUNT=1`, `ABX_E2E_VOLUME_NAME` naming an existing writable test Volume,
and `ABX_E2E_VOLUME_MOUNT_PATH` set to a dedicated normalized path below `/mnt/abx-e2e/`.
The configured sandbox API key must belong to that Volume's Team, with a valid storage role.
Set `ABX_E2E_TEMPLATE` explicitly to a mount-capable template. Custom MicroVM source images
must include ossfs2 2.0.10 or newer; see the [official mount guide](https://help.aliyun.com/zh/agent-sandbox/mount-oss-volume-1).
The scenario verifies the exact mount in `/proc/self/mountinfo` before exclusive sentinel-file
write/read/delete, then destroys only its own sandbox. It never deletes the existing Volume
or storage. Missing prerequisites produce a skip, not proof that mounting works.

When test infrastructure creation is explicitly authorized, a temporary private Bucket, a
dedicated FC-trusted RAM role with access limited to that Bucket, a same-Team test API key and
Volume can supply these prerequisites. After sandbox cleanup, deactivate/delete the test key,
delete the Volume, empty/delete the test Bucket, detach/delete the custom policy and delete
the test role. Verify each resource is absent. Resource creation is separate from this runner;
the mount scenario does not provision storage or delete an existing Volume.

| Variable | Meaning |
|---|---|
| `ABX_BIN` | Binary under test (default `abx`); may contain arguments, e.g. `"node $PWD/dist/bin/abx.js"`; script paths must be absolute for isolated scenario directories |
| `ABX_E2E_TEMPLATE` | Template for the lifecycle suite (default `python-hello`) |
| `ABX_E2E_TEMPLATE_ID` | Optional actual native TemplateID, required to exist in the selected account inventory for official info readback |
| `ABX_E2E_APP_UPLOAD_SOURCE` / `ABX_E2E_APP_UPLOAD_DEST` | Optional paired reviewed local fixture and explicit remote destination; require an explicit start command, upload once before startup |
| `ABX_E2E_APP_START_COMMAND` | Optional exact selected manifest startup command; runs once with a real PID check, otherwise the application must already be serving |
| `ABX_E2E_TIMEOUT_MS` | Default per-command timeout (default 120000) |
| `ABX_E2E_DOCKER=1` | Enable the Docker/ACR suite (slow, costs real resources) |
| `ABX_E2E_KEEP=1` | Keep the temp workdir for debugging (it may contain command output, never credentials) |

## Results and baseline

[`BASELINE.md`](BASELINE.md) records the pass/fail/flakiness of every scenario against the Python
oracle on the real cloud. When you port a command, run the suite against both binaries and compare
with the baseline; a scenario that passes for the oracle but fails for the port is a parity bug (or a
scenario that over-specifies, in which case fix the scenario in the same change).

The mock-vs-oracle differential harness lives in [`../parity/diff/`](../parity/diff/README.md).

Exit code of `run.mjs`: 0 = no failures (skips allowed), 1 = at least one failure, 2 = binary not runnable.

## Provider ownership without cloud prerequisites

`ABX_BIN=<built-executable> node e2e/provider-boundary.mjs` installs a local fixture into a temporary HOME and checks qualified references, conflicting/unknown/empty namespaces, remote provider flags and template/deploy refusal. It exercises the actual executable and filesystem, creates no cloud resource, and is not a real OpenSandbox deployment test.

## Express source workflow acceptance

After `npm ci && npm run build`, run `node e2e/express-workflow.mjs` on a host with
Docker running. Configure `ABX_SANDBOX_API_KEY`, `ABX_SANDBOX_BASE_URL`,
`ABX_SANDBOX_DOMAIN`, `ALICLOUD_ACCESS_KEY_ID`, `ALICLOUD_ACCESS_KEY_SECRET`,
`ALIBABA_CLOUD_REGION_ID` and `ACR_NAMESPACE` through the environment. The account
must be able to push to that ACR namespace and create/delete Express templates.
Set `ABX_WORKFLOW_REPORT` to a JSON output path; optionally set
`ABX_WORKFLOW_FULL_E2E=1` to run the broader CLI suite against the prepared template.

The test launches the Registry's unchanged `python-hello` source using its default
Dockerfile, checks the returned declared services, invokes its HTTP command, exercises CLI file operations, and deletes
its owned sandbox/template with independent typed absence readback. It creates billable resources. ACR image receipts are
retained in `~/.abx/resource-journal/` for manual image cleanup; do not delete shared
repositories. The sanitized report distinguishes failure and cleanup status.

The opt-in Actions workflow uses encrypted `EXPRESS_ACCEPTANCE_*` repository
secrets (see its environment mapping) and requires `EXPRESS_ACCEPTANCE_ENABLED=true`.
Without that switch the cloud step is skipped; a green build alone is not cloud
acceptance. Only same-repository PRs and manual dispatches can use this job.

## MCP lifecycle resource expectations

After building, `node e2e/mcp-lifecycle.mjs` runs the real CLI STDIO server and checks ownership, independent metadata, lifetime changes, files and commands. Select a prepared template with `ABX_E2E_TEMPLATE`; set `ABX_E2E_CPU` and `ABX_E2E_MEMORY` to its expected actual resources (defaults: `base`, 2 CPU, 2048 MB). Both create arguments and a separate metadata response must match those expectations. Qualified IDs are used for operations; the fixture parses their raw ID for metadata/list comparisons.
## Managed application components

After `npm run build`, run `node e2e/managed-components.mjs all` with the selected Express deployment
credentials and ACR namespace. `ABX_APP_E2E_ACCESS_REF` selects an explicit Devs profile; default `abx`
uses configured AccessKeys. This creates one private FC test function and one tiny random-tagged Server
image, exercises the official component deploy/info/remove methods and confirms exact remote/local absence.
Shared ACR repositories remain. An uncertain result preserves a private recovery directory instead of
guessing ownership. This component check does not certify a full Gateway/PostgreSQL/Sandbox/model deployment.

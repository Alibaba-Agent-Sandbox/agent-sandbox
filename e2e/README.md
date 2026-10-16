# abx black-box E2E suite

A language-neutral, black-box end-to-end suite for the `abx` CLI. It spawns the binary under test
exactly like a user would (argv, environment, stdin, exit code, stdout/stderr, files on disk) against
the **real cloud**. Point `ABX_BIN` at the `abx` binary you want to test.

> 中文说明见 [README.zh-CN.md](README.zh-CN.md).

## Standard E2B migration contract

Run `ABX_BIN=<standalone-executable> npm run e2e:standard` with E2B_API_KEY and
E2B_API_URL/E2B_DOMAIN in the environment or ignored .env. This focused suite uses
the real Express backend and a real local PTY (Linux/macOS, Python 3 required).
It verifies detached and interactive create, stdout/remote exit status, template
JSON listing, persistent shell state, connect ownership, automatic expiry and
cleanup. It never invokes an installed E2B CLI. Platform minimum TTL may round the
one-second post-terminal request to about 60 seconds; the probe waits for that
known asynchronous reclamation. Errors are masked before reporting.

The normal runner includes standard-contract plus project extension scenarios. Old parser and terminal assumptions have been migrated: local exec options precede the ID, stdin is piped only when a scenario supplies it, cleanup uses standard kill/list, and the command walk understands standard aliases and embedded extension help. The runtime standard template init creates SDK files; project template.yaml workflows use template scaffold. A focused pass does not mean the full CI matrix passed.

## Quick start

```bash
# 1. credentials: environment variables or the gitignored cli/.env (never committed, never printed)
#    E2B_API_KEY, E2B_API_URL, E2B_DOMAIN, ALICLOUD_ACCESS_KEY_ID/ALICLOUD_ACCESS_KEY_SECRET, ACR_NAMESPACE, ABX_LLM_API_KEY, ABX_LLM_BASE_URL
cp .env.example .env   # then fill in real values

# 2. run against the abx binary
ABX_BIN=abx                           npm run e2e          # `abx` on PATH (default)
ABX_BIN="node dist/bin/abx.js"        npm run e2e          # after `npm run build`

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
| Cleanup | Every sandbox the run creates is tracked; it is killed in `finally`/signal handlers and recorded in `e2e/.state/run-<id>.json` until confirmed gone. A final built-in `leak-check` scenario lists the account and fails if any tracked sandbox is still there. `kill --all` is never used by default. |
| Determinism | Outputs are normalised (sandbox ids, timestamps, durations, container ids, temp paths, uptime). Order-insensitive matchers where the platform does not guarantee order. Retries only for known-eventual operations, declared per scenario (`retries`, `ctx.eventually`) and reported when they were needed. |
| Skips | A suite/scenario that cannot run is reported as `SKIP` with the exact reason (missing credentials, GitHub index unreachable, Docker opt-in, ...), never silently green. |

## Suites

| Suite | Needs | Content |
|---|---|---|
| `offline` | nothing | `--version`, `--help` of every command group, usage errors (exit 2), missing credentials (exit 3, `E1001`), `config get/set/list/delete/init`, the fixed top-level surface (removed spellings exit 2), MCP `install/status/stop` into a temp HOME, `template scaffold`, local `template search --index-url` |
| `standard-contract` | cloud + Python 3/local PTY | Fixed E2B lifecycle, remote status, real PTY/connect ownership, automatic expiry and cleanup |
| `cloud-readonly` | cloud | wrong API key (`E1000`, exit 3), `template list/info/delete` and not-found envelopes (exit 4, `E2001`/`E5000`), `list` shapes, secret masking of `config list` |
| `cloud-lifecycle` | cloud | `create` -> `list` -> `info` -> `exec` (exit-code propagation, `--cwd`, `--json`, `-q`, `--ci`, `CI=true`, timeout -> exit 5) -> `upload`/`download` (binary round-trip) -> `exec --background/--stream/--env` -> `sandbox files/process/system/capabilities` -> `connect` -> `sandbox command list` / `run` named commands -> env/upload at create -> `kill` |
| `catalog` | outbound GitHub | `template search` and `template install --download-only` against the remote index |
| `docker-deploy` | cloud + Docker, opt-in | `template scaffold` -> `template deploy` (docker build, ACR push, CreateTemplate) -> `create` -> `exec` -> `template delete` |

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
`local-process` (an `exec` plugin, Python) and `e2b-compatible` (a `rest` manifest) come from `python-sdk/examples/providers`. `opensandbox` is a catalog `node` plugin (`provider.mjs`, `create(kit)`), cloned from
[awesome-providers](https://github.com/alibaba-agent-sandbox/awesome-providers) (`opensandbox/`). The other catalog ids (`e2b`, `cubesandbox`, `alicloud-container`) are `node` plugins in that same tree. The `catalog` target installs `awesome-providers//opensandbox`.

| Target | Needs | What it checks |
|---|---|---|
| `offline` | nothing (git, python3) | hidden-until-used `provider` group, consent and `--yes` rules (`E8012`), install from a path and from a local git repo pinned to a commit, `E8003` conflict and `--force`, `doctor`/`info`, `E8001`, `E8002` (secret on the command line), `provider default`, `E8030`, tamper detection (`E8011`), uninstall |
| `local-process` | python3 | `create`, `list`, `exec` (exit-code propagation), `upload`/`download` round trip, `sandbox files list`, `kill`, E4 after kill, all with qualified ids |
| `opensandbox` | a live OpenSandbox: `python-sdk/e2e/opensandbox/local-up.sh` (Docker; key `local-dev-key`, `127.0.0.1:8080`) | install by path and by git, `doctor`, `provider default opensandbox`, the full sandbox round trip with and without `--provider`, secret masking, and `abx provider test` (the contract suite) |
| `e2b-compatible` | `E2B_API_KEY` (+ `E2B_API_URL`, `E2B_DOMAIN`) in the environment | the REST plugin inheriting the generic `sandbox_*` keys runs the same round trip on the live cloud; without the key it is reported as `SKIP` |

Variables: `ABX_BIN` (binary under test, default `tsx src/bin/abx.ts` in a checkout), `PROVIDERS_DIR` (local-process and e2b-compatible only), `OSB_SRC` or `ABX_OPENSANDBOX_PLUGIN` or `ABX_AWESOME_PROVIDERS` (opensandbox checkout; otherwise the script clones the catalog), `OSB_URL`, `OSB_KEY`, `OSB_IMAGE`.
The script scrubs the child environment, never prints credentials, kills every sandbox it created on exit, and exits non-zero on any failed step.

## Environment variables

| Variable | Meaning |
|---|---|
| `ABX_BIN` | Binary under test (default `abx`); may contain arguments, e.g. `"node dist/bin/abx.js"` |
| `ABX_E2E_TEMPLATE` | Template for the lifecycle suite (default `python-hello`) |
| `ABX_E2E_TIMEOUT_MS` | Default per-command timeout (default 120000) |
| `ABX_E2E_DOCKER=1` | Enable the Docker/ACR suite (slow, costs real resources) |
| `ABX_E2E_ALLOW_KILL_ALL=1` | Enable the `kill --all` confirmation guard scenario (dangerous on shared accounts) |
| `ABX_E2E_KEEP=1` | Keep the temp workdir for debugging (it may contain command output, never credentials) |

## Results and baseline

[`BASELINE.md`](BASELINE.md) records the pass/fail/flakiness of every scenario against the Python
oracle on the real cloud. When you port a command, run the suite against both binaries and compare
with the baseline; a scenario that passes for the oracle but fails for the port is a parity bug (or a
scenario that over-specifies, in which case fix the scenario in the same change).

The mock-vs-oracle differential harness lives in [`../parity/diff/`](../parity/diff/README.md).

Exit code of `run.mjs`: 0 = no failures (skips allowed), 1 = at least one failure, 2 = binary not runnable.

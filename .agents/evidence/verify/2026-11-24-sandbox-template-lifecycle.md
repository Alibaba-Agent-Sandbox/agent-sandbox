# Verification: Sandbox template preparation and instance creation

- Date: 2026-11-24
- Change: [Issue 260](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/260)
- Result: PARTIAL
- Binary / package under test: source CLI built from main baseline `57c7632` plus the scoped lifecycle change
- Environment: Linux, Node 22, real Express account and isolated local test homes. Credentials were supplied through existing private configuration.

## What was verified

Independent reviews covered reuse of a prepared build, the Registry and native
catalog paths, the actual envd request shape and downstream consumers. The final
source guards the artifact's frozen source during admission and skips restaging
a prepared image or template. A prepared artifact still starts and checks its
declared services.

## Commands run

- `npm ci`, `npm run build`, `make dist-check`, `npm run typecheck`, `npm run lint`
- `node scripts/check-release-artifact.mjs dist/bin/abx.js` (compiled executable with an isolated loopback)
- `bash scripts/check-repo-health.sh`, `npm run check:hygiene`, `git diff --check`
- Focused CLI, authoring, configuration, provider operations, ownership and live help regression suites via Vitest
- `ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence`
- `npm run e2e:offline`, `node e2e/run.mjs --suite all-commands`, `node e2e/onboarding.mjs`, `e2e/providers/run.sh local-process`
- `ABX_BIN=<compiled CLI> node e2e/run.mjs --suite cloud-readonly,cloud-lifecycle,catalog,docker-deploy`
- Focused `cloud-lifecycle` with the reviewed template's command file and exact startup command
- Real `template build DIR --out FILE`, two `create --build FILE` calls, observed ready file, two deletes, independent live list and `template build --clean FILE`

## Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Scoped lifecycle, flag and cleanup tests | PASS | Targeted parser, configuration, admission, artifact and native request tests passed. |
| Help and local command walk | PASS | 89 offline checks and 114 command help/safe usage probes passed. POSIX PTY and real local-process Provider ran independently. The compiled executable also passed package/entry-point guidance, no-key preflight and PTY cancellation. |
| Native Express SDK request | PASS | Omission and JSON false omit `buildConfig`. Explicit generation-1 injection sends copy and envd actions. Invalid combinations fail before the SDK request. |
| Real Express and catalog broad run | PARTIAL | 78 checks passed. The pre-existing native python-hello reference returned HTTP 502 for its application port. Docker checks were skipped. |
| Real caller-to-application rerun | PASS | Uploaded the [fixed python-hello command file](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/52f7653bda0b6c6406207e28095ee09a87cb5018/python-hello/commands.py), used its declared startup, ran hello and its argument/negative cases. Three checks passed, including the independent leak check. |
| Real reusable artifact | PASS | A local manifest borrowing the existing native python-hello reference yielded a ready artifact. Two distinct Sandboxes reused it and passed the declared startup/readiness check. The artifact's consumers were released and cleanup completed. |
| Complete suite and remote CI | PARTIAL | In an isolated network the full run reached 4,531 passes and 63 skips. Its one DNS error-text mismatch reproduced on the clean baseline. The subsequent frozen-source and artifact regressions passed. Required latest-head CI and review remain open. |

## Cleanup

The broad cloud run tracked two owned instances and the focused application run
tracked one. Their independent leak checks passed. The artifact test deleted
both instances and independently confirmed absence. It cleaned its build
journal and borrowed the existing native template. No cloud template, image or
FC function was created by the artifact test.

## Problems found

The initial application-port failure matches the previously documented native
image limitation. The explicit fixture exercise proved the actual command
transport without claiming that the native image serves the application by
default. The source cloud test runner still had a stale `sandbox run` invocation.
It now uses `sandbox command run`. Historical release instructions remain pinned.

## Not verified

This host does not provide Docker, so the opt-in real Docker/ACR preparation was
not run. Managed FC apply was not repeated for this command-surface change.
Registry, website and template catalog all provide current-source guidance and
require coordinated updates before the new commands become the public default.

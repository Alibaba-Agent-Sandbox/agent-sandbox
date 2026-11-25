# Verification: Guided configuration and template preparation diagnostics

- Date: 2026-11-25
- Change: [Issue 266](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/266)
- Result: PASS (real-component scope)
- Binary / package under test: current Node CLI built with `npm run build`, based on `57c7632`. Published control was npm 0.5.10.
- Environment: Linux, Node 22.22.2, isolated Docker 28.4.0 and Express in Hangzhou. Credential values are omitted.

## What was verified

Independent reviews inspected configuration layering, the Express build lifecycle and published/main
differences before the change. A second review tested real terminal behavior and challenged write-ahead
persistence, same-name retry, error boundaries and integration with [PR 261](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/261).

Published 0.5.10 with only ACR namespace missing returns generic E8002 and an unwritten journal.
A separate published-version terminal test saw two registry headings and billing consent before
a missing Docker diagnosis. These are concrete controls. The cause of the original report remains unknown.

## Commands run

- `npm ci`, `npm run typecheck`, `npm run build`, `make dist-check`
- `bash scripts/check-repo-health.sh`, `npm run check:hygiene`
- Focused Vitest coverage of config setup, deployment, Express guidance, launch and resource journals
- `ABX_BIN=<candidate> node e2e/onboarding.mjs`
- `ABX_BIN=<candidate> node e2e/guided-configuration.mjs`
- `ABX_BIN=<candidate> node e2e/template-build-failure.mjs`
- `node e2e/express-workflow.mjs`

## Results

| Scenario | Result | Notes |
| --- | --- | --- |
| Focused regressions | PASS | 128 tests across the five final focused files. |
| Real terminal configuration review | PASS | Five isolated cases covered project, process and Provider-scoped sources, model aliases, Enter semantics and incomplete setup. |
| Actual onboarding PTY suite | PASS | Eight groups, including cancellation, hidden input, no request on decline, and noninteractive output. |
| Actual guided Express deployment | PASS | Entered an existing key through a real terminal, created one Sandbox, executed a remote command and confirmed independent absence after deletion. |
| Actual Docker failure and retry | PASS | Missing namespace identified before a build. The same deployment name could be retried. A real Docker RUN returned E7020. Its journal named one local image intent and no push, template or Sandbox. |
| Registry source to Express | PASS | The public python-hello recipe built and pushed, registered a template, launched a Sandbox, served authenticated CLI and direct HTTP commands, and passed a remote file roundtrip. The isolated Docker daemon used overlay2. Only this run's local Docker build used host networking. |

## Cleanup

The guided Express run independently confirmed its owned Sandbox absent. The negative Docker cases
used placeholders and requested no remote mutations. The Registry workflow independently confirmed
its owned Sandbox and template absent. The exact ACR tag matched the pushed digest before cleanup
and was absent from the tag list and returned HTTP 404 on manifest readback after deletion.
The dedicated Docker daemon, socket, local images and client configuration were removed.

## Problems found

The temporary VFS Docker daemon exhausted the local disk during an unrelated test image layer
copy. Its owned state was removed and the daemon was restarted with overlay2. The earlier test run
affected by disk exhaustion is excluded from the results. The shared-network full suite hit
MCP HTTP and transport loopback failures reproduced on unchanged `57c7632`. CI on the PR head
is the Node 20 and 22 quality gate.

## Not verified

The original report contains no underlying exception. The live source workflow used python-hello
without running a Codex model task. No npm or standalone release is included.

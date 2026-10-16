# Decision: Preserve Docker instruction structure during server wheel injection

Status: proposed

## Problem

When ABX_SERVER_SDK_SOURCE supplies a wheel, the builder replaces every physical Dockerfile
line containing a python-sdk archive URL with COPY and RUN instructions. A multiline RUN
with a conditional fallback consequently gains a COPY inside its shell body and an orphan fi.
A continued direct pip install loses its surrounding commands. Matching arbitrary URL text
also replaces comments, quoted examples and unrelated program content. The no-wheel regex
additionally corrupts explicit server version pins by replacing their package-name prefix.

Reproduced by calling the real exported function on the current
[agents-cli Dockerfile](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/agents-cli/Dockerfile).
Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/36.

## Decision

Process complete Docker instructions, including continuations and comment lines. For supported
shell-form direct pip/pip3 or Python -m pip installation commands, replace only a pinned server
requirement operand and put exact wheel COPY instructions before the complete RUN. Preserve
all other operands, surrounding commands, startup directives and conditional branches. Existing
wheel-glob COPY and installation branches continue to work with an injected wheel.

Recognize only a bare server operand for the no-wheel archive fallback. Do not reinterpret
comments, echoed text, another package's archive requirement, heredocs or JSON exec form.
Keep the source Dockerfile and template start/readiness protocol unchanged. Embedded programs
that install the runtime must declare wheel copying and installation themselves.

## API Design

The exported rewriteDockerfileForServerInstall(text, wheelNames) -> string signature is unchanged.
No CLI arguments, provider endpoints, template metadata or package dependencies change.
Private instruction/shell-word scanners retain source offsets so replacements preserve the
original shell structure. COPY additions are per affected RUN and therefore per build stage.

## Alternatives considered

- Replacing a whole physical line or whole RUN discards shell structure and unrelated installs.
- Making template CI substitute custom Dockerfiles would hide the deploy-path defect.
- A broad shell interpreter or new parsing dependency adds unnecessary runtime surface for the
  supported template installation patterns. Unsupported program forms stay verbatim.

## Dependencies

Existing Node filesystem/path/build APIs only. Docker continuation/heredoc semantics follow
[the official Dockerfile reference](https://docs.docker.com/reference/dockerfile/).

## Test Strategy

Regression tests exercise the exported function and validate resulting shell-form RUN bodies
with the real system shell syntax checker. They cover conditional and continued direct installs,
other package operands and version pins, quoted/control-word text, comments, heredocs, exec form,
multiple build stages and safe wheel filenames. Existing DockerBuilder build-path tests remain
required. The actual current template Dockerfiles are additionally materialized using this export,
with startup/runtime directives compared before and after.

Run full local CI, repository health and hygiene. Real Docker build and deployed sandbox checks
remain mandatory product gates; report them BLOCKED when Docker is unavailable and keep the PR draft.

## Acceptance criteria

- Regressions fail on the original implementation and pass after the fix.
- Complete RUN instructions and startup directives survive both wheel and no-wheel paths.
- Existing tests, type checking, lint, build, parity coverage, package and record checks pass.
- A real Docker/source-wheel deploy passes before claiming end-to-end completion.

## Evidence

[Verification](../../../evidence/verify/2026-10-16-server-wheel-dockerfile-structure.md).

A separate [production builder image regression](../../../evidence/verify/2026-10-16-server-wheel-image-ci.md)
uses the available GitHub Docker runner to advance the missing image gate without
uploading cloud credentials. Its preparation record does not claim a remote pass.

The first actual production image workflow passed both Docker builds and all
installed-source/runtime assertions at `3781054`; the separate
[runtime and cloud follow-up record](../../../evidence/verify/2026-10-16-server-wheel-docker-runtime.md)
preserves that result and the still-pending exported-image cloud acceptance.

The completed [production cloud verification](../../../evidence/verify/2026-10-16-server-wheel-production-cloud.md)
records the actual exported production image, six SDK/HTTP/CLI calls, 56 module
byte comparisons, all 21 external HTTP checks, preserved controller failures and
owned cleanup. Formal template-catalog canonical L2 is a separate open gate.

The full Docker deploy wrapper has not run on a Docker-capable cloud controller.
The successful production build plus separate cloud image acceptance advances
that gate but does not close it; keep this ADR proposed and PR draft.

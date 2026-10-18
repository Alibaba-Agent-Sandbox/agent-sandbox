# Verification: production DockerBuilder image regression

- Date: 2026-10-16
- Result: PARTIAL; workflow preparation passes, actual remote Docker execution is pending.
- Change: [PR 37](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/37),
  [issue 36](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/36).

## Purpose and execution path

The first local review had no Docker engine. A Docker-capable GitHub runner can
verify the actual production builder without cloud or model credentials. The new
workflow checks out immutable public SDK and template revisions, builds the CLI,
then runs `node scripts/verify-server-wheel-image.mjs`.

The script calls the real `DockerBuilder.injectSdkWheel` and `DockerBuilder.build`
methods, rather than copying their transformation into a test script. It builds
the original Python hello conditional-install Dockerfile and a continued direct
install with another package and commands before/after pip. The real Docker daemon
must accept both materialized Dockerfiles. Network-disabled containers then check
the installed SDK version, all packaged Python module bytes against the pinned
SDK source, non-root user and preserved command behavior. The direct
case also checks the retained extra package and shell side effect.

The public SDK revision is `e2cb27e24fde0a67112f82b8d44af463445a5d1a`; the
template revision is `7cb0d9430768eec22f500ebb80b3fe9517ab1cbc`. Checkout credentials
are not persisted. Template copies exclude environment files, existing wheels and
Python caches. Only a newly source-built wheel is injected. No registry login,
image push, model call or cloud resource is involved. The script removes its own
temporary contexts/images, including after a failure.

## Preparation checks and boundaries

- `node --check scripts/verify-server-wheel-image.mjs`: PASS.
- Workflow YAML parse and embedded command inspection: PASS.
- Scoped ESLint and independent peer review: PASS. Review requested exact installed
  source comparison so a preinstalled package with the same version cannot pass.
- Scoped whitespace and configured-secret scan: PASS before commit.
- Actual remote image build/runtime: PENDING at this preparation revision.

The existing 48 focused regressions and full remote Node 20/22 success remain
separate evidence at their recorded heads. A template workflow that builds the
unmodified Dockerfile is not evidence for this production builder path. This new
workflow must actually succeed before claiming its Docker regression passes.
Provider deployment remains a separate acceptance tier; this workflow alone does
not prove `abx template deploy`, ACR transfer or a new-image cloud sandbox.

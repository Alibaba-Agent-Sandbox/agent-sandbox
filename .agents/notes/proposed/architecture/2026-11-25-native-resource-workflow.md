# Native resource workflow candidate

Status: Proposed; bounded local implementation, not a complete catalog or runtime migration.
Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/260

## Decision and public behavior

The user rejected build artifacts that users must name, pass or parse, duplicate
raw-instance deployment, and build commands that create cloud resources. The
candidate removes public `--build`, `--out`, `--clean`, and `deploy --template-id`.
`template build SOURCE` constructs local Docker images only, returns real image
IDs, and privately reuses content-bound cached images after Docker inspection.
`deploy SOURCE --name NAME` publishes resource v1 templates/volumes/Serving.
`create --template NAME --resource RESOURCE --name INSTANCE` creates a dynamic
instance via the existing SDK/provider route; the selector is needed only for
several templates. Native template IDs continue through that same create route.

Source v5 deploy still performs its supported application startup. This is a
temporary migration boundary, not a claimed final unified product. Plain v5
Dockerfile build is local-only; v5 provider-specific deployment preparation may
still rebuild/stage runtime dependencies rather than reuse the v1 image cache.
Managed application builds stay automatic inside deploy. Source v1 remote catalog
acquisition, catalog-wide replacement, full application bootstrap and automatic
API authentication binding have not been delivered by this candidate.

## Implementation boundaries

Only relevant v1 contract/parser, Express resource API/executor and official Devs
component worker code were selected from the earlier draft; unrelated draft
public surfaces and architecture changes were not merged. Runtime/component
execution uses the npm distribution; SEA invocation fails explicitly. Docker
contexts exclude private files, input identity includes contents/paths/platform,
and cache records contain no credentials. Local builds never resolve unrelated
runtime secrets or execute pre-deploy actions. Steps/Serving are reported deferred,
including `no_local_build` when nothing was built. Unsupported native resource
Providers fail before parsing environment secrets, hooks or cloud credentials.

Static resource status queries real saved IDs and distinguishes missing, failed,
preparing and unknown from recorded readiness. FC presence alone is not ready;
deploy requires Active plus Successful. Account, region and Team identity are
checked; a user-provided opaque Sandbox API key cannot be independently proved to
belong to the saved Team before the instance API accepts it. The managed-key path
receives the selected Team explicitly. Saved endpoint overrides are preserved.

Dynamic instances receive independent names and owned cleanup intent before
creation. They never silently start or authenticate an HTTP API. Existing
Express startCommand/readyCommand remain build/snapshot controls. No new envd,
E2B style, generic business application metadata or bootstrapping guesses are
introduced. Published image tags and FC auto-created shared infrastructure are
retained because exclusive ownership has not been established.

An interrupted image publication remains pending and prevents replay; this
candidate cannot claim automatic recovery from an uncertain push. Known resource
IDs remain available for status/delete. A future recovery policy must prove
publication identity rather than promote a pending tag to ready or repeat hooks.

## Adversarial review

Root challenged pure-build cloud writes, false ready state, account/Team drift,
and duplication of create. API reviewer challenged mutable image caches, unrelated
secret evaluation, mixed/Steps-only success reporting and unsafe bootstrap.
Accepted fixes include cache inspection, literal build-only input discovery,
deferred reporting, explicit readiness and root create reuse. The suspected
failed-push replay was retracted after the reviewer confirmed the global pending
guard prevents replay; a regression and additional status invariant preserve it.
The final candidate is reviewed separately from the completed bounded UX fixes.

## Required remaining gates

- Real Docker smoke in CI; this host has not executed a Docker build.
- Real owned Express resource deploy/create/delete and independent cleanup, plus
  native FC component deployment and failure recovery, before normal release.
- A supported API bootstrap/authentication contract and cross-repository catalog
  migration before claiming the full empty-Sandbox/OpenAPI product finished.
- Reconcile source and public distribution, full repository CI, and platform
  package contents. No new package version is included here.

See [verification](../../../evidence/verify/2026-11-25-native-resource-workflow.md).

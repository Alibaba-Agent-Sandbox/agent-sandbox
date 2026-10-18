# Provider implementation boundaries

The host selects a `Provider` for every lifecycle operation, including the bundled
Express backend. There is no null/default-provider bypass. Core API objects consume
structural protocol and authentication contracts; they do not instantiate a vendor
SDK, exchange cloud credentials, derive backend URLs, or select a wire protocol.

## Ownership

| Responsibility | Owner |
| --- | --- |
| Provider selection, consent, integrity checks, output, generic configuration precedence, client-resource cleanup | Host |
| Authentication, endpoints, wire mapping, backend errors/statuses, lifecycle and optional create inputs | Selected Provider |
| Template authentication, build/register/poll/delete, Docker/registry specifics | Provider template implementation |
| Template source search/download, project scaffolding and runtime validation | Host, using the selected provider's declared metadata and factories |
| Express SDK, control-plane signing, explicit custom exchange, FC/ACR deployment, CLI options/prompts, AI management schemas | `providers/alicloud_express/` |
| Reusable E2B/envd wire adapters and token formatting | `providers/shared/e2b/`, explicitly selected by a provider |

The distribution composition roots register bundled adapters, configuration descriptors,
CLI extensions and AI extensions. The generated configuration catalog is declarative
compatibility data. Historical `api`, `protocol` and `transport` imports remain export
facades; they do not constitute a second implementation or a core fallback.
The shared HTTP/Connect transport implements framing and connection reuse; providers
choose its authentication and adapters. It never chooses a cloud backend.

## Template adapters

The CLI's optional `Provider.buildTemplateManager(config, feature)` factory returns
`list`, `get`, `delete`, `build` and/or `buildProject`, plus `close`. A Node plugin may
implement `buildTemplateManager(ctx)` alongside `buildInfra(ctx)`. It receives the same
filtered configuration, consented inherited fields and HTTP helpers. Installation
integrity and declared-feature checks apply before factory invocation. The lifecycle
factory is not invoked merely to list/build templates. The host closes factory-owned
resources on success and failure. Class methods on returned managers retain their receiver.
An absent factory or operation returns E8004; a feature declaration alone cannot enable it.
Mutations require explicit confirmation before constructing generic template infrastructure.

`buildProject` accepts a local project directory only when that provider implements it.
This contract does not activate the separate proposed image-only `buildTemplates(ctx)`
contract, provision remote templates for existing-ID-only providers, or invent PTY.
Backend support and real-backend acceptance are still required for each feature.

## Session binding and compatibility

Providers supply protocol construction, session authentication, URL derivation,
capability resolution and terminal opening. Programmatic providers that explicitly reuse
the shared E2B sandbox protocol receive its session-authentication hook. Providers using
another protocol get an opaque token with no invented HTTP headers. Missing protocol
families fail E8004. Optional create inputs, including `volume_mounts`, require an
explicit provider `createOptions` / `create_options` declaration before I/O.

A failure after creating a new sandbox attempts deletion and closes the client.
A failed connect closes the client and preserves the borrowed resource. Configuration
for an external provider has no Express endpoint/region defaults; undeclared bare
Express keys are rejected. Switching provider in one process recomputes CLI options
and AI tool schemas, so native flags/tools do not leak through module caching.

## Updates and migration

Extraction preserves existing public imports and the current distribution's bundled
Express installation. Bundled adapter updates follow the host release; `provider update
alicloud-express --check` reports `bundled` with upgrade guidance. Installed Git plugins
retain the existing verified/consented update and rollback workflow. See
[portability and updates](provider-portability-and-updates.md) for command details.
Decoupling does not make SDK migration zero-change, upgrade live sandboxes, or establish
feature parity across providers.

## Integration with the current host

The independent `cli/error_handler.ts` renders errors for generic commands and owned
provider extensions; callbacks do not import the root CLI. Authentication diagnostics
come from the selected auth adapter. Express sandbox calls require a sandbox API key;
control-plane AK/SK never creates an implicit key during a sandbox operation.

E2B/envd URL formatting lives with the wire adapter. Compatibility URL methods in both
configuration views delegate to the distribution's legacy builder. The retired raw
Dockerfile `POST /templates` build path stays removed; project deployment uses the
provider-owned CLI extension, and prebuilt-image registration uses the current adapter.
Missing optional template methods return E8004. Tool discovery preserves its public
ordering while recomputing schemas for the selected provider.

## Port and file URL ownership

The selected adapter implements synchronous port access and project-server gateway
headers. An adapter exposing only asynchronous port discovery must be called through
`await sandbox.network.resolve(port)`; synchronous helpers fail E8004 instead of
guessing an Express/E2B address or sending a foreign token. Direct standalone network
constructors keep their documented bundled compatibility behavior. File transfer URLs
are optional filesystem adapter hooks; missing hooks fail E8004 even if the session
URL happens to use HTTP. The core never constructs `/files` routes for foreign providers.

Neutral Python transport/protocol imports do not load built-in authentication or wire
adapters. Public compatibility imports resolve lazily when explicitly requested.

Pure bundled configuration, image and legacy URL metadata remains provider-owned.
Lower configuration reads its declarative data through distribution composition and
compatibility exports; it does not import authentication or runtime adapters. Compatibility
URL helpers delegate to declared templates or the composed owned builder.

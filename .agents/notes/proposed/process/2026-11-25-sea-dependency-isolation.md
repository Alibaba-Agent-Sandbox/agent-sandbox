# Decision: bundle static managed SDKs and verify copied standalone executables
Status: proposed

## Problem

Alpha.0's five-platform workflow passed while its executable remained below the
checkout's node_modules. A real copied binary failed on deploy --help because
local createRequire aliases concealed seven static calls to five packages from
esbuild. Coordination: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/273.

## Decision

Reuse the existing literal global require/nodeRequire branches in the FC and ACR
adapters. Preserve exact CJS namespace semantics and keep credential/STS loading
inside the credential-resolution function. Credential import can read unrelated
Serverless Devs home configuration, so it must not move to module initialization.

Copy every native executable into an independently checked temporary directory
before any artifact command. Require no node_modules in its real ancestor chain;
use a clean HOME/config/cwd and an environment whitelist for all subprocess/PTY
checks. Preserve complete npm package installations rather than copying their shim.

Managed component execution still needs actual loader files and Node. Keep npm
and ABX_APP_NODE behavior; give standalone managed build/deploy a controlled
prerequisite error before owned records, credentials or cloud requests. Preserve
plan previews and existing status/logs/delete/recover paths. Do not bootstrap or
bundle arbitrary components or redesign the runner.

Prepare immutable alpha.1 metadata/current guidance and a new version capture.
Preserve the alpha.0 tag, failure history and prior evidence. No cloud revalidation
or Python runtime release is part of this fix.

## API Design

The CLI command contract is unchanged. Standalone managed preparation reports its
supported npm/Node prerequisite; read-only plan previews remain supported.

## Alternatives considered

- Change only cwd: executable-relative require still reaches checkout ancestors.
- Top-level credential imports: introduce home/config side effects during help.
- Default-import normalization: unnecessary ABI changes; tested require namespace
  behavior already exists in other adapters.
- Bundle real component files or add automatic installation: changes the serving
  toolchain contract beyond this defect.

## Dependencies

Existing locked dependencies, NodeNext TypeScript, esbuild and the SEA builder.
The previously verified public Python 0.5.0a0 consumer pin remains unchanged.

## Test Strategy

Retain the copied alpha.0 negative control. Test actual NodeNext npm ESM factories,
isolated CJS factories, the five-package metafile closure and lazy module markers.
Run an actual copied SEA through complete help/scaffolds/notices/value aliases and
managed plan/admission checks. Require normal CI/review and all five platform SEA
checks before an immutable alpha.1 release and independent public readback.
Verify alias failure channels explicitly in both human and ambient CI modes:
human errors use stderr; CI errors use a single stdout JSON result. Preserve the
same exit code and error identity rather than combining both streams.

## Acceptance criteria

- Static managed SDK closure is complete without CJS ABI or lazy-loading changes.
- Every standalone artifact command runs from the copied executable and clean host.
- Managed preparation refuses before new owned records/credentials/cloud calls;
  source acquisition needed to discover a remote profile may still cache input.
- npm installation and external component semantics remain intact.
- Prior failed evidence remains; publication is never inferred from a local pack.

## Evidence

- [Verification](../../../evidence/verify/2026-11-25-sea-dependency-isolation.md).
- [Artifact output-channel regression](../../../evidence/verify/2026-11-25-artifact-output-channel.md).

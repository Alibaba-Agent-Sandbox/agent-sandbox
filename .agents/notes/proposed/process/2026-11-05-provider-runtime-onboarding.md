# Decision: Document provider runtime requirements and quick installation

Status: proposed

## Problem

The provider guide describes installation permissions and operations before explaining
the client prerequisites. Python users can incorrectly infer that a Python package
installs the Node provider engine, or that they must install Node separately even when
using the standalone CLI. OpenSandbox's default URL is also presented as a required
environment setting. The user requested practical installation and performance guidance.

## Decision

Put a supported standalone-binary quick installation and an explicit environment table
in both provider guides, and clarify Python usage in both binary installation guides. Explain the CLI and Python call paths at the level needed to
understand the runtime dependency and performance trade-off. Link the SDK's complete
Python workflow, preserve CLI Git-source trust rules, and distinguish the Python registry
archive installer from the CLI source installer.

Document the existing one-command CLI installer rather than claiming an unshipped pip
extra exists. A pip-only provider installation needs separately published runtime and
provider packages, package discovery and compatible version constraints. That distribution
change is outside this documentation patch and remains a possible follow-up, not a
public installation command.

## API Design

N/A — this decision does not involve API changes. Existing installation commands,
ABX_BIN selection, provider trust boundaries and service authentication remain in use.

## Alternatives considered

- Require external Node for every Python user: unnecessarily excludes the existing
  standalone CLI distribution, which contains its runtime.
- Present a chained shell line as a single pip installation: obscures the dependencies
  without providing the required Python distributions.
- Publish a fixed latency estimate from a synthetic proxy: does not measure the real
  engine/provider path and would be an unsupported product guarantee.
- Rewrite all providers in Python: a separate architecture and maintenance decision;
  it is unnecessary to clarify the current installation choices.

## Dependencies

- Current CLI standalone releases and existing shell/PowerShell installers.
- [Python provider guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/providers.md).
- [Provider installation guide](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/blob/main/docs/en/install.md).

## Test Strategy

Run document/link/ADR health checks, hygiene and a whitespace check. Independently
exercise a published standalone binary and the Python registry installer in an isolated
environment with no external Node/npm/Git on PATH. This is installation and handshake
verification; it does not establish backend or performance acceptance.

## Acceptance criteria

- Both languages distinguish standalone, npm and Python prerequisites.
- The recommended standalone installation uses an existing public installer.
- Git, Docker, backend service and authentication requirements are conditional and clear.
- The default OpenSandbox URL requires no redundant export.
- Engine reuse and the kinds of performance costs are stated without invented timings.
- Documentation checks and the actual installation result are recorded separately.

## Evidence

- [Verification](../../../evidence/verify/2026-11-05-provider-runtime-onboarding.md).

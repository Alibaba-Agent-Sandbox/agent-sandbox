# Decision: Converge standard interfaces with native provider ownership

Status: proposed

## Problem
The standard interface branch predated accepted provider composition, metadata,
authentication and cleanup changes. Its global E2B configuration rename replaced
native ABX contracts, while some renamed authoring routes stayed on retired owners.

## Decision
Preserve canonical ABX configuration in native APIs. Normalize E2B settings once
at the standard CLI entry. Port explicit prompt/scaffold routes to their current
owners without restoring Express fallbacks. Resolve envd handles before portable
OS inspection; keep the accepted procps-free fallback. Refuse unsupported PTY and
template operations before side effects and preserve non-404/405 resume errors.

Explicit `list --all-providers` remains the native provider-aggregation extension;
ordinary standard list filters and remote exec arguments keep their standard route.

## API Design
Standard parser/wire behavior stays pinned. Provider extensions retain independent
configuration and ownership. Standard frontend and native CLI have separate tests.

## Alternatives considered
Globally renaming native keys breaks existing providers. Restoring whole old files
would resurrect retired ownership and discard accepted contract fixes.

Native provider/MCP documentation retains canonical ABX configuration; only the
standard entry accepts the E2B aliases. Agent-facing CLI examples use standard
syntax while preserving all21 MCP tools and resource ownership rules.

## Dependencies
Accepted CLI35,31,37,62 and SDK38; standard SDK47 is a separate consumer dependency.
https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/47

## Test Strategy
Real loopback resume-denial tests fail before the fix and pass after it. Verify
standard routing/config, provider isolation, guarded side effects, portable process
inspection, full maintained suite, artifact build, real Express and cleanup.

## Acceptance criteria
Latest-head CI passes, records and bilingual guides agree, mandatory artifact and
real component gates complete. Conditional pause/snapshot requires an enabled
fixture; missing success evidence is explicit and keeps this candidate draft.

## Evidence
[Verification](../../../evidence/verify/2026-10-18-standard-provider-convergence.md).

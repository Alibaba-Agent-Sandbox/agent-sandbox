# Decision: Read-only npm credential diagnostics
Status: proposed

## Problem
Publishing version 0.4.6 still returned E404 after the repository npm secret was refreshed. The publication error alone does not identify invalid authentication versus account/scope/token authorization. Repeated publishing provides no additional evidence.

## Decision
Add an opt-in `diagnostics_only` boolean to the existing Release dispatch. The diagnostic job uses the publication environment and secret, runs only `npm whoami`, `npm org ls` and `npm access list packages`, and prints an allowlisted classification. Account identities, organization rosters, package lists and raw upstream errors remain captured in memory. npm debug files are disabled for these commands. Diagnostic requests skip the publication job; normal publication retains all existing source-tag and artifact gates.

## API Design
No product API changes. Maintainer workflow input: `diagnostics_only: boolean = false`. The released source tag remains immutable.

## Alternatives considered
- Repeat publish: rejected because identical authorization failures add no diagnostic evidence.
- Print npm raw errors and identity: rejected because public CI logs need only sanitized classifications.
- Infer first-publication rights from an absent package entry: rejected because the package may not exist yet.

## Dependencies
Existing GitHub Actions setup-node and npm CLI; no package dependency changes.

## Test Strategy
Execute the actual workflow diagnostic script against controlled npm responses to cover valid, rejected and missing credentials and verify output suppression. Exercise the diagnostic against the real npm registry with the refreshed CI secret. Run existing required CI and repository health/hygiene gates.

## Acceptance criteria
- Diagnostic requests never execute publish; release/default recovery paths retain their gates.
- The same secret is checked read-only without disclosing token or account data.
- Authentication is distinguished from authorization without overstating first-publication permissions.
- Current-head CI, review and real registry evidence are recorded.

## Evidence
- [Verification](../../../evidence/verify/2026-10-22-npm-credential-diagnostics.md).
- [Release delivery Issue](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66).

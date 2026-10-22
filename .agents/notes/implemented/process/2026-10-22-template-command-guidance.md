# Decision: Recover interactive setup and align template commands

Status: implemented

## Problem
With --yes, configuration collection deliberately does not prompt. The error omitted the interactive recovery path, while active examples still showed rejected create flags.

## Decision
Explain rerunning without --yes/-y, preserve nonblocking automation and untouched business execution, add unit and black-box assertions, update bilingual current examples. Preserve immutable historical workflow captures. Independently document a proposed opt-out, sanitized, bounded error reporter; no new outbound reporting or backend is implemented.

## API Design
N/A — this decision does not involve API changes. Proposed diagnostics interfaces, when relevant, are explicitly unimplemented design, not current configuration or routes.

## Alternatives considered
- Keep the obsolete example and ask readers to translate it — repeats an avoidable installed-CLI failure.
- Edit generated website or Registry output directly — loses source ownership and will be overwritten.

## Dependencies
Current Express CLI contract and each repository's own source integration. https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/106

## Test Strategy
Run guidance contract and snapshot tests, required full tests/lint/typecheck/build/health/hygiene, no-credential black-box recovery and real-terminal cloud continuation with owned cleanup. Compare any environment failures with untouched base. Review both diagnostics design languages and source links.

## Acceptance criteria
Correct positional create examples; --yes error explains interactive recovery without prompting or submitting; required CI passes and no new baseline failures. Diagnostics remains a proposal.

## Evidence
- [Verification](../../../evidence/verify/2026-10-22-template-command-guidance.md)

## Implementation
The scoped local implementation and validation are recorded above. Remote delivery is tracked by the owner PR; this status is not a claim that publication or merge already occurred. Outstanding gates remain explicit in the verification evidence.

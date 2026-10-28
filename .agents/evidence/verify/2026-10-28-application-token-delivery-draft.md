# Delivery draft: Application-token guidance

Publication is BLOCKED: no GitHub authentication is configured. This is not an open Issue or PR.
Related existing work: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/189.

## Issue title

[Bug]: application-token errors do not explain purpose or how to obtain the value

## Reproduction

Launch a template declaring empty ABX_SERVER_TOKEN. The report completed command-only platform
configuration and then received E8002. Its CLI version is unknown; downloaded public npm 0.5.7
already includes interactive setup. Current noninteractive setup omits field help and the resolver
error only names the prerequisite.

## Acceptance criteria

Explain token purpose, local generation/manual entry, distinction from platform credentials and
later reuse in prompts and errors. Preserve hidden input, no submission on cancellation and explicit
configuration for automation. Verify temporary platform configuration continues to application setup.

## PR title

fix: explain template application authentication in prompts and errors

## Description

Templates require a private application token before preparation. Missing-token diagnostics now
explain what it protects, how to generate or enter it, and how later calls reuse it. The prompt names
ABX_SERVER_TOKEN explicitly; automation receives the same field help without prompting. User docs
in both languages explain setup and omit introductory implementation details.

## Type of Change

- [x] Bug fix
- [x] Documentation
- [x] Tests

## Testing and definition of done

See the companion verification record for executed regressions, real PTY, built CLI JSON golden,
full-suite/CI checks and their actual limitations. Real-cloud E2E is BLOCKED by missing Sandbox API
credentials. Full-suite failures require resolution before merge; local passes do not replace them.
The PR must remain draft while required gates are unmet. Remote CI/review/merge cannot be evaluated
until authenticated publication is available. No release or package publication was performed.

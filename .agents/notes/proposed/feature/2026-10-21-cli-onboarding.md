# Decision: Make command and template onboarding actionable

Status: proposed

## Problem

Root help separates provider from peer groups and omits the browser template
catalog. Its scaffold/deploy example deploys the wrong directory. A missing
project only yields a parser path error, and stale --template create guidance
conflicts with the maintained standard parser. Existing-directory generation
needs visible replacement disclosure and an explicit decision.

## Decision

Group provider with all command groups, link the real template Registry and show
runnable local scaffold/deploy examples. A shared local CLI preflight validates
build/deploy paths before cloud work. A missing interactive project can invoke
the existing scaffold picker, create the chosen files and stop for review.
Batch/-y paths explain exact scaffold commands without creating a guessed project.

Disclose nonempty scaffold/copy destinations before writes. A terminal can confirm
replacement; batch replacement requires --force, with a warning even alongside
-y. Decline preserves files. Reject incompatible directory/symlink destinations
for built-in file generation before any writes. Preserve provider ownership and
standard parser semantics; explain positional create syntax on the legacy flag
error and correct first-party guidance. Ship a new 0.4.3 patch and verify the
website mirror after GitHub publication.

## API Design

No SDK or cloud API changes. CLI-local prepareTemplateProject returns an existing
resolved directory, offers local scaffolding then exits for review, or raises an
actionable UsageError. Standard create still rejects --template with its existing
exit code. Existing scaffold --force/-y remain the explicit batch controls.

## Alternatives considered

- Automatically mkdir and deploy an empty directory: does not create a usable
  template and can hide a typo.
- Guess a runtime and immediately deploy generated files: skips source review.
- Treat -y as overwrite permission: can destroy existing project work.
- Rewrite legacy --template argv: changes the pinned standard parser contract.

## Dependencies

Existing CLI prompts, scaffold cases and provider-neutral template selection.
No new runtime packages. Registry URL verified at
https://registry.agent-sandbox.cn/templates/.

## Test Strategy

Observable CLI/filesystem regressions cover missing paths, accepted/declined
creation, overwrite confirmation, -y protection, --force disclosure, copied
sources, unrelated file preservation and incompatible target types. Update
existing command-surface tests, active help snapshots and offline scenarios.
Exercise actual installed npm/SEA artifacts and a real terminal, then remote CI,
five-platform builds and the official website installer. No cloud resource is
needed for local help/file preparation; do not claim cloud coverage.

## Acceptance criteria

- Provider shares Command groups; Registry and runnable workflow appear in help.
- Missing project creation requires a terminal decision and stops for review.
- Decline or -y without --force leaves existing conflicting files unchanged.
- Explicit writes disclose affected entries and preserve unrelated files.
- Standard create flag errors explain the correct positional template syntax.
- Current-head CI and installed-artifact checks pass before publication; website
  manifest/default installer and actual installed version match the new release.

## Evidence

- [Verification](../../../evidence/verify/2026-10-21-cli-onboarding.md)

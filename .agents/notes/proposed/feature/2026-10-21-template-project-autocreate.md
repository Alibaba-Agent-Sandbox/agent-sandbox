# Decision: Create missing template projects inline and continue

Status: proposed

## Problem

The user clarified that missing deploy directories should be creatable at the
prompt, while --yes/-y or CI should create them directly and continue. The
0.4.4 behavior instead rejected batch invocations and stopped after interactive
scaffolding. That does not fulfill the requested deploy workflow.

## Decision

For project build/deploy and the deploy shortcut, offer creation of a missing
directory and continue after confirmation and case selection. --yes/-y or CI
creates the built-in Python scaffold without prompts, preserving original
provider/alias options. CI also confirms the subsequent project operation.
Existing directories pass through without scaffolding or overwriting files.

Reuse the standalone scaffold writer and its conflict/type guards. Its shared
function returns created/replaced entries without printing a result. Standalone
scaffold keeps its normal summary; build/deploy emits only the final provider
result on stdout. Noninteractive invocations without yes/CI retain actionable
guidance. Scaffolding existing files still requires its separate overwrite consent.

This user correction supersedes the stop-for-review and batch-no-write choices
in the earlier record, while preserving that record as history:
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/dc17b8c0109a398a9a88d616bd35758bf27d4ea6/.agents/notes/proposed/feature/2026-10-21-cli-onboarding.md.

## API Design

CLI-local prepareTemplateProject returns the existing/generated project path.
writeBuiltinScaffold shares file creation and conflict checks with standalone
scaffold, returning created/replaced paths. No cloud API, provider implementation,
standard create syntax or public SDK changes. Prepare patch version 0.4.5.

## Alternatives considered

- Only mkdir: leaves no usable template files for deployment.
- Stop after generation: repeats the behavior the user explicitly corrected.
- Treat JSON as creation consent: JSON selects formatting; yes/CI grants consent.
- Invoke standalone scaffold unchanged: creates an intermediate JSON result and
  breaks the one-result deployment output contract.

## Dependencies

Existing built-in Python/node/minimal scaffolds, prompts, output manager and
provider dispatch. No new packages or cloud operations.

## Test Strategy

Regress all three entry points through confirmed creation, yes, explicit CI,
CI environment, selected runtime, original options and one-result JSON output.
Verify decline/file-target/existing-project preservation and retained overwrite
tests. Exercise a real terminal, installed npm tarball and actual SEA with isolated
credentials: creation must reach the existing provider credential preflight.
Run full local checks and current-head remote CI/five-platform artifact gates.

## Acceptance criteria

- Confirming creates a usable project and invokes the original provider handler.
- Yes/CI creates the Python project without prompting and continues.
- Original alias/path/options survive; stdout contains one final JSON result.
- Decline and absent consent leave missing paths absent; existing files survive.
- Required CI/release gates pass; official default installer delivers 0.4.5.

## Evidence

- [Verification](../../../evidence/verify/2026-10-21-template-project-autocreate.md)
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/97

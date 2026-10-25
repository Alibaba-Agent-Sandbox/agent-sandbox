# Decision: Preserve named-command failure diagnostics in JSON output

Status: proposed

## Problem
Public CLI 0.5.5 turns a server validation or execution failure into exit 1 with only `{"result":null}` in JSON mode. The API retains the diagnostic in `CommandResult.stderr`, but the command callback suppresses it. This hides the actionable error and makes a failed command's stdout identical to a successful null result.

## Decision
Handle unsuccessful results before printing successful data. In JSON mode, reuse `OutputFormatter.printError`, the existing diagnostic and `ExecutionError.code` (E3000); then exit 1. Keep text errors, successful result JSON and unknown-command E3005 behavior. Add a real local HTTP/dispatcher regression and a new dated CLI capture; retain previous captures.

## API Design
No new class, error format or protocol. Failed JSON output uses the existing `{status, message, code}` error format. Successful output remains `{result}`. Existing exit codes remain unchanged.

## Alternatives considered
- Print the error after the result: would emit two JSON documents.
- Add a separate error contract or a retry mechanism: unnecessary for an output-layer defect.
- Infer the particular cloud command's cause from `result:null`: the original HTTP error was not retained, so that diagnosis is unavailable.

## Dependencies
- Existing `OutputFormatter.printError`, `ExecutionError` and `CommandResult`.
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/180

## Test Strategy
Demonstrate the regression fails before the fix and passes afterward. Exercise the actual dispatcher and HTTP-to-CommandResult mapping with local HTTP 400/500 failures, text output, 200/null success and 404 control. Regenerate only the new dated error capture. Run the repository checks and record real-component verification separately from the fixture.

## Acceptance criteria
- A failed JSON command emits one E3000 error object carrying its diagnostic, with exit 1.
- Text failures, successful null results and E3005 unknown commands retain their behavior.
- Local fixture, required CI and real-component evidence are recorded without credentials.
- Normal review precedes merge; publication is a separate release action.

## Evidence
- [Verification](../../../evidence/verify/2026-10-25-named-command-json-errors.md)

# Decision: Preserve one JSON result during managed coding-agent installation

Status: proposed

## Problem

The first prompt-based create on CLI 0.5.4 installs the missing managed coding agent, emits an installation success JSON object to stdout, then emits the final creation JSON object. Strict consumers cannot parse the result even though the cloud creation succeeded. Existing-install runs skip this branch.

## Decision

Send the intermediate installation completion through existing `OutputManager.info` on stderr. Keep the final creation result on stdout. Publish the next minimal CLI patch, 0.5.5, after normal source and platform gates. No parser workaround or new output protocol is introduced.

## API Design

No new API or option. Current custom-command examples also use the existing public `command` and `start` exports; removed module-global registry imports are corrected in documentation rather than restored. The documented stdout-result/stderr-diagnostic contract applies to the first installation as well as subsequent invocations.

## Alternatives considered

- Filter progress lines in consumers: rejected because stdout must already be a valid single JSON document.
- Change all success messages globally: rejected; final command success remains a legitimate stdout result.
- Reuse the previous HOME: rejected as installation-path verification because the affected branch would be skipped.

## Dependencies

- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/177
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/178
- Existing coding-agent backend installation and output manager.

## Test Strategy

Run actual CLI dispatch and output formatting with a first-install backend fixture. Demonstrate the regression fails before the one-line fix and passes afterward. Repeat a real managed installation from a new HOME with independent stdout/stderr capture, model generation and exact owned-resource cleanup. Preserve the failing public 0.5.4 experiment. Final public runtime dependency, owner CI and five actual platform artifact gates remain required before publication.

## Acceptance criteria

- First-install stdout parses strictly as the final creation object; install completion is on stderr.
- Installation consent, verification and failure behavior remain unchanged.
- Real fresh-HOME generation and cleanup are recorded accurately.
- Final reviewed source and immutable published artifacts pass their normal gates.

## Evidence

- [Verification](../../../evidence/verify/2026-10-25-managed-agent-json-output.md).
- [Final public SDK6 consumption and preserved network diagnostics](../../../evidence/verify/2026-10-25-cli-055-public-a6-consumption.md).

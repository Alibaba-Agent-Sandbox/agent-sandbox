# Decision: Preserve Express platform ENV key/value arguments

Status: proposed

## Problem

The native template build plan sends build.env as one KEY=VALUE argument, while real Express platform-step acceptance requires distinct key/value arguments. The former regression expected the incompatible wire shape. Refs https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/84 and https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/149.

## Decision

Emit one ENV step with two arguments per declared variable. Preserve literal spaces and equals signs within each value. Keep build selection, order, raw steps and standard/native command routing unchanged. Actual probes showed that accepted native ENV also failed to reach the server process. Supply final ENV values to explicit generation-2 start/readiness commands with a quoted env/shell wrapper, preserving literal values and compound-command scope. Generation1/default entrypoints and independent envd processes retain provider-defined environments. Update both contract languages and the changelog.

## API Design

Existing build.env mapping; wire expansion changes from args=["KEY=VALUE"] to args=["KEY","VALUE"]. The CLI does not promise that native ENV reaches later RUN processes; the template owner's existing adapter exports build environment explicitly.

## Alternatives considered

Keeping the old shape rejects otherwise valid recipes on the actual provider. Splitting a joined string would corrupt values containing spaces/equals. Changing routing or generic build semantics is unrelated.

## Dependencies

Official Express CreateTemplate step handling. Cross-owner current-catalog acceptance is tracked at https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/149.

## Test Strategy

Existing expansion regression first fails with 1 failure/6 passes, then verifies separate arguments including a value containing spaces and equals. Run full local gates, the real compiled native CLI against an owned step template, CLI/SDK smoke, ordinary environment roundtrip and independently verified owned cleanup. Record failures rather than rewriting them.

## Acceptance criteria

- Correct ENV arguments and literal value preservation.
- Bilingual contract/changelog and engineering records.
- Real current-source native step acceptance with independently confirmed owned cleanup.
- Latest-head CI and normal verified PR merge without bypass.

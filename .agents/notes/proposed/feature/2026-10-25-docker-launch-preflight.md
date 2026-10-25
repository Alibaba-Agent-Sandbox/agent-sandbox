# Decision: Check Docker before recording a local build intent

Status: proposed

## Problem

A fresh public CLI source launch on a host without Docker hides the existing setup reason behind a generic preparation failure. It also registers a local image intent before discovering that no build can execute. This falsely requires ambiguous-resource recovery for an unstarted operation.

## Decision

Reuse the existing read-only daemon check before recording a local image build intent. The actual build retains its own availability check and all real writes retain write-ahead ownership records. A provider-shared DockerSetupError carries only fixed missing/unavailable/cancelled messages; launch preserves this controlled E7020 instead of exposing arbitrary external stderr. No new journal state is added.

## API Design

No command or journal schema changes. Docker prerequisite failures preserve the existing E7020 category with actionable text. The internal error stays outside the Python-parity error export contract.

## Alternatives considered

Skipping ownership records weakens cleanup. Marking every build failure as absent could hide partially created resources. Passing through arbitrary Docker error text could leak external output. A separate read-only prerequisite check avoids all three.

## Dependencies

Existing DockerBuilder.checkDocker, provider shared project errors and ResourceJournal. No added package dependency.

## Test Strategy

Actual source launch from the public Git catalog using the candidate SEA on a real host without Docker; assert fixed prerequisite guidance and no unresolved intents. Regress missing executable and inaccessible daemon before intent/build/push/create; retain existing healthy write-ahead tests and raw-output privacy tests. Run the actual artifact checker, focused managed cloud E2E and required local/remote checks.

## Acceptance criteria

Missing Docker and inaccessible daemon create no build resource intent, while real builds/pushes/registration remain journaled before submission. Template launch displays fixed remediation without raw tool output. Original public-package failure remains historical evidence; candidate prerequisite success is separate from a successful image build.

## Evidence

- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/160
- [Verification](../../../evidence/verify/2026-10-25-docker-launch-preflight.md)

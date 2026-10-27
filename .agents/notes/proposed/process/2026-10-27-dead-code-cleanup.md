# Decision: Remove verified unused code and record candidate dispositions

Status: proposed

## Problem

Unused imports, private declarations and write-only state survive ordinary type checking. The older workspace audit also included nine modules already retired on accepted main.

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/203.

## Decision

Remove verified unused bindings and the unconsumed direct @alicloud/openapi-client dependency. Preserve useIso() hooks and logger initialization. Keep the WebSocket constructor argument position while removing its unused parameter-property storage. Enable noUnusedLocals and noUnusedParameters in the existing TypeScript gate. Do not modify maintained standard sources, golden files or public exports.

## API Design

No supported command, option, public export or runtime protocol is removed. This is scoped maintenance; scanner reachability is not an external-usage proof.

## Alternatives considered

- Delete every scanner finding: rejected because callbacks, dynamic registration, public exports and side-effectful expressions need semantic review.
- Patch the old workspace checkout: rejected because accepted main already resolves some findings and unrelated local changes must remain intact.
- Keep all unused private bindings: retains unnecessary code and, for TypeScript, lets new unused declarations accumulate.

## Dependencies

Remove only the unused direct @alicloud/openapi-client dependency and its unused lockfile subtree.
Each owning repository has its own Issue, branch, record and validation. No package release or manual deployment is part of this task.

## Test Strategy

Type checking, ESLint, full unit/parity checks, clean npm installation and package verification; existing real-component E2E and current-head CI remain required.
Initial failures, missing prerequisites and later reruns remain separate evidence. Existing behavior tests are reused for deletion-only cleanup; no tests merely assert that source text disappeared.

## Acceptance criteria

- Verified unused bindings are removed while initialization and observable behavior remain.
- Public interfaces, attribution, generated-source ownership and historical evidence are preserved.
- The candidate review below distinguishes removed, upstream-resolved and retained cases.
- Applicable verification and current-head remote CI/review gates pass before merge.

## Consequences

The nine Image/TemplateManager, GlobalConfig, session, PortClient, secret-store and retry modules are already removed by the accepted retirement decision. See https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.agents/notes/implemented/architecture/2026-10-18-retire-orphan-cli.md. The eleven exported helper candidates remain: decodeUtf8Ignore, withStream, isIdentifier, casefold, capitalize, rjust, posixBasename, posixDirname, getRootLogger, builtinKeys and findKeyByAlias. The package distributes dist without a restrictive exports map; local zero-use is insufficient evidence to remove deep-import contracts. The two configuration helpers also have generator ownership in scripts/gen-config-keys.mjs. shlexJoin has a parity-harness consumer and remains. All public command behavior and provider ownership stay unchanged. Full real-component acceptance exposed two unchanged stale workflow assertions, tracked at https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/205; this cleanup does not replace or skip them to obtain a pass.

## Evidence

- [Verification](../../../evidence/verify/2026-10-27-dead-code-cleanup.md)

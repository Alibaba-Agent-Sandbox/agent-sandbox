# Decision: Consume readiness-fixed Python runtime in the next CLI patch

Status: proposed

## Problem

Generated and scaffolded Python artifacts must use the matched SDK runtime that waits for a transiently unavailable readiness command. Native missing-template info currently wraps definitive official absence as a network error, forcing unsafe string-based cleanup assertions.

## Decision

Publish the smallest CLI patch, 0.5.4, consuming Python client/server 0.4.0a4 through the existing shared exact pin. Regenerate standard assets with locked vendor inputs. Map official structured GetTemplate statusCode404 plus TemplateNotFound to existing E2001, and remove the old message fallback from project tests. Do not alter global errors, create a new class or duplicate readiness polling in the CLI.

## API Design

No new options or classes. Native template info reports the existing E2001/exit4 for definite missing templates instead of E5000/exit1. Authentication, server and transport failures do not count as absence.

## Alternatives considered

- Keep E5000 with string matching: rejected because localization or intermediary diagnostics are not typed absence.
- Publish before the dependency: rejected; actual public Python installation and artifacts are required.
- Overwrite an older release tag: rejected; all existing tags and evidence stay immutable.

## Dependencies

- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/173
- https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/121
- https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/122
- https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/125

## Test Strategy

Meaningful SDK error mapping and fail-closed regressions; actual read-only owned-deleted template lookup; locked generation/provenance; real generated MCP HTTP/auth/tools with fresh public dependencies; normal owner checks and five platform artifacts; public fresh developer cases after publication.

## Acceptance criteria

- New exact default pin and generated consumers agree without historical compatibility.
- Actual missing-template lookup returns typed E2001 while unrelated failures remain non-absence.
- Public dependency and required owner/review gates pass before immutable .4 publication.
- Fresh public developer reruns and current bilingual guidance identify the actual delivered versions.

## Evidence

- [Verification](../../../evidence/verify/2026-10-25-cli-054-runtime-consumption.md).

- [Public a4 consumption](../../../evidence/verify/2026-10-25-cli-054-public-a4-consumption.md).

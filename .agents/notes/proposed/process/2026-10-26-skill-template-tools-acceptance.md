# Decision: Real template and third-party tool business acceptance
Status: proposed

## Problem

Skill prose and successful API submission do not prove OCI builds, rollback, repository applications, expiring previews or third-party MCP tools produce their promised results. Earlier mock and installation checks left these delivery criteria unverified.

## Decision

Add an opt-in real-cloud template acceptance script in CLI `e2e/` with an environment-selected source, unique owned labels, explicit expected business artifacts and independent cleanup reads. The [SDK owns repository, preview and MCP workload acceptance](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/e2e/skill_tools_acceptance.py). Keep provider-native expiry distinct from application-level HMAC expiry. Keep successful task-owned template IDs until the dependent acceptance checks finish, then delete only those exact resources.

## API Design

N/A — this decision does not change public APIs. The Node scenario accepts `ABX_SKILL_SOURCE_TEMPLATE_ID`, optional `ABX_BIN` and `ABX_SKILL_RUN_PREFIX`, and a new `--output` receipt path. The Python scenario accepts an optional `ABX_SKILL_RUNTIME_TEMPLATE` and the same new-output requirement.

## Alternatives considered

- Treat registration or tool discovery as success — rejected because neither proves an actual business effect.
- Use only mocked builds or a fabricated expiring URL — rejected because the user requires actual backend results.
- Mutate a user's existing template or tool installation — rejected because isolated owned resources provide reproducible checks and safe cleanup.

## Dependencies

The built CLI, its locked Alibaba SDK dependency, a source-compatible Python client, actual Express account credentials and outbound Git/npm access. Template steps require an eligible ready generation-2 source image.

## Test Strategy

Verify two real platform builds, v1/v2/v1 sandbox artifacts, expected exit42 build diagnosis, a pinned public repository application's exact response, unsigned/tampered/expired preview denial and two real third-party MCP package versions. Independently read resource absence after cleanup. Preserve failed attempts separately from successful reruns.

## Acceptance criteria

- Valid spec-5 fixtures reach Ready and return the expected version and business result385 from actual new sandboxes.
- The deliberate build failure reports error/E7010 with exit42 and never reports Ready.
- Repository preview signatures work before expiry and fail after expiry; the application-level contract is documented.
- MCP initialization, discovery, real tool execution, logs, update and process/package cleanup pass.
- Exact owned sandbox/template cleanup reads pass, and scripts, bilingual docs and verification evidence remain reviewable.

## Evidence

- [Verification](../../../evidence/verify/2026-10-26-skill-template-tools-acceptance.md)

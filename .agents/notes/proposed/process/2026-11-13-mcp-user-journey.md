# Decision: End-to-end MCP user guidance and bounded acceptance

Status: proposed

## Problem

[Issue250](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/250).
The guide has a seven-tool detailed table, a later extension-name list, and a transport-heavy
entry. Users need a connected assistant task, local result delivery, background recovery,
credential distinctions and real evidence. Historical 17-scenario Skill acceptance is a
broader, still-partial denominator; selected current MCP passes cannot close it.

## Decision

Add bilingual Qwen/client onboarding, a real CSV result, complete tool purpose/parameter tables,
transfer/task/ownership instructions, explicit interpreter limitations and template build phases.
Preserve historical evidence. Record a new source-MCP run, actual Qwen tool calls, HTTP behavior,
a prepared-image template path and independent cleanup. Keep the initial envd-injection failure
and client configuration failures distinct from subsequent successful paths.

## API Design

N/A — runtime, tools, schemas, exports and CLI commands are unchanged. The built-in source
provider explicitly rejects native run_code with E8004; ordinary Python commands are separate.

## Alternatives considered

A larger tool inventory without an actual user task would retain the onboarding problem.
A helper/client exit code alone is insufficient. Reclassifying unsupported interpreter execution,
a prepared image as arbitrary-image certification, or a local HTTP service as permanent managed
hosting would misstate the result. No runtime release or permanent service is necessary here.

## Dependencies

Source CLI `16e0a2bfe50ac89b1d6c8ee21e3bcc995cd12614`; current authorized Express configuration;
existing base image/Team; Qwen Code 0.19.3 and an available model. No management key was created.
Website onboarding is tracked independently in https://github.com/Alibaba-Agent-Sandbox/website/issues/107.

## Test Strategy

Discover actual tools; exercise commands/files/binary checks/metadata/TTL/retention/tasks,
STDIO restart, HTTP auth/session termination and template submission/readiness/runtime cleanup.
Independently read/delete only owned resources. Preserve sanitized requests/returns and actual
assistant replies. Run document health/hygiene and inspect required PR CI separately. A fresh
optional full local suite remains separately reported, including failures and skipped oracles.

## Acceptance criteria

- New users can configure, approve/connect, run, retrieve results, diagnose and clean up.
- Every current source tool is accounted for; unsupported operations are explicit.
- Actual Qwen, STDIO and HTTP results are recorded independently of helper exit codes.
- The prepared-image template path and initial failure are distinguished; owned cleanup is verified.
- Historical Issues46/SDK45 remain open until their original broad criteria are actually delivered.
- Required documentation/PR gates pass without weakening product tests.

## Evidence

[Verification](../../../evidence/verify/2026-11-13-mcp-user-journey.md).

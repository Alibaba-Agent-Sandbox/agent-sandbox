# Decision: Route managed application guidance to the Harness family

Status: proposed

## Problem

The managed guide links a retired single agents-api directory after the user requested six native Harness recipes sharing one Gateway protocol.

## Decision

Point both guide languages to the source-owned family guide. Keep native FC resource execution, application-owned publication, explicit credentials and drain-aware destruction unchanged.

## API Design

No CLI/runtime API changes. The six recipe IDs are explicit; source readiness, runtime publication and cloud acceptance remain separate.

## Alternatives considered

Do not duplicate all template credential tables into the CLI guide or create another command tree. Do not relabel the old Qwen case as a new Codex run.

## Dependencies

Template source: https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/311.
Tracking: https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/309.

## Test Strategy

Run owner document/record hygiene and link checks, inspect the two-language diff. This prose-only change creates no cloud resources.

## Acceptance criteria

Both guide languages identify all six recipes and their native credential boundary. No new release or cloud pass is implied. Publication follows the coordinated PR gates.

## Evidence

[Verification](../../../evidence/verify/2026-11-17-agents-api-harness-guidance.md).

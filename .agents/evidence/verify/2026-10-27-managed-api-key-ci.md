# Verification: Managed API-key supported CLI CI acceptance

- Date: 2026-10-27
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/202.
- Result: PASS for the tested implementation and supported CI matrix. Final record-only head is checked again before merge.
- Tested source: d0de2e84faa316b30d5d01dfcc4867ad7f32ea65; CLI package version 0.5.7, no version bump or publication.
- Environment: GitHub Actions Ubuntu, Node 20 and 22.

## What was verified

The repository's complete CI passed for the managed-key implementation, including full unit tests and parity on both supported Node versions. The local baseline transport failures in [the initial evidence](2026-10-27-managed-api-key.md) do not reproduce in this supported CI run; their cause is not claimed to be repaired by the feature.

## Commands run

The [CI workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40465488790) executed locked dependency installation, typecheck, build, full tests and parity coverage on Node 20/22, installer tests, package build, provenance/attribution tests, pinned vendor source replay with a clean diff, npm tarball verification and the actual installed artifact probe. The [Markdown link workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40465488822) and [Express source workflow acceptance](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40465488898) passed as well.

## Results

All seven reported checks passed: Node 20 tests/parity, Node 22 tests/parity, TypeScript check, installer, package build/installed artifact, Markdown links and Express source acceptance. Initial setup regressions and the final private-key response-validation test passed locally before this remote run. Required checks/reviews are not bypassed. The final record-only head is checked through normal CI before merge.

## Cleanup

This CI evidence does not replace real AK/SK-only cloud acceptance. That acceptance, its seven assertions and exact owned-resource 404 cleanup are recorded in the initial evidence. No secret values or raw cloud logs are retained here.

## Problems found

Local transport baseline #201 remains an environment-specific test follow-up. Its observed failures remain recorded; passing remote CI is not a claim that local behavior changed.

## Not verified

No npm publication, standalone SEA binary, Windows ACL matrix, alternate region or separate restricted RAM identity was added. [Python PR #145](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/145) consumes these provider operations and must land after them. Final-head checks and actual merge state are read from the PR itself, not inferred from this file.

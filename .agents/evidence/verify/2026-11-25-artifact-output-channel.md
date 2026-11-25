# Verification: installed artifact error channels in CI

- Date: 2026-11-25
- Result: local artifact checks PASS; new-head remote CI and public release pending.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/273
- Pull request: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/274
- Environment: Linux x64, Node 22.22.2; unchanged independently installed npm
  alpha.1 package and real locally built alpha.1 SEA.

## Failed gate and independent reproduction

The final 1f02eb4 CI run
[45562205617](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45562205617)
passed both Node 20/22 unit and parity jobs, but Build package job 139032733900
failed at the new alias check. The exit-4 assertion passed; the following
stderr-only E8001 assertion received an empty string.

The actual installed npm package reproduced the same checker failure locally with
CI=true and GITHUB_ACTIONS=true. A direct isolated comparison preserved exit 4
in both modes: without CI, stdout was empty and stderr contained E8001; with CI,
stderr was empty and stdout was one JSON object with status=error and code=E8001.
This matches the existing CLI's ambient CI presentation contract. It was a new
verifier channel assumption, not a failed alias parser or SDK bundle.

The maintainer independently reproduced the failure and reviewed the minimum
correction before editing. No product code, dependency, output contract or cloud
operation changed.

## Correction and actual checks

The verifier now runs both modes explicitly. The human case removes all ci and
github_actions keys by case-insensitive key comparison; it requires exit 4,
empty stdout and E8001 on stderr. The machine case sets both CI flags and
requires exit 4, empty stderr, and exactly one parsed JSON object with
status=error and code=E8001. Both retain rejection of syntax-error output.

With the verifier itself launched under CI=true/GITHUB_ACTIONS=true:

- The complete actual installed npm artifact verifier passed, including both
  alias channels, scaffolds, output, PTY cancellation and complete notices.
- The complete real Linux x64 SEA verifier passed through its physical copy
  outside every node_modules ancestor. Managed plan/refusal, both alias channels,
  scaffolds, real PTY cancellation and complete notices passed.
- Owned temporary verifier directories were removed. No cloud resources were
  created. Static SDK loading, the Python 0.5.0a0 pin and product files are unchanged.
- Script syntax, scoped ESLint, hygiene and diff checks passed. The unchanged
  repository-health gate reported 106 passes, 11 existing warnings and zero failures.

The earlier failed CI remains a failure in the record. These local checks do not
replace the next exact-head remote CI/review, five platform copied-executable
checks or independent public alpha.1 readback. Earlier
[dependency isolation evidence](2026-11-25-sea-dependency-isolation.md) remains
unchanged.

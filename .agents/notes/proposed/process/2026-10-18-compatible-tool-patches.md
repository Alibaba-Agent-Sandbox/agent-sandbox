# Decision: Keep supported toolchain patches and accepted cleanup records current
Status: proposed

## Problem

Dependabot PR50/51 contain compatible dev-tool patches, but their independent
CI predates accepted reliability/retirement changes. Already merged decisions
also remain indexed as proposals. Review the actual combined current-main tree.

## Decision

Ordinarily merge Vitest5.0.4 and typescript-eslint8.71.2 into accepted current
main, retaining both lockfile updates. Keep production dependencies, Node20/22,
TypeScript5.9, Commander14 and public APIs unchanged. Move the five previously
merged cleanup/auth/layering/retry/CI decisions to implemented with current links;
preserve every historical evidence/golden byte. Correct current bilingual install entry points and distributed Skill: published CLI v0.3.0 binary assets, unavailable npm metadata, source fallback, and paired Python distribution names/source URLs. No naming change or package release.

## API Design

No runtime contract or source change. Tool patches remain devDependencies.

## Alternatives considered

- Merge unrelated major upgrades: unsupported; PR7/9/10 remain closed.
- Accept stale independent checks as combined acceptance: insufficient.
- Rewrite old evidence: prohibited; add a dated verification record instead.

## Dependencies

https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/50
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/51
Prior accepted PRs6/53/54/56/58; no cross-owner contract change.

## Test Strategy

Lockfile npm ci, full tests/lint/types/build, record/link/hygiene checks, built
standard real-cloud lifecycle and latest Node20/22 hosted checks. Disclose local
baseline environment failures independently of hosted matrix success.

## Acceptance criteria

- Both compatible patches coexist in the reproducible lockfile.
- Existing runtime/artifact and mandatory CI gates pass.
- Accepted decisions indexed correctly; historical evidence remains identical.
- Supersede bot PRs only after the combined change actually merges.

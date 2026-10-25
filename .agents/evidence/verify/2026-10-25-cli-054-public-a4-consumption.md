# Verification: CLI 0.5.4 consumes public Python a4

- Date: 2026-10-25
- Result: PARTIAL — public dependency and locked generation verified; final candidate artifact, new-head remote CI, review and publication pending.
- PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/174.
- SDK source: 100da4661809f91a5d50e2722d1f4a8d4da3b131, immutable v0.4.0a4.

## Dependency and scope

[SDK PR125](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/125) is merged. [Official publication40215483508 attempt2](https://github.com/Alibaba-Agent-Sandbox/python-sdk/actions/runs/40215483508/attempts/2) completed SUCCESS; the earlier metadata-propagation failure remains history. The release owner independently matched all four published artifacts against PyPI metadata and downloaded bytes, then installed public a4 with all extras, checked dependencies, actual imports, corrected docstrings and the reviewed source bytes. These checks establish the public SDK dependency; they do not establish CLI publication.

CLI 0.5.4 now pins matched client/server a4 in generated Python applications, standard scaffolds, MCP requirements, maintained examples and their assertions. Version remains 0.5.4; it has not been publicly released. Existing TypeScript E2B contracts are retained. Historical a3 candidate and a2 public-case receipts are not rewritten.

The same batch suppresses only the obsolete-source error's duplicate capability suggestion and clears the active Express acceptance entry's retired workflow option/result field. Typed known-owned cleanup, unresolved-intent handling and the real default-Docker limitation are documented in the [active source entry verification](2026-10-25-cli-054-active-source-script.md).

## Executed generation and checks

Normal locked-input generation: build the shared exact pin, run vendor:e2b, build again. Standard provenance: 7 PASS. Generated runtime and README both contain a4; no bundled source was hand edited. Existing previous release goldens remain unchanged.

The first full local command stopped at four no-unsafe-finally lint errors in the changed acceptance script. Local Promise rejection handlers now preserve the original cleanup failure within the surrounding cleanup catch, accepting only typed not-found cases. No lint exemption, new cleanup framework or change to the primary launch error is added. The script's targeted lint, node syntax check and diff check pass. The complete local command is rerun after this correction.

## Required remaining gates

Latest full local result and installed candidate receipt; required remote Node20/22, parity, package, actual generated MCP HTTP/auth/catalog and public-a4 Docker wheel checks; independent review; immutable 0.5.4 tag and all five actual platform artifacts; official GitHub/npm publication; fresh public installer readback and developer scenarios.

Earlier all-nine-green source e2102929 consumed a3 and remains accurate history, not a proof of this changed head. The opt-in Express job can skip its actual cloud step; its successful build is not default-Docker Registry acceptance. That full path remains BLOCKED on this Docker-less host.

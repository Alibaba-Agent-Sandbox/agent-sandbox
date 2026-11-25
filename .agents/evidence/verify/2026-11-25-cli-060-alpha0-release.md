# Verification: CLI 0.6.0-alpha.0 preparation

- Date: 2026-11-25
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/270
- Result: PARTIAL — local preparation/consumer checks passed within the bounds below; final pin CI and public CLI release are pending.
- Package under test: @agent-sandbox/cli 0.6.0-alpha.0, based on main c268608d6a3f917c6d07b7feaa24ab54f25e8fdf.
- Environment: Linux x64, Node 22.22.2, npm 12.0.2. No credentials are written into evidence.

## What was verified

The official npm registry initially reported only latest=0.5.10, without next or
0.6.0-alpha.0. The website stable mirror reported v0.5.10. No existing open
release Issue/PR was found before Issue 270 was created. This change prepares a
distinct preview identity for the already merged command contract.

## Commands run

- npm ci --no-audit --no-fund
- npm run typecheck
- npm run lint
- npm run build
- Version-only snapshot regeneration into the new cli-060-alpha0-20261125 batch.
- node scripts/capture-cli-evidence.mjs --command version --out .agents/evidence/cli/cli-060-alpha0-20261125
- Complete npm test with the CI-pinned server/provider fixtures.
- Complete npm test from a detached worktree without an adjacent SDK checkout, inside an independent user/PID/network namespace with loopback enabled and a child reaper.
- Original unknown-host DNS test rerun in the ordinary network namespace.
- npm pack, a separate prefix installation, scripts/check-release-artifact.mjs and the installed local-process Provider contract with mixed --opt/--option/-o.
- make dist-check; node --test tests/install/install.test.mjs; npm run test:standard-provenance; repository health and hygiene.
- After official PyPI readback: the production DockerBuilder default release-wheel selection and digest check; a fresh virtualenv install of the actual generated MCP requirements and the unchanged real HTTP artifact checks in an independent namespace.

## Results

- Locked dependency installation, typecheck, lint and build passed. ESLint has no errors; existing warnings are retained.
- The actual version snapshot passed. The capture ran one case with zero skips.
- The actual installed candidate passed the existing artifact verifier, including current command help, retired-wrapper rejection, OpenAPI scaffold assets, isolated configuration, PTY cancellation, JSON output and complete notices. Installed alias help and the local-process Provider contract passed (15 passes, zero failures, three unsupported-capability skips).
- The first complete local suite reported 4,614 passed, 23 failed and five skipped assertions. Failures affected MCP wire behavior, engine/CubeSandbox/loopback transport and the adjacent current SDK's configuration fixture. This is a failed aggregate run, not a pass.
- The detached namespace run reported 4,633 passed, one failed and eight skipped assertions across 220 files. The single failure was the unknown-host DNS assertion: the network namespace has no external DNS, so the resolver returned Errno -3 instead of the expected Errno -2. The unchanged original test passed in the ordinary namespace (one selected pass; three unselected cases). These runs do not establish a fresh all-green aggregate or eliminate existing skips.
- Initial installer checks passed nine tests and failed the shellcheck prerequisite. After obtaining official ShellCheck v0.11.0 and verifying the release asset's SHA-256, the unchanged installer suite passed all ten tests. Seven standard-source provenance checks and package entry/Skill reference closure passed.
- An initial repository-health scan included temporary CI fixture copies and reported their Python files/local test paths. After moving those owned fixtures outside the checkout, the unchanged health gate reported 106 passes, 11 existing warnings and zero failures. Hygiene passed.
- Before preparing this version, the final PR 269 source head f84ab4a398b04c163007bc178475ebb8d8104550 had successful CI, Docs links, Generated MCP artifact and Express source workflow acceptance runs. Its five CI jobs passed, including both Node test/parity versions and the actual installed npm package. These are inherited-runtime evidence, not exact-head checks for this PR.
- The initial metadata head 344096322027b3b2e1c062754f26273ef8e13b2a passed every remote CI job, including complete Node 20/22 tests and parity, installed package, installer and typecheck, plus Markdown links. [CI run](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45551168017). This head still had the old runtime pin, so its success is not substituted for the final pin's CI.

## Cleanup

No cloud resources, management keys, image registries or deployments were created.
Local test directories and installed candidate artifacts are owned by this run.

## Problems found

The old shared runtime pin was 0.4.0a6. Keeping it would install the unfixed file
upload runtime in newly generated Server SDK applications. The consumer update
was held locally until both 0.5.0a0 distributions returned HTTP 200 from official
PyPI. The immutable SDK tag and public release identify source merge
26d679c3e5f67ac616b65b3db935db803c639be0. The new default retains real Docker
image verification and leaves existing explicit image dependencies under the
author's control.

The runtime consumer edits pass typecheck, build, ESLint (zero errors),
health/hygiene and 229 focused generator/template/wheel assertions. Their packed
and independently installed CLI passes the complete installed-artifact verifier
again and generates the exact client/server requirements for their respective
roles. The final local npm candidate SHA-256 is
4ed13acae2a3be81255a05812edf2473cac87b7ba77471d447c66925431b2d0a;
the eventual published artifact has its own independent verification gate.

An early MCP rehearsal used a fixed archive of SDK PR 174 source
cde406277a336c40c447939e732881c5a1d15cf3 in a separate fresh virtualenv. The actual
CLI candidate's generated app passed real isolated HTTP authentication,
initialize, 15-tool catalog and schema checks. Client metadata was 0.5.0a0 and
the Server SDK distribution was absent. Its owned process stopped and it made
zero cloud requests. This source rehearsal is separate from the subsequent
independent public-package installation.

After publication, production DockerBuilder.injectSdkWheel with no source or
version override selected agent_sandbox_server-0.5.0a0-py3-none-any.whl. Its
SHA-256 2c1ceed013d0f361f9ccb7b19339315ed25e89a8e5623a69e07d10e3080f5e4d
matched official PyPI metadata. Its temporary build context was removed.

A different, previously empty virtualenv installed the generated requirements
from official PyPI. The same real HTTP MCP checks passed: absent/wrong tokens
were rejected, initialize and all 15 tool schemas/catalog passed, installed client
metadata was 0.5.0a0 and Server SDK metadata was absent. The owned process stopped;
no cloud requests or resources were created. This proves public generated-client
consumption, not execution of every tool against a cloud Sandbox.

## Not verified

No CLI npm package or CLI GitHub prerelease has been published by this change.
Docker is unavailable in this local environment; the existing real server image
workflow using v0.5.0a0 remains a required remote consumer gate. Five-platform
binaries, public CLI registry installation, dist-tags and final exact-head
CI/review remain release gates. The runtime's scoped existing real-component
verification does not establish all Providers, complete OpenAPI support or a
production SLA.

# Verification: Provider runtime onboarding

- Date: 2026-11-05
- Change: provider-runtime-onboarding documentation
- Result: PASS (documentation and installation scope)
- Baseline: b77b75d91617483bc088f28b8eaecf74cbea711a
- Scope: English/Chinese provider and binary installation guides, plus repository-owned documentation records.
- Environment: Linux x64; Node.js 22.22.2. No credentials required for document checks.

## What was verified

Source inspection confirms that the standalone CLI bundles Node, while the Python
engine client locates ABX_BIN or an abx executable on PATH. The Python registry
installer uses verified archives; the CLI examples in this guide use Git sources.
The OpenSandbox provider defaults to the local service URL without an export.

## Commands run

- `npm ci` — exit 0, installed the lockfile development toolchain. npm reported two blocked dependency install scripts; no product build was needed for this documentation change.
- `bash scripts/check-repo-health.sh --quiet` — exit 0 after dependency installation; 106 checks passed, 11 pre-existing advisory warnings, no failures. The first attempt reported the missing local development toolchain, resolved by `npm ci`.
- `npm run check:hygiene` — exit 0.
- `git diff --check` — exit 0.
- The published shell installers, standalone binary and Python provider commands were exercised independently in a fresh HOME and a PATH with no Node/npm/Git/abx. The detailed SDK installation record is linked below.

## Results

| Check | Result | Notes |
|---|---|---|
| CLI and Python source inspection | PASS | Installation methods and engine reuse checked against current source |
| Documentation health/hygiene | PASS | Repository health and hygiene checks passed; existing advisory warnings retained |
| GitHub and website shell installers | PASS | Actual independent Linux x64 installations of published CLI 0.5.8, with checksums verified |
| Python registry installation and engine handshake | PASS | Published SDK 0.4.0a6 installed OpenSandbox 0.5.1, default verification passed, two doctor processes reused one engine |

## Cleanup

No cloud resources were created. Only the independently verified task-owned engine was
stopped; its runtime token record and log were removed. Existing user engines were not touched.

## Problems found

The former text made setting the default URL appear mandatory. It now describes the
default and override separately. A proposed opensandbox pip extra is not published and
is not recommended as an available command.

## Not verified

No real OpenSandbox lifecycle, remote cloud operation, cross-platform run or complete
SDK performance comparison is claimed. The earlier minimal forwarding experiment is
not an actual provider benchmark and is not published as a performance promise.

## Installation evidence

The standalone Linux x64 binary's SHA-256 was independently checked against the official
release checksum: `69a55b0486acb1c8dcb85ef1277984a800ba946778c3cec5b009691a32212802`.
The website installer produced the same binary. ABX_BIN selected its absolute path without
adding abx to PATH. No user credentials were used. A preliminary test omitted mkdir from
its restricted installer PATH and failed before installation; correcting the test's PATH
allowed the unchanged installer to pass.

The canonical [SDK verification record](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/.agents/evidence/verify/2026-11-05-provider-runtime-setup.md)
contains the detailed command and SDK results. This record covers the CLI-owned guide
changes and independent installer readback, not a new provider runtime implementation.

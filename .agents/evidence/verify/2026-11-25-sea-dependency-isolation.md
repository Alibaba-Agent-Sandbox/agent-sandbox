# Verification: standalone managed SDK dependency isolation

- Date: 2026-11-25
- Result: PARTIAL — scoped checks below passed; full CI/platform/public delivery remain pending.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/273
- Base: cbe97429c1bbb43d9ae31247f178dcbee73dc896.
- Environment: Linux x64, Node 22.22.2; locked dependencies reused without changes.

## Reproduction and boundaries

A real alpha.0 executable was copied outside the checkout into a directory whose
complete real ancestor chain had no node_modules. Node injection settings and
credentials were absent from its environment. deploy --help failed with exit 1
and Cannot find module @alicloud/openapi-core. The binary SHA-256 was
6af4029e7aaf202bf817b0b609069503e10a4c7b96e141817d5f66ecaa9459f5.
Its owned temporary directory was removed.

The earlier five-platform workflow successes remain historical workflow results;
they did not establish standalone independence. Alpha.0 npm publication was
cancelled and its GitHub release withdrawn to draft by the maintainer. The tag
and failed assets remain immutable evidence, not a completed release.

## Local checks

- Current NodeNext compiler: both import-equals and the existing literal-require
  branch pattern passed actual ESM execution and isolated esbuild CJS execution.
  All five packages were present in the bundle metafile, and evaluation markers
  verified credential/STS remained lazy. No cloud request was made.
- Chosen minimum: existing literal-require branches, two adapters/seven calls.
- Typecheck and build passed.
- Four SDK regressions passed: attribution, original lazy adapters, actual managed
  CJS closure/lazy evaluation, and compiled npm ESM registry/FC constructors.
- New alpha.1 version snapshot and actual capture passed; historical batches stay
  unchanged.
- A real alpha.1 Linux x64 SEA was built locally. The complete updated artifact
  verifier passed through its copied executable: version/help, target-first API,
  scaffolds, aliases, isolated configuration, managed plan/early refusal, real PTY
  cancellation and complete licenses. The owned copied directory was removed.
- The first health scan rejected a reused node_modules symlink. It was not
  committed, but the first task commit was made before resolving this local
  prerequisite. The symlink was replaced with an independent npm ci from the
  unchanged dependency lock. The unchanged health gate then passed with 106
  passes, 11 existing warnings and zero failures; no gate was disabled.
- With that independent installation, typecheck/build and 96 SDK/deploy/template/
  alias checks passed. A freshly rebuilt real SEA (SHA-256
  a335a3316ffd105760d51e55867c1ae57a634de00773c1a4d471376c2d2ba995)
  passed the entire copied-body verifier again. The Python PTY prerequisite probe
  now uses the same isolated environment/cwd as the other invocations.

## Supported managed boundary

The copied executable is tested for a valid managed plan preview and controlled
build/deploy guidance without owned journal/build writes or credentials/cloud
effects. Remote source acquisition can still cache input before identifying a
profile. Actual component loaders and runners remain external filesystem/Node
contracts. This fix does not claim a complete standalone managed FC lifecycle.

## Cleanup and remaining gates

PoC and negative-control temporary directories were removed. No cloud resources
were created; the verified Python 0.5.0a0 consumer pin remains unchanged. Complete
local results, exact-head remote CI/review, five actual copied platform binaries
and independent public alpha.1 readback remain release gates.

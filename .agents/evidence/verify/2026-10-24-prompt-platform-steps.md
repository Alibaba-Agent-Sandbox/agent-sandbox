# Verification: prompt platform steps

- Date: 2026-10-24
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/128
- Result: PARTIAL (verification in progress)
- Package: candidate @agent-sandbox/cli 0.4.12, compiled source
- Environment: Linux, real Alibaba Cloud Express; credentials supplied through environment, values omitted.

## What was verified

The developer journey first reproduced rejected detach and missing Docker using
published 0.4.11. Each later attempt uses fresh model generation, without editing
the generated application. Failed attempts remain failures, not successful retries.

## Commands run

```sh
npm ci
npm run typecheck
npm run build
npm test
abx create --prompt '一个支持 pandas 和 matplotlib 的 Python 数据分析环境' --yes --detach --build steps --timeout 900
```

## Results

- Focused generation/provider/snapshot suite: 366 passed.
- Initial full suite: 4245 passed, 10 failed, 51 skipped. The same 10 TCP/TLS/WS
  cases fail on clean base 07bcab4 in the same managed environment (18 other cases
  in those three files pass). No transport code or test expectations were changed.
- Packaged Skill validation: passed.
- Candidate 1: model emitted malformed multiline YAML, rejected before cloud creation.
- Candidate 2: model guessed base:latest; remote function creation failed. Generation
  now receives the provider's concrete image and validates exact preservation.
- Candidate 3: fixed image reached remote build; apt installation failed under the
  default unprivileged build user. Guidance now uses existing ordered USER/RUN/
  WORKDIR steps and restores the runtime user with writable workspace ownership.
- Candidate 4: total 695.76 seconds, including about 600 seconds of build waiting;
  last state building, then E7011. Exact template deletion and NotFound were verified.
  The model pinned pandas 2.1.4 and matplotlib 3.8.2. An independent run on the same
  v0.0.49 base reports Python 3.13.13; official PyPI metadata has no cp313 wheels for
  these pins. This is a confirmed compatibility risk, not proof of the unseen
  remote build's precise bottleneck. Guidance now selects compatible binary wheels.
- Candidates 5–7: no cloud resources. Respectively missing manifest, incomplete
  auxiliary Dockerfile, and malformed steps arguments were rejected. Native Qwen
  logs show successful API responses; candidate 6 also had a tool response rejected
  for token truncation. The Dockerfile omission preceded that truncation. Guidance
  now scopes COPY restrictions to steps and builds encoded manifests in one local
  script, with explicit file/AST/JSON checks. No acceptance guard was relaxed.
- Original black-box suite: 168 passed, 8 failed, 8 skipped. Seven failures exposed
  stale fixtures; one used an old deployed application with HTTP 502. The rerun uses
  a fresh owned Ready python-hello template and preserves exact cleanup verification.
- Exact cleanup regression: 58 passed; latest combined generation regression: 158 passed.
- Typecheck/build pass, lint has zero errors, repository health PASS=105/FAIL=0,
  packaged Skill validator and npm entry/reference closure pass.
- Black-box rerun with current owned fixture: 175 passed, 1 failed, 8 skipped.
  The remaining generic scaffold check expected a Docker CMD, whereas strict v4
  explicitly starts that scaffold through workflow exec/start_cmd. After checking
  the schema, source history and existing unit contract, the fixture verifies that
  explicit startup and COPY instead. Its capability rerun passes all seven checks.
- Final official black-box suite: 176 passed, 0 failed, 8 skipped in 304.5 seconds.
  Two owned sandboxes were cleaned up; no leaked sandbox or unresolved creation
  remained. The exclusive fixture was deleted and exact template info returned NotFound.
- Independent review found automatic wheel injection could override the new exact
  alpha requirement using the CLI version. Supported explicit server pins now skip
  automatic download; an explicit source override still builds and injects its wheel.
  Docker builder regression: 40 passed; typecheck passed.
- PR 129 initial remote Node 22, Typecheck, Installer, Markdown and real-Docker
  checks passed; latest-head CI and final model/cloud/API/CLI acceptance remain in progress.
- The next generation run explicitly uses qwen3.8-max rather than coder-flash;
  this is an independent model experiment, not a claim that flash became reliable.

## Cleanup

Candidates 2 and 3: exact owned template delete followed by exact info NotFound.
Candidate 1 created no cloud resource. No account-wide deletion was used.

## Problems found

See Issue 128. Application generation remains model-dependent and requires review;
no automatic repair or silent mutation of the model artifact is introduced.

## Not verified

Final cloud result and normal remote CI are pending. Local transport test failures
remain recorded and are not treated as passes.

## Additional model observation

The first qwen3.8-max attempt reached the existing 600-second generation limit
after writing four files, passing 46 local self-checks and correcting its own CSV
parser. It had not returned a final result, so the command failed and created no
cloud resources. A fresh attempt uses the documented
`ABX_QWEN_CODEGEN_TIMEOUT=1200`; the cloud build wait remains 600 seconds.
This explicit configuration experiment does not change either default timeout.

Candidate 9 generated README examples contained an unsupported `--input` option
and a fictitious synchronous SDK application call. The artifact is preserved.
The guide now teaches `--json-args` and provider-owned application bindings with
separate gateway/application authentication, and limits README examples to the
verified CLI/HTTP surface. Guide regression: 13 passed, 6 environment-dependent
server-package cross-checks skipped; fresh generation must review the README too.

## Candidate 9 and controlled dependency diagnosis

Candidate 9 generated normally in about 356 seconds, but cloud build polling
reached its unchanged 600-second budget while still building (956.65 seconds
total). Its exact owned template was deleted and NotFound verified; no sandbox
was created. Manifest-embedded commands.py exactly matched the generated file.

On an independent owned base sandbox with the standard client's verified root
identity, the exact dependency RUN timed out after 315 seconds while downloading
the pandas 12 MB cp313 wheel. A fresh controlled comparison installed numerical
packages using the base's configured index in 46.709 seconds, then installed the
server alpha from official PyPI in 15.615 seconds. The runtime user successfully
imported the packages and rendered a plot. Both diagnostic resources were cleaned
and exact absence verified. This identifies a dependency-download problem in the
controlled runtime experiment, not the unseen build backend's sole root cause.

The development candidate guide had over-applied the official-index requirement.
The narrow correction leaves ordinary dependency indexes configurable and keeps
only the separate server alpha install on official PyPI; no mirror is hardcoded.
All 20 configured guide regressions pass. Latest remote CI at 2c9e0f2 passed all
seven jobs. A fresh generation remains necessary for final cloud acceptance.

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
- Final cloud/API/CLI and repository gates: in progress.

## Cleanup

Candidates 2 and 3: exact owned template delete followed by exact info NotFound.
Candidate 1 created no cloud resource. No account-wide deletion was used.

## Problems found

See Issue 128. Application generation remains model-dependent and requires review;
no automatic repair or silent mutation of the model artifact is introduced.

## Not verified

Final cloud result and normal remote CI are pending. Local transport test failures
remain recorded and are not treated as passes.

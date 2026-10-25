# Verification: CLI environment guidance

- Date:2026-10-25
- Result:PARTIAL — actual public help, source/syntax and local document/health/hygiene checks PASS; latest PR gates/review pending at preparation.
- Baseline:6d6b8e4306b452b12bc59ea7aefbcd1c8c558e3e; installed public standaloneCLI0.5.6.
- Scope:English/Chinese environment guides, changelog and owner records only. No runtime, generated standard source, version, dependency or historical evidence changes.

## What was verified

The pinned standard dispatcher routes Express create/connect/exec to its retained standard implementation. Standard create supplies env only to its terminal; detached creation has no terminal. Standard exec renders its command through /bin/bash -l -c; the native CommandsModule instead directly executes simple commands and detects unquoted shell operators. The actual source of sandbox system env runs commands.run("env") and filters sensitive names, while abx run calls the application's HTTP command API.

Source inspection targets:src/standard_cli/dispatch.ts, the retained createCommand/buildCommand/Commands.start implementation in src/standard_cli/runtime.mjs, src/api/commands.ts, src/cli/commands/sandbox_system.ts and src/cli/commands/sandbox.ts. None are modified.

## Commands and results

- Official standaloneCLI0.5.6 SHA256:f7d900762660f49863bcb4749f1bb1f7b328d996b643a446868e2d3a36a2ac81. The [safe help receipt](2026-10-25-cli-environment-guidance-public-help.json) records8/8PASS for version, standardExpress create/connect/exec, system env, named run, template launch and OpenSandbox exec help. All8shared one newly isolated batch HOME outside the checkout with no account/model credentials. All exited0 without cloud work.
- Shell syntax:8/8bash blocks PASS under bash -n after replacing the explicitly documented sandbox-ID placeholder; these remote commands were not executed against a sandbox for this docs task.
- The SDK's existing authenticated application methods were actually exercised against a real local HTTP server using public client/server6 in [SDK136's immutable original receipt](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/8959e4ff553a2a986944bf17b38c0d44a2bbb204/.agents/evidence/verify/2026-10-25-environment-variable-local-http.json). It includes wrong-token rejection, filtering, typed set/readback, independent owned local PID absence and2pre-ready protocol resets. Its separately retained first failure remains unchanged. This CLI change reuses that scope and does not claim another local HTTP or cloud run.
- No matching CLI environment documentation Issue was found in the existing Issue search; cross-repository refs are retained.

## Cleanup and limits

No sandbox, template, remote process or cloud resource was created. All8published help subprocesses exited and their isolated temporary HOME was removed. Actual application startup, terminal sessions, cross-provider PATH inheritance and cloud shell behavior are not newly tested here. Those source-backed distinctions are not a new universal runtime guarantee. No model or full-template-matrix claim is made. Required latest-head remote CI and independent review are pending.

## Local document gates

- `bash scripts/check-repo-health.sh --quiet`:106PASS/11existingWARN/0FAIL, including relative links, record shape and content checks. Existing locked TypeScript5.9.3 was reused via read-only hardlinks for this gate; no dependency installation or whole node_modules symlink.
- `make hygiene` and `git diff --check`:PASS.
- Shell blocks are identical across both languages and syntax-check8/8; introduced SDK guide fragments resolve against the exact merged SDK136 source.
- No new unit tests mirror this prose; local full make-ci is not claimed. Normal six applicable CLI PR checks, including Node20/22, typecheck/lint, build/installer and Markdown links, remain required.

An auxiliary configured-secret verifier was corrected after it iterated configuration names rather than credential values. The corrected check selected actual configured credential values and rescanned all7scoped files with0matches; repository hygiene and the commit hook are independent checks and were not altered. This verifier correction is not a product defect or cloud result.

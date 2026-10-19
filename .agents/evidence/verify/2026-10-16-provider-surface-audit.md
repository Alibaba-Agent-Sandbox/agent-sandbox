# Verification: provider registration is not complete CLI coverage

- Date: 2026-10-16
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40
- Result: PARTIAL
- Environment: final standalone executable, real catalog OpenSandbox manifest, isolated temporary HOME; no backend request.

## What was verified

The real OpenSandbox plugin was installed with --link --yes into a temporary HOME. Provider info advertises sandbox.pause, but invoking --provider opensandbox sandbox pause with a placeholder id fails at command parsing (exit 2, No such command); its native sandbox help contains neither pause nor resume. Installation was removed in finally. This is direct evidence that metadata registration does not connect every CLI operation, not a live OpenSandbox success test.

The native non-Express connect path is still a line REPL; Express's standard frontend uses a real PTY. Both differences remain unresolved architectural gaps. Updated bilingual feature tables stop promising nonexistent generic timeout/code/url commands or universal Express capabilities. Typed provider-command registration can supply namespaced management handlers, but does not automatically adapt these existing command paths.

## Check correction

Earlier provider-boundary records incorrectly described full TypeScript typecheck as passing. Production build and targeted Vitest tests passed, but the new test invoked _doDeploy without its required acr_namespace field. Complete remote jobs on 17f4844 failed this same TS2345 precheck before executing their test stages. The test fixture now passes a placeholder namespace. Runtime source and final standalone SHA256 remain unchanged. The corrected complete npm typecheck must be inspected before claiming PASS. Earlier evidence is preserved as history, not silently rewritten.

## Results and remaining work

Source fixes prevent the audited implicit cross-provider paths, and final standalone ownership checks pass. The overall Provider abstraction is not fully clean: generic operation coverage, a unified frontend-to-provider mapping and runtime/account/template condition discovery remain incomplete. The registration work in https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35 and https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38 remains independent, draft and unmerged. No merge/full-acceptance claim is made.

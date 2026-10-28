# CLI capture: Precise onboarding recovery

Date: 2026-10-28. Actual packed/installed candidate derived from the reviewed source. Fresh isolated home, no cloud credentials; no cloud submission. Prior captures remain unchanged.

## Noninteractive missing authentication

Command: `abx --native create base -y`

Exit: 1

stdout:

```text

```

stderr:

```text
Missing configuration for Generate, deploy and create sandbox. Configure one authentication method: sandbox_api_key; or access_key_id + access_key_secret. Run 'abx config set providers.alicloud-express.sandbox_api_key' in a terminal, or configure the alternative credentials. Get your Sandbox API key: Agent Sandbox console > Express > API Keys, in the selected region. https://help.aliyun.com/zh/agent-sandbox/getting-started/create-api-key No cloud operation was submitted.
```

## Actual terminal checks

Command: `ABX_BIN=INSTALLED_ABX node e2e/onboarding.mjs`

Exit:0. The harness uses real POSIX terminals and asserts the actual decline and Ctrl-C output contains `Aborted!`, has no preparation failure or recovery journal, and records no resource intents. Ctrl-C also restores terminal echo/canonical mode. The following are the harness's actual summary lines; they are not a reconstructed full screen transcript.

```text
PASS: actual terminal creates a selected project, reaches configuration setup and cancels before cloud submission
PASS: actual terminal decline preserves the original file
PASS: actual terminal confirmation replaces selected entries and keeps unrelated data
PASS: actual hidden input restores the terminal on Ctrl-C without echoing or saving the partial key
PASS: platform configuration saves by default, application authentication is automatic and creation consent is preserved
PASS: Ctrl-C at creation consent exits as cancellation and restores the terminal without resource intents
PASS: real TTY plus JSON, CI, quiet and -y never asks for configuration
PASS: real TTY stdin/stderr with stdout piped never prompts and preserves one JSON document
```

# Decision: Show install progress and use terminal selection menus

Status: implemented

## Problem

The shell installer hides transfer activity for large binaries. Guided configuration asks terminal users to type numbers for finite choices. Template preparation, backend references and PTY capabilities also need separate explanations.

## Decision

Use curl's progress bar only for the binary transfer when stderr is a terminal, including when the installation script arrives over stdin. Keep metadata/checksum transfers and redirected stderr quiet. Preserve retries, HTTP status capture, checksum verification and atomic installation.

Add a shared typed select prompt using the existing Inquirer library on real terminal input, with numbered input on scripted streams. Apply it to configuration scope, authentication selection in guided setup/config init/provider init, and missing-build project recovery. Keep the existing scaffold arrow picker. Preserve safe defaults, Ctrl+C cancellation, hidden secrets and command-level CI/JSON/quiet/yes gates. Explain template source recipes, registered backend references and terminal capabilities in both languages. Publish CLI 0.4.9 so installed users receive the menus; refresh the website's reviewed installer through its existing delivery workflow.

## API Design

`select<T extends string | number>(text, {choices: {name,value}[], default, err?}): Promise<T>` is a project CLI helper. No standard generated source, provider protocol, cloud API or template capability contract changes. Installer controls and exit semantics are unchanged.

## Alternatives considered

- Keep numbered terminal input: fails the requested interaction.
- Add a native PTY dependency: unnecessary; the existing prompt library is cross-platform.
- Show animated progress in every log: produces noisy redirected/automation output.
- Add `terminal` to template YAML to bypass missing PTY: declaration cannot implement a server/provider protocol.

## Dependencies

Existing curl, POSIX sh and @inquirer/prompts. Python's POSIX PTY module is used by tests and installed-artifact verification, not the product. Issues [114](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/114) and [115](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/115). Website delivery is owned by [website](https://github.com/Alibaba-Agent-Sandbox/website).

## Test Strategy

Actual curl against a delayed local HTTP release with script stdin piped and stderr on a real terminal; redirected output and existing failure/checksum tests. Real Node/Inquirer terminal key input plus scripted selections. Exercise the installed executable's deploy menu and cancel before credential input or cloud operations. Required type/lint/build/full CI, record/link/hygiene checks and post-delivery public readback. Source and local tests alone do not establish release publication.

## Acceptance criteria

- Binary progress reaches a measured 50% and 100% with terminal stderr and piped stdin; no animation in redirected logs.
- Up/Down/Enter and Ctrl+C work; scripted input/defaults and cancellation remain safe.
- Cancel in the installed CLI starts no deployment and writes no user credentials.
- English/Chinese docs distinguish template preparation from PTY.
- Latest-head CI, release/npm and public installer delivery are verified before claiming publication.

## Evidence

[Verification](../../../evidence/verify/2026-10-23-terminal-install-prompts.md).

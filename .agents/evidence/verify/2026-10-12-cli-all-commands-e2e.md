# Verification: every ebx command, black-box

- Date: 2026-10-12
- Process: `EBX_BIN="/workspace/cli/node_modules/.bin/tsx /workspace/cli/src/bin/ebx.ts" node e2e/run.mjs --suite all-commands`
- The runner's cwd is an isolated temp dir, so the binary is `tsx` on `src/bin/ebx.ts` by absolute path (the same process `npx tsx src/bin/ebx.ts` starts). No handler imports. `cli/src` was not modified.
- Version printed: `ebx, version 0.3.0`
- Credentials were present in the parent environment and were not passed to the child (`creds: false`, isolated HOME). No sandbox was created.

## Walk

`ebx --help` then `--help` on every command in each `Commands:` section, plus `provider` (hidden from root help until a provider is installed). `config check` and `config migrate` stay hidden on a fresh HOME and are not in `config --help`, so they are outside this tree.

| | count |
|---|---:|
| Commands walked (root, groups, leaves) | 77 |
| `--help` exit 0 and usage names the command | 77 |
| Safe local invocation | 77 |
| Failures | 0 |

Safe invocations: `config get region`, `config set http_timeout 45`, `config list`, `config init --yes` on an isolated HOME; `provider list`, `provider default`, `provider doctor`, `provider update`; `init` and `template init python-case --template python` into a temp dir (Dockerfile, commands.py, template.yaml written); `mcp --help`, `mcp status`, `mcp stop`. Groups with no subcommand exit 2 and print usage. Leaves with a required argument omit it (exit 2, `Missing argument`). `create` / `kill` exit 2 on the local usage error. `mcp install` exits 2 on missing `--target`. `mcp start`, `list`, `template list`, `deploy`, and the other no-argument cloud commands were given `--not-an-ebx-option` (exit 2, `No such option`) so the callback never ran. No command failed, so there is no failure output to record.

## Suite counts

| Suite | pass | fail | skip |
|---|---:|---:|---:|
| all-commands | 1 | 0 | 0 |
| leak-check (all-commands run) | 0 | 0 | 1 |
| offline | 51 | 0 | 0 |
| capability | 7 | 0 | 0 |
| leak-check (offline,capability run) | 0 | 0 | 1 |

`node e2e/run.mjs --suite offline,capability` exit 0. Summary: 58 pass, 1 skip. Sandboxes created=0, leaked=0. Both suite runs exit 0.

## Commands walked

(root), config, config delete, config get, config init, config list, config set, connect, create, deploy, download, exec, info, init, install, kill, list, mcp, mcp deploy, mcp install, mcp start, mcp status, mcp stop, run, sandbox, sandbox capabilities, sandbox connect, sandbox create, sandbox download, sandbox exec, sandbox files, sandbox files list, sandbox files mkdir, sandbox files mv, sandbox files rm, sandbox files search, sandbox files stat, sandbox info, sandbox kill, sandbox list, sandbox process, sandbox process info, sandbox process list, sandbox process signal, sandbox process start, sandbox run, sandbox shell-stream, sandbox system, sandbox system env, sandbox system info, sandbox system metrics, sandbox system packages, sandbox system ports, sandbox upload, template, template build, template create, template delete, template deploy, template info, template init, template install, template list, template push, template search, upload, provider, provider config, provider default, provider doctor, provider info, provider install, provider list, provider show, provider test, provider uninstall, provider update.

# Verification: OpenSandbox through the provider abstraction (TS CLI and Python SDK)

- Date: 2026-10-13
- Question: is the provider abstraction (EPP/1 exec plugins, `abx-provider.toml`, installer from a git URL, doctor, contract kit) enough to use a real third-party backend, here OpenSandbox?
- Verdict: yes. Every core operation worked against a real server, from both the TS CLI and the Python SDK. The gaps found are listed under "What did not work".

## Environment

| Item | Value |
|---|---|
| OpenSandbox server | `opensandbox-server` 1.1.1 from PyPI, Docker runtime, `127.0.0.1:8080`, API key `local-dev-key` (not a secret). Started with `python-sdk/e2e/opensandbox/local-up.sh up` |
| Docker | 29.1.3 (`docker.io`), images `python:3.12-slim`, `opensandbox/execd:latest`, `opensandbox/egress:v1.1.7` |
| Plugin | `awesome-providers` catalog, `opensandbox/` directory (Node plugin, `runtime.kind = "exec"`) at commit `c14a072` plus one local commit `c410c32` ("abx rename"). The remote catalog still ships `ebx-provider.toml`, so a plain `provider install alibaba-agent-sandbox/awesome-providers//opensandbox` fails with E8014 (first run, before the hint existed: `[E8014] Invalid abx-provider.toml: file not found at the plugin root.`). The patch is `cli/e2e/providers/awesome-providers-abx-rename.patch` (27 files, 184 lines changed, pure rename of the manifest, `EBX_*` to `ABX_*`). The patched checkout was used through `file://` with `--allow-insecure-transport` |
| TS CLI | `/workspace/cli` at the commit that contains this file (`tsx src/bin/abx.ts`), fresh `HOME=/tmp/e2e/home2`, `env -i` |
| Python SDK | `/workspace/python-sdk/client-sdk/src`, fresh `HOME=/tmp/e2e/pyhome2` |
| Config | only `ABX_OPENSANDBOX_BASE_URL=http://127.0.0.1:8080` and `ABX_OPENSANDBOX_API_KEY=local-dev-key` (no alicloud credentials in the environment) |

## 1. TS CLI: install, list, doctor, contract kit

Commands run as `abx <args>`; `<ref>` = `c410c3261381a56afca212d26ef59a065ab52c27`.

```text
$ abx provider install file:///tmp/e2e/ap-abx --subdir opensandbox --allow-insecure-transport --yes
[E8012] Refusing an unpinned git source without review (--yes does not accept a moving ref).
  Suggestion: Pin it: --ref c410c3261381a56afca212d26ef59a065ab52c27 (or --sha256 <digest>); or pass --allow-unpinned to accept the current head.
[exit 2]

$ abx provider install file:///tmp/e2e/ap-abx --subdir opensandbox --ref c410c3261381a56afca212d26ef59a065ab52c27 --allow-insecure-transport --yes
Installed provider 'opensandbox' 0.1.0 (pinned)
[exit 0]

$ abx provider list
┏━━━━━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━┓
┃ ID         ┃ Name       ┃ Version ┃ Kind    ┃ Trust   ┃ Features   ┃ Default ┃
┡━━━━━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━┩
│ alicloud-… │ Alibaba    │ 0.3.0   │ builtin │ builtin │ sandbox(l… │ yes     │
│            │ Cloud      │         │         │         │ exec(run,… │         │
│            │ Express    │         │         │         │ process(m… │         │
│            │ Edition    │         │         │         │ pty        │         │
│            │            │         │         │         │ files(rw,… │         │
│            │            │         │         │         │ code(inte… │         │
│            │            │         │         │         │ templates… │         │
│            │            │         │         │         │ ports(url… │         │
│            │            │         │         │         │ storage(m… │         │
│            │            │         │         │         │ network(v… │         │
│            │            │         │         │         │ sessions   │         │
│ opensandb… │ OpenSandb… │ 0.1.0   │ exec    │ pinned  │ sandbox(l… │         │
│            │            │         │         │         │ exec(run,… │         │
│            │            │         │         │         │ process(m… │         │
│            │            │         │         │         │ files(rw)  │         │
│            │            │         │         │         │ ports(url) │         │
│            │            │         │         │         │ sessions   │         │
└────────────┴────────────┴─────────┴─────────┴─────────┴────────────┴─────────┘
[exit 0]

$ abx provider doctor opensandbox
ok    installed  OpenSandbox 0.1.0
ok    integrity  60c6997a1b94ece7
ok    config
ok    handshake
[exit 0]

$ abx provider test opensandbox
passed  test_declared_features_are_known
passed  test_describe_never_exposes_secret_defaults
passed  test_lifecycle
passed  test_kill_is_idempotent
passed  test_set_timeout
passed  test_pause_resume
passed  test_exec_run
passed  test_exec_exit_code_stderr_and_env
passed  test_exec_stream_order_and_single_exit
passed  test_exec_timeout_is_enforced
passed  test_process_list
passed  test_files_roundtrip
passed  test_files_binary_and_unicode
passed  test_files_directory_operations
passed  test_missing_file_is_a_typed_not_found
passed  test_ports_url
passed  test_undeclared_feature_fails_with_e8004
passed  test_secret_options_are_redacted_from_errors
18 passed, 0 failed, 0 skipped
[exit 0]
```

The Features column is cut by the 80-column table renderer of a non-terminal; at 160 columns the same list reads:

```text
ID               Version Kind    Trust   Features
alicloud-express 0.3.0   builtin builtin sandbox(lifecycle,timeout,pause) exec(run,stream) process(manage) pty files(rw,watch,transfer) code(interpret) templates(read,build) ports(url,domain) storage(mount) network(vpc) sessions
opensandbox      0.1.0   exec    pinned  sandbox(lifecycle,timeout,pause) exec(run,stream) process(manage) files(rw) ports(url) sessions
```

## 2. TS CLI: provider info, lifecycle, exec, files, kill, tamper, old plugin name

`ABX_PROVIDER=opensandbox` selects the provider for the lifecycle commands; `provider ...` commands do not need it.

```text
$ abx provider info opensandbox
ID         opensandbox
Name       OpenSandbox (OpenSandbox 开源沙箱)
Version    0.1.0
Kind       exec
Default    no
Trust      pinned
Features   exec.run, exec.stream, files.rw, ports.url, process.manage, sandbox.lifecycle, sandbox.pause, sandbox.timeout, sessions
Config     base_url, api_key (secret), domain, protocol, use_server_proxy, default_image, image_aliases, entrypoint, ready_timeout, registry_username, registry_password (secret), network_policy, platform, secure_access
Inherits   (none)
Source     file:///tmp/e2e/ap-abx @ c410c326… (pinned)
Commit     c410c3261381a56afca212d26ef59a065ab52c27
Digest     sha256:60c6997a1b94ece734c976ed3a170db1e2f03d0abe762f61311e9ca5ea3f56b3
Runtime    node ./provider.mjs
Security   network: * · filesystem: data_dir · spawns processes: no  (declared, not enforced)
Installed  2026-10-13T12:48:49Z
[exit 0]

$ abx -j create --template python:3.12-slim --timeout 600
{
  "ID": "50953498-6542-4e36-9928-3bd3a2f5e7e6",
  "Status": "running",
  "Template": "python:3.12-slim",
  "URL": "epp://opensandbox/50953498-6542-4e36-9928-3bd3a2f5e7e6",
  "provider": "opensandbox"
}
[exit 0]

$ abx info 50953498-6542-4e36-9928-3bd3a2f5e7e6
ID        opensandbox:50953498-6542-4e36-9928-3bd3a2f5e7e6
Template  python:3.12-slim
Status    running
Region    
Timeout   600s
URL       epp://opensandbox/50953498-6542-4e36-9928-3bd3a2f5e7e6
Started   2026-10-13 12:49:26.518486+00:00
Provider  opensandbox
[exit 0]

$ abx list
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━┓
┃ ID                                     ┃ Template         ┃ Status  ┃ Region ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━┩
│ opensandbox:50953498-6542-4e36-9928-3… │ python:3.12-slim │ running │        │
└────────────────────────────────────────┴──────────────────┴─────────┴────────┘
[exit 0]

$ abx exec 50953498-6542-4e36-9928-3bd3a2f5e7e6 echo hello-from-osb; echo err >&2; exit 3
hello-from-osb
err
[exit 3]

$ abx upload 50953498-6542-4e36-9928-3bd3a2f5e7e6 /tmp/e2e/up2.txt /tmp/up2.txt
Uploaded /tmp/e2e/up2.txt -> /tmp/up2.txt
[exit 0]

$ abx upload 50953498-6542-4e36-9928-3bd3a2f5e7e6 /tmp/e2e/up2.bin /tmp/up2.bin
Uploaded /tmp/e2e/up2.bin -> /tmp/up2.bin
[exit 0]

$ abx exec 50953498-6542-4e36-9928-3bd3a2f5e7e6 cat /tmp/up2.txt; wc -c /tmp/up2.bin
payload Tue Oct 13 12:49:26 PM UTC 2026
3000 /tmp/up2.bin
[exit 0]

$ abx download 50953498-6542-4e36-9928-3bd3a2f5e7e6 /tmp/up2.bin /tmp/e2e/down2.bin
Downloaded /tmp/up2.bin -> /tmp/e2e/down2.bin
[exit 0]

$ abx process --help
Usage: abx [OPTIONS] [COMMAND] [ARGS]...
Try 'abx --help' for help.

Error: No such command 'process'. No similar command. See 'abx --help' for the command list (templates: 'abx template init|install'; named commands in a sandbox: 'abx run SANDBOX NAME').
[exit 2]

$ abx sandbox files list 50953498-6542-4e36-9928-3bd3a2f5e7e6 --path /tmp
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━┳━━━━━━┓
┃ Name              ┃ Type      ┃ Size ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━╇━━━━━━┩
│ opensandbox-execd │ directory │ 4096 │
│ up2.bin           │ file      │ 3000 │
│ up2.txt           │ file      │ 40   │
└───────────────────┴───────────┴──────┘
[exit 0]

$ abx sandbox process list 50953498-6542-4e36-9928-3bd3a2f5e7e6
┏━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━┓
┃ PID ┃ Command                                                 ┃ Status  ┃
┡━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━┩
│ 1   │ /bin/sh /opt/opensandbox/bootstrap.sh tail -f /dev/null │ running │
│ 20  │ /opt/opensandbox/execd                                  │ running │
│ 21  │ tail -f /dev/null                                       │ running │
└─────┴─────────────────────────────────────────────────────────┴─────────┘
[exit 0]

$ abx sandbox system info 50953498-6542-4e36-9928-3bd3a2f5e7e6
OS             Linux
Arch           x86_64
Hostname       c231b28e2fbf
CPU_Count      4
Python         3.12.15
Disk_Total_GB  19.52
Disk_Free_GB   10.27
[exit 0]

$ abx sandbox capabilities 50953498-6542-4e36-9928-3bd3a2f5e7e6
Capabilities:
  - code
  - files
  - shell
[exit 0]

$ abx sandbox command run 50953498-6542-4e36-9928-3bd3a2f5e7e6 anything
Unexpected error: this._http_client._createEnvdClient is not a function
  Suggestion: Use 'abx -v <command>' for more details, or report this issue.
[exit 1]

$ abx kill 50953498-6542-4e36-9928-3bd3a2f5e7e6
Kill sandbox 50953498-6542-4e36-9928-3bd3a2f5e7e6? [y/N]: Aborted!
[exit 1]

$ abx info 50953498-6542-4e36-9928-3bd3a2f5e7e6
ID        opensandbox:50953498-6542-4e36-9928-3bd3a2f5e7e6
Template  python:3.12-slim
Status    running
Region    
Timeout   600s
URL       epp://opensandbox/50953498-6542-4e36-9928-3bd3a2f5e7e6
Started   2026-10-13 12:49:26.518486+00:00
Provider  opensandbox
[exit 0]

$ abx kill 50953498-6542-4e36-9928-3bd3a2f5e7e6
Kill sandbox 50953498-6542-4e36-9928-3bd3a2f5e7e6? [y/N]: Aborted!
[exit 1]

$ abx kill 50953498-6542-4e36-9928-3bd3a2f5e7e6 --yes
Sandbox 50953498-6542-4e36-9928-3bd3a2f5e7e6 killed.
[exit 0]

$ abx info 50953498-6542-4e36-9928-3bd3a2f5e7e6
[E2009] OpenSandbox HTTP 404 (get sandbox): Sandbox 50953498-6542-4e36-9928-3bd3a2f5e7e6 not found.
  Suggestion: Run 'abx list' to see the running sandboxes; a killed or expired sandbox cannot be reconnected.
[exit 4]

$ abx kill 50953498-6542-4e36-9928-3bd3a2f5e7e6 --yes
Sandbox 50953498-6542-4e36-9928-3bd3a2f5e7e6 killed.
[exit 0]

$ abx -j sandbox list
{
  "status": "success",
  "message": "No sandboxes found."
}
[exit 0]

$ abx provider install /tmp/e2e/oldname --yes
[E8014] Invalid abx-provider.toml: file not found at the plugin root.
  Suggestion: This plugin still uses the pre-rename 'ebx-provider.toml'. Rename it to abx-provider.toml and rename its EBX_* variables to ABX_* (the plugin's maintainer must publish the update).
[exit 1]

$ abx provider uninstall opensandbox --yes
Removed provider 'opensandbox'
[exit 0]

$ abx provider list -q
Usage: abx provider list [OPTIONS]
Try 'abx provider list --help' for help.

Error: No such option '-q'.
[exit 2]

$ abx provider install file:///tmp/e2e/ap-abx --subdir opensandbox --ref c410c3261381a56afca212d26ef59a065ab52c27 --allow-insecure-transport
[E8012] Installing a provider requires confirmation.
  Suggestion: Re-run with --yes after reviewing: abx provider install file:///tmp/e2e/ap-abx --ref <commit>
[exit 2]

$ abx provider install file:///tmp/e2e/ap-abx --subdir opensandbox --ref c410c3261381a56afca212d26ef59a065ab52c27 --allow-insecure-transport --yes
Installed provider 'opensandbox' 0.1.0 (pinned)
[exit 0]

$ abx provider doctor opensandbox
ok    installed  OpenSandbox 0.1.0
fail  integrity  Provider 'opensandbox': files changed since install.
[exit 1]

$ abx -j --provider opensandbox sandbox list
{
  "status": "error",
  "message": "Provider 'opensandbox': files changed since install.",
  "code": "E8011",
  "suggestion": "Reinstall or run 'abx provider update opensandbox'."
}
[exit 1]

$ abx provider update opensandbox --check
All providers are up to date.
[exit 0]

$ abx provider uninstall opensandbox --yes
Removed provider 'opensandbox'
[exit 0]

$ abx provider install file:///tmp/e2e/ap-abx --subdir opensandbox --ref c410c3261381a56afca212d26ef59a065ab52c27 --allow-insecure-transport --yes
Installed provider 'opensandbox' 0.1.0 (pinned)
[exit 0]

$ abx --provider opensandbox template init --template python

✅ Template 'python' created in /tmp/e2e/tpl/python
Created files:
  Dockerfile
  README.md
  commands.py
  template.yaml

Next steps:
  abx template deploy /tmp/e2e/tpl/python --acr-namespace <ns>
  abx template install /tmp/e2e/tpl/python --acr-namespace <ns>
[exit 0]

$ abx --provider opensandbox template search python
┏━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┓
┃ Name         ┃ Description             ┃ Tags                     ┃ Status   ┃
┡━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━┩
│ python-hello │ A minimal Python hello  │ python, hello-world,     │ official │
│              │ world template for      │ example                  │          │
│              │ testing                 │                          │          │
│ qoder        │ Qoder AI coding         │ qoder, ai-coding,        │ official │
│              │ assistant runtime with  │ ai-agent, development    │          │
│              │ Python and Node.js      │                          │          │
│              │ integrated dev sandbox  │                          │          │
└──────────────┴─────────────────────────┴──────────────────────────┴──────────┘

2 template(s) found.
Install one with: abx template install <name> (index: https://raw.githubusercontent.com/alibaba-agent-sandbox/awesome-templates/main/awesome-templates.yaml)
[exit 0]

$ abx --provider opensandbox template deploy /tmp/e2e/tpl/python --acr-namespace x
ACR credentials missing.
  Suggestion: Run 'abx config init --build', or 'abx config set access_key_id' / 'abx config set access_key_secret', or pass --acr-username/--acr-password.
[exit 1]

$ abx provider uninstall opensandbox --yes
Removed provider 'opensandbox'
[exit 0]
```

Notes on the output above:

- `abx exec ID "echo hello-from-osb; echo err >&2; exit 3"` returned exit code 3 and both streams.
- The 3000-byte random file uploaded and downloaded byte-identical (`cmp` printed "binary round trip identical").
- `info` after `kill` is `E2009` (exit 4) with the same code as on the built-in provider. Before this change it was `E8005`.
- `Region` is empty and `Timeout` is the real lifetime (600 s requested, 600 s shown). Before this change both showed the built-in platform's defaults (`cn-hangzhou`, `300s`).
- `sandbox capabilities` says `code, files, shell` although the plugin does not declare `code.interpret`: the capability set is not derived from the provider's features (open problem).
- `sandbox command run` failed with `this._http_client._createEnvdClient is not a function`. The Python SDK raises `E8004 'named commands'` for the same call (section 4). The TS guard lives in `src/api/sandbox.ts`, which other work is editing; not changed here (open problem).
- `abx provider install` without `--yes` in a non-terminal printed the re-run hint without `--subdir opensandbox`; fixed in the second commit (the output above is from before that fix).
- Tampering with `provider.mjs` after install: `doctor` reports `integrity ... files changed since install` and every provider command fails with `E8011` before the plugin runs.

## 3. Python: the same install, list, doctor and contract kit (`python -m agent_sandbox.providers`)

```text
$ python -m agent_sandbox.providers install file:///tmp/e2e/ap-abx --subdir opensandbox --allow-insecure-transport --yes
[E8012] Refusing an unpinned git source without review (--yes does not accept a moving ref).
  Suggestion: Pin it: --ref c410c3261381a56afca212d26ef59a065ab52c27 (or --sha256 <digest>); or pass --allow-unpinned to accept the current head.
[exit 2]

$ python -m agent_sandbox.providers install file:///tmp/e2e/ap-abx --subdir opensandbox --ref c410c3261381a56afca212d26ef59a065ab52c27 --allow-insecure-transport --yes
Installed opensandbox 0.1.0
[exit 0]

$ python -m agent_sandbox.providers list
* alicloud-express         0.3.0      builtin  builtin   sandbox(lifecycle,timeout,pause) exec(run,stream) process(manage) pty files(rw,watch,transfer) code(interpret) templates(read,build) ports(url,domain) storage(mount) network(vpc) sessions
  opensandbox              0.1.0      exec     pinned    sandbox(lifecycle,timeout,pause) exec(run,stream) process(manage) files(rw) ports(url) sessions
[exit 0]

$ python -m agent_sandbox.providers doctor opensandbox
ok   installed: OpenSandbox 0.1.0
ok   integrity: 60c6997a1b94ece7
ok   config
ok   handshake
[exit 0]

$ python -m agent_sandbox.providers test opensandbox
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.6.0
rootdir: /tmp/abx-contract-zcnudb23
configfile: pytest.ini
plugins: platformdirs-4.13.0, anyio-4.15.1, httpx-0.36.2, asyncio-1.4.0, cov-7.1.0
asyncio: mode=Mode.AUTO, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collected 18 items

../abx-contract-zcnudb23 ..................                              [100%]

============================= 18 passed in 13.22s ==============================
[exit 0]

$ python -m agent_sandbox.providers install /tmp/e2e/oldname --yes
[E8014] Invalid abx-provider.toml: file not found at the plugin root.
  Suggestion: This plugin still uses the pre-rename 'ebx-provider.toml'. Rename it to abx-provider.toml and rename its EBX_* variables to ABX_* (the plugin's maintainer must publish the update).
[exit 1]
```

## 4. Python SDK: `Sandbox.create(provider="opensandbox")` end to end

Script: `/tmp/e2e/sdk_run.py` (create, refresh_info, exec, 300 KB binary file round trip, unicode text, list, missing file, processes, `network.resolve`, set_timeout, pause, resume, run_code, files.watch, named command, connect, list, bogus provider, kill).

```text
$ python sdk_run.py
create: ('657a2ee3-0cf0-45d7-bac7-04f5e17c7aa0', 'opensandbox', 'running')
refresh_info: ('running', 'python:3.12-slim', '', 300)
capabilities: ['code', 'files', 'shell']
exec: (4, 'hello-sdk\n', 'err\n')
files roundtrip equal: True
files.read: 'héllo\n'
files.list: ['b.bin', 't.txt']
files.exists missing: False
files.read missing ->: ('FileNotFoundError_', 'E4001', '[E4001] OpenSandbox HTTP 404 (stat /nope): file not found. file not found: /nope: lstat /nope: no such file or directory\n  Suggestion: Use f')
processes: [1, 20, 21]
network.resolve(9000): ('http://127.0.0.1:55721/proxy/9000', {})
set_timeout: 'ok'
paused status: 'paused'
resumed status: 'running'
exec after resume: 'alive\n'
run_code ->: ('ProviderFeatureNotSupportedError', 'E8004', "[E8004] Provider 'opensandbox' does not support 'code.interpret'.\n  Suggestion: Run 'abx provider info opensandbox' to see supported feature")
files.watch ->: ('ProviderFeatureNotSupportedError', 'E8004', "[E8004] Provider 'opensandbox' does not support 'files.watch'.\n  Suggestion: Run 'abx provider info opensandbox' to see supported features.")
deploy/run named ->: ('ProviderFeatureNotSupportedError', 'E8004', "[E8004] Provider 'opensandbox' does not support 'named commands'.\n  Suggestion: Run 'abx provider info opensandbox' to see supported feature")
connect: ('657a2ee3-0cf0-45d7-bac7-04f5e17c7aa0', 'running')
list contains: True
create bogus provider ->: ('ProviderNotFoundError', 'E8001', "[E8001] Provider 'nope' is not installed.\n  Suggestion: Run 'abx provider list'; install with 'abx provider install <path-or-git-url>'.")
killed: True
list after kill: []
[exit 0]
```

Notes: `pause` and `resume` worked (`paused`, then `running`, command ran after resume). Unsupported features fail with `E8004` and the text names the provider and the feature. `capabilities: ['code', 'files', 'shell']` is the same capability mismatch as in the CLI (the template is an image name, so the capability lookup falls back to `DEFAULT_CAPABILITIES` and logs a warning; the warning lines were removed from the transcript).

## 5. Templates

`abx --provider opensandbox template init --template python` writes the scaffold used for the built-in provider (Dockerfile `FROM python:3.12-slim`, `commands.py`, `template.yaml`); `abx --provider opensandbox template deploy ./python --acr-namespace x` stops with `ACR credentials missing.` That is the Alibaba Cloud build flow: `template` commands ignore `--provider` and do not check `templates.build`. The plugin does not declare `templates.read` or `templates.build`, so the correct answer would be `E8004`. The create-time template of OpenSandbox is a container image URI (`python:3.12-slim` above), mapped by the plugin (`default_image`, `image_aliases`), not by a `[template]` profile.

## 6. Automated checks run for this change

| Check | Result |
|---|---|
| `npx vitest run tests/test_providers tests/test_cli/test_provider_commands.test.ts tests/test_cli/test_provider_flag.test.ts tests/test_cli/test_provider_regressions.test.ts tests/test_cli/test_config_providers.test.ts` with `ABX_OPENSANDBOX_PLUGIN=/tmp/e2e/ap-abx/opensandbox` | 15 files, 437 tests passed (the OpenSandbox cases run against the plugin's mock server) |
| `pytest tests/test_providers` in `python-sdk/client-sdk` (with `pydantic` on `PYTHONPATH`, needed by the subprocess tests) | 366 passed |
| `ruff check`, `ruff format --check`, `mypy` on `agent_sandbox/providers` and `tests/test_providers` | clean |
| `tsc --noEmit`, `eslint src/providers src/cli/commands/provider.ts tests/test_providers` | clean |

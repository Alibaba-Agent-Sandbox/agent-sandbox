# Differential fast harnesses (2026-10-12)

Oracle: `ORACLE_VENV=/tmp/venv-orig` (`/tmp/venv-orig/bin/abx` present). Commands from `cli/`: `node parity/diff/{sandbox_cmds,sandbox_subcmds,config_cmds,template_cmds,mcp_toolerr}.mjs --fast`. Those five runners do not read `--fast`, so each number is the full suite. Allow-listed means the SDK-defect allow-list (`parity/diff/sdk_defect_allowlist.mjs`). `config_cmds` and `mcp_toolerr` have no allow-list. No source was changed.

| Harness | Total | Identical | Allow-listed | Differing (unexpected) | Exit |
|---|---:|---:|---:|---:|---:|
| sandbox_cmds | 545 cases | 472 | 0 | 73 | 1 |
| sandbox_subcmds | 273 cases | 245 | 0 | 28 | 1 |
| config_cmds | 1408 cases | 1292 | 0 | 116 | 1 |
| template_cmds | 243 cases | 211 | 0 | 32 | 1 |
| mcp_toolerr | 5256 comparisons | 4770 | 0 | 486 | 1 |

`template_cmds` differing 32 = 30 `DIFF` cases plus 2 `FIXED` known-marker cases that now match (`search bad yaml`, `install invalid yaml`). No `STALE` allow-list ids. `mcp_toolerr`: 36/36 modes `FAIL`.

First 15 unexpected diff ids:

- sandbox_cmds: `help create`, `help -h create`, `help sandbox create`, `help create json`, `create unknown option`, `create platform 401`, `create upload write 500`, `create ai non-tty gate (assessment unavailable)`, `create ai -y generation fails`, `create ai -y generation fails json`, `list 401`, `info 404`, `info 401`, `kill 404`, `kill 401`
- sandbox_subcmds: `files list empty`, `files list empty json`, `files list empty quiet`, `files list 404`, `files list 500`, `files list 401`, `files stat file`, `files stat 404`, `files mkdir 409`, `files mkdir 404`, `files rm 404`, `files mv 404`, `process list 404`, `process signal default`, `process signal 9`
- config_cmds: `corrupt toml (syntax error): list`, `corrupt toml (bad value): list`, `corrupt toml (dup key): list`, `corrupt toml (dup table): list`, `corrupt toml (shortcuts not table): list`, `corrupt toml (unterminated string): list`, `corrupt toml (bad escape): list`, `corrupt toml (bad date): list`, `corrupt toml (bom): list`, `set region "new\nline" then list/get`, `set region "ctl\u0001x" then list/get`, `set region "del\u007fx" then list/get`, `list: ./.env comments/quotes`, `warn: corrupt config + version`, `warn: corrupt config + top-level --help`
- template_cmds: `help template init`, `help -h template init`, `help top init`, `list 401`, `list unreachable`, `list official no creds json`, `info 401`, `top deploy verbose`, `init list`, `init list json`, `init list quiet`, `init case python`, `init case python no dir`, `init case python json`, `init case python quiet`
- mcp_toolerr: `[401-json] "create_sandbox" {}`, `[401-json] "create_sandbox" {"template":"x","timeout":5,"envs":{"A":"1"}}`, `[401-json] "run_code" {"code":"print(1)"}`, `[401-json] "run_code" {"code":"print(1)","sandbox_id":"sbx-missing"}`, `[401-json] "run_command" {"command":"ls","sandbox_id":"sbx-missing","cwd":"/tmp","timeout":3}`, `[401-json] "read_file" {"path":"/a","sandbox_id":"sbx-missing"}`, `[401-json] stub request log`, `[401-code] "create_sandbox" {}`, `[401-code] "create_sandbox" {"template":"x","timeout":5,"envs":{"A":"1"}}`, `[401-code] "run_code" {"code":"print(1)"}`, `[401-code] "run_code" {"code":"print(1)","sandbox_id":"sbx-missing"}`, `[401-code] "run_command" {"command":"ls","sandbox_id":"sbx-missing","cwd":"/tmp","timeout":3}`, `[401-code] "read_file" {"path":"/a","sandbox_id":"sbx-missing"}`, `[401-code] stub request log`, `[403-json] "run_code" {"code":"x","sandbox_id":7}`

# Providers and Credentials — CLI spec (for the Node.js `abx`)

> **Status: superseded for catalog providers** wherever this page lists a gRPC transport as future work. The current design is the Node engine: HTTP, SSE and WebSocket on `127.0.0.1`, protocol `abx-engine/1`. See [cli/docs/en/reference/engine-api.md](../reference/engine-api.md) and [Node provider architecture](node-provider-architecture.md). The checklist item below is kept as history.

> **Audience**: the CLI worker who applies this spec.
>
> **Normative source of the design**: `python-sdk/docs/en/design/providers-and-credentials.md` (naming scheme, precedence, provider contract, security model). This file turns it into exact CLI grammar, help text, JSON shapes, exit codes, module layout and tests.
>
> **Naming rule**: each configuration key has exactly one environment variable. That variable is the only name a reader accepts, and it is the name `abx config set` writes. There is no second name and no migration command.

## 0. What a user sees

| Surface | Rule |
|---|---|
| `abx config list` | Keys are the names in §1 (`sandbox_api_key`, `sandbox_base_url`, `sandbox_domain`, ...). Secrets are masked. |
| `abx config get/set/delete` | Accepts those key names, a qualified `providers.<id>.<key>`, or a bare provider key for the active provider. |
| Dotenv | Layer first. `./.env` wins over `~/.abx/.env` for a key it sets, using that key's one variable. |
| `abx --help` | A `Related commands` line mentions `abx provider`. |
| `abx info` | A `Provider` row is added only for a non-built-in provider. |

---

## 1. Canonical key registry

Embed as one TypeScript module `src/utils/config_keys.ts` generated from (and tested against) `docs/design/fixtures/config-keys.json`. The JSON is the contract. Each record has one `env` string.

### 1.1 Record shape

```ts
interface ConfigKey {
  key: string;                    // snake_case
  scope: "core" | { provider: string };
  type: "str" | "url" | "int" | "float" | "bool" | "enum" | "path" | "csv";
  secret: boolean;                // mask in output, store in ~/.abx/.env (0600)
  credential: boolean;            // missing -> E1003 / exit 3 when needed
  env: string;                    // the one environment variable
  storage: { file: "env" | "toml"; name: string; section?: string };
  default?: string | number | boolean;
  group: string;
  description: string;
}
```

### 1.2 Core keys

| key | type | secret | environment variable | storage | default |
|---|---|---|---|---|---|
| `provider` | str | no | `ABX_PROVIDER` | toml `[core] provider` | `alicloud-express` |
| `sandbox_api_key` | str | yes | `ABX_SANDBOX_API_KEY` | env `ABX_SANDBOX_API_KEY` | — |
| `sandbox_base_url` | url | no | `ABX_SANDBOX_BASE_URL` | toml `[transport] sandbox_base_url` | derived from region |
| `sandbox_domain` | str | no | `ABX_SANDBOX_DOMAIN` | toml `[transport] sandbox_domain` | derived from region |
| `http_timeout` | float | no | `ABX_HTTP_TIMEOUT` | toml `[transport]` | 30.0 |
| `http2` | bool | no | `ABX_HTTP2` | toml | true |
| `log_level` | enum | no | `ABX_LOG_LEVEL` | toml | `WARNING` |
| `default_template` | str | no | `ABX_DEFAULT_TEMPLATE` | toml `[transport]` | `base` |
| `llm_api_key` | str | yes | `ABX_LLM_API_KEY` | env `ABX_LLM_API_KEY` | — |
| `llm_base_url` | url | no | `ABX_LLM_BASE_URL` | toml | DashScope compatible-mode |
| `llm_model` | str | no | `ABX_LLM_MODEL` | toml | `qwen3-coder-plus` |
| `github_token` | str | yes | `GITHUB_TOKEN` | env `GITHUB_TOKEN` | — |
| `template_index_url`, `template_dir` | url/path | no | `ABX_TEMPLATE_INDEX_URL`, `ABX_TEMPLATE_DIR` | not settable via `config set` | |
| `mcp_auth_token`, `mcp_allowed_origins`, `mcp_runtime_dir` | | token yes | `ABX_MCP_*` | not settable via `config set` | |

Pool/WS/backoff tuning (`max_connections`, `max_keepalive_connections`, `keepalive_expiry`, `ws_ping_interval`, `retry_base_delay`): file-only (`[transport]`), env `ABX_<KEY>`, not exposed by `config set`.

### 1.3 Provider-scoped keys of built-in `alicloud-express`

| key | environment variable | notes |
|---|---|---|
| `region` | `ALIBABA_CLOUD_REGION_ID` | toml `[providers.alicloud-express] region`. Default `cn-hangzhou`. |
| `access_key_id` | `ALICLOUD_ACCESS_KEY_ID` | secret-like, `~/.abx/.env` |
| `access_key_secret` | `ALICLOUD_ACCESS_KEY_SECRET` | secret, `~/.abx/.env` |
| `acr_namespace` | `ACR_NAMESPACE` | |
| `acr_registry` | `ACR_REGISTRY` | |
| `acr_repo` | `ACR_REPO` | |
| `acr_username` | `ACR_USERNAME` | |
| `acr_password` | `ACR_PASSWORD` | secret |
| `acr_instance_id` | `ACREE_INSTANCE_ID` | |
| `acr_vpc_id` | `ACR_VPC_ID` | |
| `acr_vswitch_ids` | `ACR_VSWITCH_IDS` | |
| `acr_security_group_id` | `ACR_SECURITY_GROUP_ID` | |
| `team_id` | `ABX_ALICLOUD_EXPRESS_TEAM_ID` | Optional. Not required. |

The built-in provider implicitly consumes `sandbox_api_key`, `sandbox_base_url`, `sandbox_domain`, `http_timeout`, `http2`, `max_retries` (plus tuning keys). **Every other provider** consumes the non-secret tuning keys only; it receives `sandbox_api_key` / `sandbox_base_url` / `sandbox_domain` solely through its manifest `[core] inherit` list **intersected with** the list the user consented to at install/update (`receipt.consented.inherit`). Switching the default provider never sends the Alibaba key to a plugin (design §4.6).

### 1.4 Reserved words

Key names starting with `shortcuts`, and the table names `core`, `transport`, `providers`, are reserved. Provider ids may not collide with them.

---

## 2. Resolution

### 2.1 Algorithm

```text
resolve(key K, provider P, sources S):
  name = the one environment variable for K in §1
         (a plugin's own field uses ABX_<P>_<K>)
  layers = [ S.overrides, S.environ, S.dotenv[0] (./.env), S.dotenv[1] (~/.abx/.env), S.toml, default ]
  for layer in layers:
      v = layer[name]; if v is a non-blank string / non-null: return (v, layer, name)
  return unset
```

* Blank/whitespace-only = unset in every layer, including overrides.
* `S.dotenv` = each existing candidate file in order (`./.env` first, then `~/.abx/.env`).
* TOML names for `K`: `[providers.<P>].K`, then `[transport].K`.
* Numeric/boolean coercion identical to the SDK.
* **Derived defaults** (`sandbox_base_url`, `sandbox_domain` from `region`): apply only for providers whose schema declares `[endpoint.derive]` and only when the base URL was not explicitly set by an override or the process environment. Each derived key uses set-default semantics.
* `source` labels for `config list`: environ→`(env)`, dotenv/toml→`(user)`, derived/built-in→`(default)`, nothing→`(not set)`.

### 2.2 Provider selection

`explicit (--provider or provider:ref) > ABX_PROVIDER env > ABX_PROVIDER in ./.env > ABX_PROVIDER in ~/.abx/.env > [core] provider > alicloud-express`. An unknown id → `E8001` (exit 4) naming `abx provider list` / `abx provider install`.

### 2.3 `config list`

| Group title | Keys |
|---|---|
| `Provider` | `provider` |
| `Sandbox authentication` | `sandbox_api_key` |
| `Alibaba Cloud credentials` | provider keys flagged `credential`, then `acr_namespace` |
| `Alibaba Cloud registry (ACR)` (built-in only) | `acr_registry`, `acr_repo`, `acr_username`, `acr_password`, `acr_instance_id`, `acr_vpc_id`, `acr_vswitch_ids`, `acr_security_group_id`, `team_id` |
| `Connection` | `sandbox_base_url`, `region`, `sandbox_domain`, `http_timeout`, `http2`, `max_retries` |
| `LLM` | `llm_api_key`, `llm_model`, `llm_base_url` |
| `Integrations` | `github_token` |
| `Shortcuts` | unchanged |

`--json` is the flat `{key: value}` map. Secrets are masked.

---

## 3. `abx config`

### 3.1 Options

* `--provider ID` — resolve **bare provider keys** and list/get against provider `ID` instead of the default. Qualified keys ignore it.
* Qualified keys `providers.<id>.<key>` work for `get/set/delete`.

### 3.2 Key resolution order for `KEY` (exit 2 on failure)

1. `shortcuts`, `shortcuts.*`.
2. A core key from §1.2 (`sandbox_api_key`, `sandbox_base_url`, `sandbox_domain`, ...).
3. `providers.<id>.<key>` (qualified) — `<id>` must be built-in or installed (`E8001`), `<key>` ∈ that provider's schema or a core key it inherits.
4. Bare key in the effective provider's schema (`--provider` else default). Not found → `Unknown config key: 'x'` with suggestion `Available keys: …` and, when other installed providers declare it, `Did you mean 'providers.<id>.x'?`.

### 3.3 Storage on `set`

`config set` writes the one storage name in §1. Clearing (`set K ""` / `delete`) removes that stored value. Message strings: `Set sandbox_base_url = …`, `Cleared sandbox_base_url (falls back to default: …)`.

### 3.4 `abx config init`

With the built-in provider the wizard prompts for the sandbox API key (`ABX_SANDBOX_API_KEY`), the region (`ALIBABA_CLOUD_REGION_ID`), the LLM API key (`ABX_LLM_API_KEY`), and the AccessKey pair (`ALICLOUD_ACCESS_KEY_ID`, `ALICLOUD_ACCESS_KEY_SECRET`). With a non-built-in default provider (or `--provider ID`), the wizard is generated from the provider's schema: one prompt per field in manifest order (`i/N Description (key, ENV_NAME)`, secrets masked, required marked `*`), then `Stored <key> in ~/.abx/.env` / `Set <key> = <value>`, then `Configuration complete. Review it with 'abx config list --provider ID'.`

### 3.5 Help text

`abx config get --help` / `set --help` list the keys from §1. Wording:

```
sandbox_api_key    Sandbox API key (env: ABX_SANDBOX_API_KEY).
sandbox_base_url   Platform API URL (env: ABX_SANDBOX_BASE_URL).
sandbox_domain     Envd data-plane domain (env: ABX_SANDBOX_DOMAIN).
provider           Default provider id (see 'abx provider list'; default:
                   alicloud-express).
providers.<id>.<key>
                   Provider-scoped value; bare keys such as 'region' refer to the
                   default provider (or --provider ID).
```

---

## 4. `--provider`, `--opt` and flags

### 4.1 `--provider`

* Accepted as a **root option** (`abx --provider ID <cmd> …`) and as a **command-level option** on every command that talks to a provider; the command-level value wins. Help: `--provider ID  Provider for this command (default: 'abx provider default' value, else alicloud-express)`.
* Commands that take it (feature they require): `create`/`sandbox create` (`sandbox.lifecycle`), `list`/`sandbox list`, `info`, `kill`, `connect`, `exec` (`exec.run`; `exec --stream` needs `exec.stream`), `run`, `shell`, `upload`/`download`/`files` (`files.rw`), `sandbox process …` (`process.manage`), `sandbox system …`, `sandbox timeout` (`sandbox.timeout`), `sandbox pause/resume` (`sandbox.pause`), `template list/info/build/deploy/delete/install/push/create` and `deploy` (`templates.read`/`templates.build`), `mcp install/start/deploy` (`sandbox.lifecycle`).
* Not provider-bound (never take it): `config` (has its own `--provider` for scoping), `template init/search`, `mcp status`, `provider *`.
* Typo hint: an unknown id adds `Did you mean 'X'?` (edit distance ≤ 2 against built-in/installed ids) to the `E8001` suggestion. Missing feature → fail **before** any side effect: exit 1, `[E8004] Provider 'ID' does not support 'FEATURE'.` + suggestion `Run 'abx provider info ID' to see supported features.` (JSON: `{"status":"error","code":"E8004","message":…,"suggestion":…}`).
* Provider-scoped flags of the built-in provider (`--region/-r`, `--acr-*`, `--team-id`, `--vpc-id`, `--vswitch-ids`, `--security-group-id`) are accepted only when the effective provider declares the matching key; otherwise exit 2: `Option '--region' is not supported by provider 'ID'.` with suggestion `Use '--opt KEY=VALUE' for provider options (see 'abx provider info ID').`

### 4.2 `--opt KEY=VALUE` (repeatable)

Sets a provider-scoped key for this invocation (override layer). `KEY` ∈ the effective provider's schema (or an inherited core key, as an override for this provider). Bad syntax / unknown key → exit 2 (`E8002`). `--opt` values appear in argv: for `secret` fields the CLI refuses (`E8002`: `Field 'KEY' is secret; set it with 'abx provider config ID set KEY' or the ABX_<ID>_<KEY> environment variable.`).

### 4.3 Flags

| Flag | Environment variable | Commands |
|---|---|---|
| `--sandbox-api-key` | `ABX_SANDBOX_API_KEY` | `mcp install`, `mcp start` |
| `--sandbox-base-url` | `ABX_SANDBOX_BASE_URL` | same |
| `--sandbox-domain` | `ABX_SANDBOX_DOMAIN` | same |
| `--acr-instance-id` | `ACREE_INSTANCE_ID` | template commands |

`abx mcp install` copies `ABX_SANDBOX_API_KEY` into the editor config. It copies `ABX_SANDBOX_BASE_URL` and `ALIBABA_CLOUD_REGION_ID` into that file only when the process environment sets them, under those same names.

### 4.4 Qualified sandbox references

Input grammar: `[provider:]sandbox_id` for every command that takes a sandbox id (`info`, `kill`, `exec`, `connect`, `upload`, `download`, `files`, `sandbox process/system …`). The prefix is parsed iff the part before the first `:` matches the provider-id grammar **and** equals a built-in/installed provider id; otherwise the whole string is the id. Output format rule (identical in Python/Node): the **legacy format** (bare ids, no `provider` field) is used **only if both** the ambient provider (the configured default, ignoring `--provider`) **and** the effective provider are `alicloud-express`. In every other case printed ids are qualified (`local-process:sbx-1`) in text mode (tables and `--quiet`), and `--json` rows gain `"provider"` (the bare id stays in `sandbox_id`/`ID`). Rationale: an id pasted from output must be unambiguous when the default is later changed, yet scripts using only the built-in provider see no change. `--provider P` + reference `Q:id` with `P≠Q` → exit 2 `[E8030] Sandbox reference 'Q:id' conflicts with --provider P.`

`abx list --all-providers` — adds a `Provider` column/key, queries every configured provider (those whose `credential` fields resolve), skips failing providers with a stderr warning (`warning: provider 'ID' skipped: <message>`), exit 0 if at least one succeeded else the first error's exit code.

---

## 5. `abx provider`

```
Usage: abx provider [OPTIONS] COMMAND [ARGS]...

  Manage sandbox providers (backends).

  The built-in provider is 'alicloud-express' (Alibaba Cloud Express Edition,
  阿里云极速版). Install more with a directory or a git URL.

Commands:
  list       List built-in and installed providers
  info       Show a provider's manifest, features and configuration
  install    Install a provider plugin from a directory or git URL
  uninstall  Remove an installed provider
  update     Update installed providers
  default    Show or set the default provider
  config     Show or edit a provider's configuration
  doctor     Check a provider (integrity, handshake, features)

Examples:
  abx provider list
  abx provider install ./my-provider
  abx provider install https://github.com/acme/abx-provider-acme.git --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7
  abx provider default acme
  abx create --provider acme --template base
```

Related commands (also printed as the last paragraph of `abx --help`): `abx config`, `abx info`.

Every subcommand honours `--json/--quiet/--ci/--no-color/--verbose` and the standard `-h/--help`.

### 5.1 `list`

`abx provider list` → standard table, headers `["ID", "Name", "Version", "Kind", "Trust", "Default"]`, rows built-in first, then installed sorted by id; `Default` is `yes` or empty; `Kind` ∈ `builtin|rest|exec`; `Trust` ∈ `builtin|pinned|local|link|unpinned`. `--json` = the table's list-of-objects (house style, keys are the header strings). Always at least the built-in row. `--quiet` prints ids only (one per line; the standard quiet table output would be tab-separated rows — **override**: ids only, documented).

### 5.2 `info ID`

Text (key/value via `print_dict` style, then blocks):

```
ID           alicloud-express
Name         Alibaba Cloud Express Edition (阿里云极速版)
Version      0.3.0
Kind         builtin
Default      yes
Trust        builtin
Features     sandbox.lifecycle, sandbox.timeout, …
Config       region, access_key_id, access_key_secret (secret), …
Inherits     sandbox_api_key, sandbox_base_url, … (built-in: all; plugins: consented subset)
```

Installed providers add `Source`, `Commit`, `Digest`, `Runtime` (command line), `Security` (declared, **advisory** permissions), `Installed`, `Inherits` (the effective consented list). `--json` shape:

```json
{
  "id": "alicloud-express", "name": "Alibaba Cloud Express Edition", "name_zh": "阿里云极速版",
  "version": "0.3.0", "kind": "builtin", "default": true, "trust": "builtin",
  "features": ["sandbox.lifecycle", "…"],
  "config_fields": [{"key": "region", "type": "str", "secret": false, "credential": false, "required": false,
                     "default": "cn-hangzhou", "env": "ALIBABA_CLOUD_REGION_ID",
                     "description": "…", "description_zh": "…"}],
  "inherit": ["sandbox_api_key", "…"],
  "install": null
}
```

For installed providers `install` = the receipt object (§7.6 of the design) with `source.url` credentials redacted. Unknown id → exit 4 `[E8001] Provider 'x' is not installed.` (suggestion `Run 'abx provider list'; install with 'abx provider install <path-or-git-url>'.`).

### 5.3 `install SOURCE`

```
Usage: abx provider install [OPTIONS] SOURCE

  Install a provider plugin. SOURCE is a local directory or a git URL
  (https://, ssh://, git@host:path). Nothing from the plugin is executed
  during installation.

Options:
  --ref TEXT                     Git tag, branch or commit (full 40-hex commit pins the install)
  --subdir TEXT                  Plugin directory inside the repository
  --sha256 TEXT                  Expected tree digest; the install fails if it differs (pins the install)
  --link                         Link a local directory for development (no copy, no integrity check; requires --yes; POSIX only)
  --force                        Replace an installed provider with the same id
  --allow-unpinned               Allow a tag/branch install without --sha256 in non-interactive mode
  --allow-insecure-transport     Allow file://, git:// and http:// sources (testing only)
  -y, --yes                      Skip the confirmation prompt (required in non-interactive mode)
```

`--link` records `trust = link`: the directory is used in place, manifest/integrity are re-read on every spawn, and because nothing pins the code it always requires `--yes` (even interactively it prints a red `unpinned, development only` banner) and is refused on Windows. The `Security` line in the consent screen is the plugin's **self-declaration** and is printed as `declared by the plugin (not enforced)`.

Behaviour = design §7.6. Consent screen (stdout; in `--json` mode no prompt is possible so `--yes` is required, else exit 2):

```
Provider      local-process 0.1.0  (Local Process)
Source        https://github.com/acme/abx-provider-local-process.git @ 4f1c2ab9… (pinned)
Digest        sha256:ab12…
Runs          python3 ./provider.py
Features      sandbox.lifecycle, exec.run, files.rw
Security      network: none · filesystem: data_dir · spawns processes: yes
Config        workdir_root, token (secret)
Inherit       sandbox_api_key, sandbox_base_url   <- your generic sandbox credentials WILL BE SENT to this plugin (omitted when the manifest inherits nothing)

This plugin runs as a program on your machine with your credentials for this provider.
Install and trust it? [y/N]
```

Success: `Installed provider 'local-process' 0.1.0 (pinned)`; `--json` → `{"status":"success","message":"…","id":"local-process","version":"0.1.0","trust":"pinned","commit":"…","tree_sha256":"…"}`.

Errors (stderr, `[CODE] message` + `Suggestion:`), exit code:

| Condition | Code | Exit | Message |
|---|---|---|---|
| source not found / clone fails | E8010 | 1 | `Cannot fetch provider source: <reason>.` |
| manifest missing/invalid | E8014 | 1 | `Invalid abx-provider.toml: <reason>.` |
| id reserved/conflict without `--force` | E8003 | 1 | `Provider id 'x' is already installed.` / `reserved` |
| digest mismatch | E8011 | 1 | `Tree digest mismatch: expected <a>, got <b>.` |
| non-interactive without `--yes` | E8012 | 2 | `Installing a provider requires confirmation.` / `Re-run with --yes after reviewing: abx provider install <source> --ref <commit>` |
| unpinned git in non-interactive without `--allow-unpinned` | E8012 | 2 | `Refusing an unpinned git source in non-interactive mode.` / `Pass --ref <40-hex commit> or --sha256 <digest>.` |
| `--link` without `--yes`, or on Windows | E8012 | 2 | `--link requires --yes (the linked code is not pinned).` / `--link is not supported on Windows.` |
| insecure transport / credentials in URL | E8012 | 2 | `Insecure provider source 'git://…'.` / `Credentials in URLs are not accepted; use an SSH agent or a git credential helper.` |
| incompatible `requires` / protocol | E8013 | 1 | `Provider requires abx cli >=0.4 (this is 0.3.0).` |
| path/size/symlink violations | E8010 | 1 | `Unsafe entry 'a/../b' in provider source.` etc. |

### 5.4 `uninstall ID`

Options `--purge` (also remove `[providers.<id>]` and `ABX_<ID>_*` from `~/.abx/.env` and the `data/` dir), `-y/--yes`. Prompt `Remove provider 'ID'? [y/N]` (non-interactive without `--yes` → exit 2 `E8012`). Built-in → exit 2 `[E8003] The built-in provider cannot be removed.` If it was the default: stderr notice `Default provider reset to 'alicloud-express'.`. Unknown → exit 4 `E8001`. Success `Removed provider 'ID'`.

### 5.5 `update [ID | --all]`

Options: `--ref TEXT`, `--check`, `--all`, `-y/--yes`. `--check` prints `ID  installed → available (changes: runtime, security)` rows (table headers `["ID","Installed","Available","Changes"]`) and changes nothing (exit 0). Update applies design §7.6 (re-consent iff runtime/security/features/config-fields changed, pinned needs `--ref`, rollback on `initialize` failure). `link` and `local` installs: `[E8010] Provider 'ID' was installed from a local directory; reinstall it with 'abx provider install --force <path>'.` (exit 1). Nothing to update: `All providers are up to date.`

### 5.6 `default [ID]`

* no arg: prints the effective default id (stdout, one line; `--json` → `{"default":"…","source":"env|dotenv|config|builtin"}`), exit 0.
* `ID`: validates it exists, writes `[core] provider = "ID"`, prints `Default provider set to 'ID'` (+ warning to stderr if `ABX_PROVIDER` is set and overrides it: `note: ABX_PROVIDER=… overrides this at runtime.`).
* `--unset`: removes the key, prints `Default provider reset to 'alicloud-express'`.
* Setting the built-in id writes nothing special (removes the key).

### 5.7 `config ID …`

```
abx provider config ID list           # == abx config list --provider ID
abx provider config ID get KEY        # == abx config get providers.ID.KEY
abx provider config ID set KEY [VALUE]# masked prompt for secrets, same rules as `abx config set`
abx provider config ID unset KEY      # == abx config delete providers.ID.KEY
abx provider config ID init           # guided prompts from the schema (as §3.7)
```

Validation on `set`: type coercion from the manifest field type; `enum` membership; `url` must parse; `path` is stored as given; `required` fields are only enforced when a command runs. Errors → exit 2 `E8002` (`Invalid value for 'KEY': <reason>.`).

### 5.8 `doctor [ID]`

Runs without side effects: manifest valid, digest matches receipt, `requires` OK, config completeness (`required` fields resolved from which source — names only), spawns the plugin, `initialize`, compares advertised vs declared features. Output lines `ok|warn|fail  <check>  <detail>`; exit 0 all ok/warn, 1 any fail. `--json` → `[{"check":"digest","status":"ok","detail":"…"}]`. Warns when a generic `sandbox_api_key` would be sent to this provider and is also the effective key for another configured provider.

---

## 6. Node architecture (suggested; keep the Python module mirroring rule)

| Module | Responsibility |
|---|---|
| `src/utils/config_keys.ts` | registry from `config-keys.json`; `resolve()`; `exportSchema()` |
| `src/transport/config.ts` | `loadConfig`, `explainConfig`, `auditConfig`, `planMigration`/`applyMigration`; honours the same seams as the Python tests patch |
| `src/providers/base.ts` | `Provider`, `ProviderFeature`, `ConfigField`, `ProviderInfra` |
| `src/providers/registry.ts` | builtin + installed discovery, selection precedence (§2.2) |
| `src/providers/builtin.ts` | `alicloud-express` wrapping today's code paths (no behaviour change) |
| `src/providers/manifest.ts` | TOML parse (`smol-toml`) + all validation rules + version comparator |
| `src/providers/store.ts`, `installer.ts` | layout, lock, receipt, **tree digest**, git clone hardening, fs-safety checks, consent screen, update/rollback |
| `src/providers/exec_provider.ts` | EPP/1 client (NDJSON JSON-RPC over `child_process.spawn`, `shell:false`, scrubbed env, process-group kill), error mapping table. Third-party plugins; optional `pty.*` |
| `src/providers/node_provider.ts` | in-process `node/1` module (`provider.mjs`, `create(kit)`). Catalog providers `opensandbox`, `e2b`, `cubesandbox`, `alicloud-container` |
| `src/providers/rest_provider.ts` | manifest-driven endpoint preset on top of the existing envd transport |
| `src/engine/server.ts` | local engine for other languages: HTTP, SSE and WebSocket on `127.0.0.1`, protocol `abx-engine/1` |
| `src/cli/commands/provider.ts` | the commands of §5 |
| `src/cli/commands/config_cmd.ts` | deltas of §3 |

Interface (wire fields stay `snake_case`):

```ts
export interface Provider {
  id: string; displayName: string; displayNameZh: string; version: string;
  kind: "builtin" | "node" | "rest" | "exec";
  features: ReadonlySet<ProviderFeature>;
  configFields: readonly ConfigField[];
  usesCore: readonly string[];
  require(feature: ProviderFeature): void;           // throws ProviderFeatureNotSupportedError (E8004)
  buildInfra(config: TransportConfig): Promise<ProviderInfra>;
}
```

The `exec` provider's `buildInfra` returns adapters whose methods issue EPP calls; when a `SandboxRecord` carries `envd_url`, the CLI uses its **existing** envd transport for exec/files/PTY (hybrid mode) — do not route data-plane traffic through the plugin in that case.

Spawn rules (exact, tested): `spawn(cmd[0], cmd.slice(1), {cwd: dataDir, env: scrubbedEnv, stdio: ['pipe','pipe','pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32'})`; first element starting with `./` resolves inside the plugin dir (realpath must stay inside); framing: split stdout on `\n`, reject lines > 8 MiB; stderr ring 64 KiB; handshake timeout `startup_timeout_ms`; call timeout; kill: `shutdown` → end stdin → 3 s → SIGTERM (process group) → 3 s → SIGKILL (`taskkill /T /F` on Windows).

---

## 7. Tests the CLI worker must add

Naming follows the port rules (`tests/<path>.test.ts`, `describe("<Class>")`, `it("<name>")`).

**Fixtures (copied unchanged from `docs/design/fixtures/`)**: `config-keys.json`, `config-resolution-vectors.json`, `tree-digest-vectors.json`, `epp-error-mapping.json`. A test fails if a fixture differs from the Python repo's copy when both repos are checked out side by side.

1. `tests/utils/config_keys.test.ts` — registry equals `config-keys.json`; every key has the one environment variable from §1; id grammar and reserved ids; ACR env names are `ACR_*` / `ACREE_INSTANCE_ID`, and region is `ALIBABA_CLOUD_REGION_ID`.
2. `tests/transport/config_resolution.test.ts` — **all vectors**; layer-first dotenv; blank values; derivation; provider-scoped beats generic; no cross-provider leakage; `http_timeout_configured` equivalent. The winning `name` is the one variable for that key.
3. `tests/cli/test_config_cmd_providers.test.ts` — key resolution order (§3.2) incl. `--provider`, qualified keys, ambiguity suggestion; `config set` writes the one storage name; clearing removes that stored value; `config list` golden.
5. `tests/providers/manifest.test.ts` — each validation rule of design §7.5 (one test per rule), version comparator table, command-escape rule.
6. `tests/providers/store_installer.test.ts` — local dir; git via a temp bare repo (`--allow-insecure-transport` for `file://`); pinned/unpinned/`--sha256`; symlink/hardlink/traversal/case-collision/size/file-count rejections; credentials-in-URL rejection + redaction; `--link` requires `--yes`; `ls-tree` validation rejects symlink/submodule/oversize entries *before* any blob is written; unpinned wording (`tag/branch installs are not pinned`); **tree-digest vectors**; canary test (plugin writes a file if executed → must not exist after install); integrity failure after editing a file; update re-consent matrix; rollback; uninstall/purge; default fallback; lock contention; atomic swap crash-safety (kill between stage and swap leaves the old install intact).
7. `tests/providers/exec_provider.test.ts` — against `examples/providers/local-process` (copied from python-sdk): handshake, version mismatch (`E8013`), feature gating, **error mapping table**, timeouts, crash with stderr tail, malformed/oversized lines, env scrubbing (plugin echoes env: no `ABX_*`/`E2B_*`/`ALICLOUD_*`), secrets only via `initialize`, process-group kill, cancel, hybrid mode with `envd_url`; **plugin stderr is redacted** (a plugin echoing a secret to stderr: the secret never reaches the CLI's stderr, the doctor output or error messages) and the `initialize` request is never written to the debug/log output.
8. `tests/cli/test_provider_cmd.test.ts` — every command of §5: help goldens, table/JSON shapes, quiet override, exit codes, the error table, consent screen golden, non-interactive refusals, `default` messages incl. `ABX_PROVIDER` note, `doctor` output.
9. `tests/cli/test_provider_flag.test.ts` — `--provider` root+leaf precedence, missing feature fails before side effects (assert no HTTP/Docker call), provider-scoped flag rejection text, `--opt` secret refusal, qualified references, `E8030`, `list --all-providers` partial failure, JSON `provider` key only for non-builtin.
10. **Differential (oracle) cases** under `parity/diff/`: with the built-in provider only, `list`, `create`, and `kill` against the stub use the one environment variable from §1.
11. Cross-implementation conformance: install `examples/providers/local-process` from the Python repo with the **Node** installer, then load it with the **Python** SDK (and vice-versa): same receipt digest, both accept the other's receipt.

---

## 8. CLI follow-up checklist (ordered)

1. Wait for port parity (all ledger tests green, `parity:coverage` clean).
2. Copy fixtures from `python-sdk/client-sdk/tests/fixtures/` into `docs/design/fixtures/` and `tests/fixtures/` (the Python repo is the source of truth); add the fixture-identity test.
3. Implement `config_keys.ts` + the layer-first resolver; port `config_cmd.ts` onto it; each key has one environment variable; regenerate `config list` goldens.
4. Bind each flag to that one environment variable. Expose `acr_*` keys via `config set`.
5. `abx config set` writes the one storage name from §1.
6. Implement providers: manifest → store/installer (+digest) → registry/builtin → `exec_provider`/`rest_provider` → `abx provider …` → `--provider/--opt` plumbing → qualified references → `list --all-providers`.
7. Update the CLI docs (`cli-design`, `cli-reference`, `configuration`, `environment-variables`, `authentication`, new `providers` guide) and zh mirrors; `SKILL.md`; `llms.txt`; CHANGELOG.
8. Make the `mcp install` copy rules (§4.3) and the MCP server env (`ABX_PROVIDER` is forwarded) consistent.
9. Review round with an adversary who did not write the slice (per PORTING.md), appending findings to `parity/review-log.md`.
10. Open items for later (do not build now): OS-level plugin confinement, keychain secret storage, registry/marketplace source, long-lived plugin daemons (EPP/2). gRPC as an SDK-to-provider transport was evaluated and was not adopted for catalog providers (see the status at the top of this page; current design is the Node engine, HTTP / SSE / WebSocket, [cli/docs/en/reference/engine-api.md](../reference/engine-api.md)).

---

## 9. Notes from the Python implementation (authoritative where they differ from the text above)

The Python SDK side was implemented after this spec was reviewed. These points are decisions made while implementing; the Node implementation must match them (the shared fixtures encode most of them).

1. **E8005 `ProviderResourceNotFoundError`** exists. EPP `-32002` maps to the class named by `data.sdk_code` (E2001, E4001, ...); with no `sdk_code` it maps to E8005 (not E2000). Exit code 4. `exit_code_for` order: auth → 3, not-found family (E8001, E8005, `TemplateNotFoundError`, `FileNotFound_`) → 4, timeout (`CommandTimeoutError`, E8022) → 5, quota → 6, config/trust/mismatch (E8002, E8012, E8030) → 2, else 1. `epp-error-mapping.json` is the source of truth.
2. **`sandbox.kill` is idempotent at the host adapter**: an E8005 from `sandbox.kill` is swallowed (the sandbox is already gone), so `abx kill` of a vanished sandbox behaves like the built-in provider. Plugins should also make kill idempotent; the contract kit checks it.
3. **No-envd providers** get a marker URL `epp://<provider>/<sandbox_id>` as the sandbox's envd URL; every code path that would call envd (command listing, auth checks, terminals) must skip `epp://` URLs and use the provider's data-plane methods.
4. **Manifest `command`**: elements starting with `./` resolve inside the plugin directory and may not escape it; the consent screen prints the argv as written (`python3 ./provider.py`).
5. **Plugin environment** additionally carries `PYTHONDONTWRITEBYTECODE=1` (interpreters must not write into the digest-verified directory). Top-level `data/` is reserved for plugin state and excluded from the tree digest; `update` carries `data/` over.
6. **Process cleanup**: after the plugin exits (cleanly or not) the host still kills the process group, so grandchildren cannot outlive a session (`EppClient.close`).
7. **`close()`**: provider processes are owned by the sandbox object; the Python API gained `Sandbox.close()`. A CLI invocation must close its provider on every exit path (including `Ctrl-C`).
8. **Storage**: `abx config set sandbox_api_key` writes `ABX_SANDBOX_API_KEY` in `~/.abx/.env` (mode 0600). `sandbox_base_url` is stored as `[transport] sandbox_base_url`. Each key has that one stored name.
9. **`python -m agent_sandbox.providers`** is the SDK-side twin of `abx provider` (same layout, same receipts, same digest). A `node` plugin installed by one tool loads in the other: the CLI imports `provider.mjs`, and the Python SDK reaches it through `abx provider engine serve`. A manifest with `kind = "python"` is rejected (`node`, `exec` or `rest`). In-code `Provider` subclasses still register in the Python SDK. They are not installable catalog plugins.
10. **Not implemented in Python (follow-ups, same for the CLI)**: `sandbox.yaml` `provider:` / `provider_options:` and `@sandbox(provider=...)`; OS confinement; `list --all-providers` aggregation helper in the SDK (the SDK exposes `Sandbox.list(provider=...)` per provider only).

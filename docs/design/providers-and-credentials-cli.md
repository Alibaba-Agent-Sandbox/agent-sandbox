# Providers and Credentials — CLI spec (for the Node.js `ebx`)

> **Audience**: the CLI worker who applies this **after the Python→Node port reaches parity** (see [`../PORTING.md`](../PORTING.md)). The port itself keeps every old key name and behaviour; this document is the delta.
>
> **Normative source of the design**: `python-sdk/docs/en/design/providers-and-credentials.md` (naming scheme, precedence, alias table, provider contract, security model). This file turns it into exact CLI grammar, help text, JSON shapes, exit codes, module layout and tests. **Executable reference**: the Python SDK implements the key registry, the resolver, the manifest, the store/installer (tree digest!) and the EPP client; its test vectors are mirrored in `docs/design/fixtures/` and **must be run by the Node tests unchanged**.
>
> Hard rules inherited from the port: golden files change **only** where this spec says so; stdout/stderr channel policy, `--json/--quiet/--ci/--no-color`, and exit codes 0–6 are unchanged; no existing key/env/flag stops working.

## 0. What changes for a user who never touches providers

| Surface | Change | Justification |
|---|---|---|
| `ebx config list` (text and `--json`) | `api_url`→`sandbox_base_url`, `domain`→`sandbox_domain` are shown under the canonical names; new group lines for new keys (§2.3). `--legacy-names` (and `EBX_CONFIG_LEGACY_NAMES=1`) prints the old names for one more release | This **is** the requested rename. Everything else in the listing is byte-identical |
| `ebx config get/set/delete <legacy>` | Same stdout as before; on an interactive TTY a one-line stderr note (§3.4) | Only documented default signal |
| Dotenv precedence (`./.env` vs `~/.ebx/.env` when two *different names* of one key are set) | Normalised to **layer-first**: the nearer file wins regardless of which alias name it uses (the old order let a lower-priority file win via an earlier-listed name). Documented in CHANGELOG; no existing test pins the old quirk | Predictability; part of the precedence story |
| `ebx --help` | A `Related commands` line mentions `ebx provider` | Discoverability |
| `ebx info` | Unchanged for the built-in provider; a `Provider` row is added **only** for non-built-in providers | Disambiguation |
| All other commands | **No** stdout/stderr change | Legacy names stay silent unless `EBX_WARN_DEPRECATED=1` |
| `ebx list --json`, `ebx create --json`, etc. with the built-in provider | **Byte-identical** (no `provider` field) | Scripts must not break |

Golden files to regenerate: `config list` (text+JSON), `config get`/`set` help text (new keys), `ebx --help` (command `provider` appears), `ebx config --help`. Add new goldens for the `provider` commands.

---

## 1. Canonical key registry (data to embed — mirrors `easy_sandbox.utils.config_keys.export_schema()`)

Embed as one TypeScript module `src/utils/config_keys.ts` generated from (and tested against) `docs/design/fixtures/config-keys.json` (produced by `python -m easy_sandbox.utils.config_keys --json`). The JSON is the contract; **do not hand-maintain a second copy**.

### 1.1 Record shape

```ts
interface ConfigKey {
  key: string;                    // canonical, snake_case
  scope: "core" | { provider: string };
  type: "str" | "url" | "int" | "float" | "bool" | "enum" | "path" | "csv";
  secret: boolean;                // mask in output, store in ~/.ebx/.env (0600)
  credential: boolean;            // missing -> E1003 / exit 3 when needed
  env: string;                    // canonical env name (EBX_...)
  aliases: { name: string; kind: "compat" | "native" | "legacy"; surface: "env" | "config" | "kwarg" | "flag" }[]; // priority order
  storage_phase1: { file: "env" | "toml"; name: string; section?: string };  // what `config set` writes while config_format != 2
  storage_phase2: { file: "env" | "toml"; name: string; section?: string };  // after `config migrate`
  default?: string | number | boolean;
  group: string;                  // `config list` group title
  description: string;            // help text one-liner
}
```

### 1.2 Core keys (exact)

| key | type | secret | env (canonical) | compat/native env (order) | legacy env (order) | legacy config/flag names | storage phase 1 | storage phase 2 | default |
|---|---|---|---|---|---|---|---|---|---|
| `provider` | str | no | `EBX_PROVIDER` | — | — | — | toml `[core] provider` | same | `alicloud-express` |
| `sandbox_api_key` | str | yes | `EBX_SANDBOX_API_KEY` | `E2B_API_KEY` | `SANDBOX_API_KEY` | config `api_key` (alias, today silent); flag `--api-key` | env `E2B_API_KEY` | env `EBX_SANDBOX_API_KEY` | — |
| `sandbox_base_url` | url | no | `EBX_SANDBOX_BASE_URL` | `E2B_API_URL` | `SANDBOX_API_BASE_URL` | config `api_url`, `api_base_url`; flag `--api-url` | toml `[transport] api_url` | `[transport] sandbox_base_url` | derived from region |
| `sandbox_domain` | str | no | `EBX_SANDBOX_DOMAIN` | `E2B_DOMAIN` | — | config `domain`; flag `--domain` | toml `[transport] domain` | `[transport] sandbox_domain` | derived from region |
| `http_timeout` | float | no | `EBX_HTTP_TIMEOUT` | — | `SANDBOX_HTTP_TIMEOUT` | — | toml `[transport]` | same | 30.0 |
| `http2` | bool | no | `EBX_HTTP2` | — | — | — | toml | same | true |
| `max_retries` | int | no | `EBX_MAX_RETRIES` | — | — | — | toml | same | 3 |
| `log_level` | enum | no | `EBX_LOG_LEVEL` | — | `SANDBOX_LOG_LEVEL` | flag `--log-level` | toml | same | `WARNING` |
| `default_template` | str | no | `EBX_DEFAULT_TEMPLATE` | — | `SANDBOX_TEMPLATE`, `EBX_TEMPLATE` | — | toml `[transport]` | same | `base` |
| `llm_api_key` | str | yes | `EBX_LLM_API_KEY` | native: `BAILIAN_CODING_PLAN_API_KEY`, `DASHSCOPE_API_KEY`, `OPENAI_API_KEY` | `EBX_QWEN_CODE_API_KEY` | legacy toml `llm_api_key` | env `EBX_LLM_API_KEY` | same | — |
| `llm_base_url` | url | no | `EBX_LLM_BASE_URL` | native: `OPENAI_BASE_URL` | — | legacy toml `qwen_code_base_url` | toml | same | DashScope compatible-mode |
| `llm_model` | str | no | `EBX_LLM_MODEL` | native: `OPENAI_MODEL` | — | legacy toml `qwen_code_model` | toml | same | `qwen3-coder-plus` |
| `github_token` | str | yes | `EBX_GITHUB_TOKEN` | native: `GITHUB_TOKEN` | — | flag `--token` | env `GITHUB_TOKEN` | env `EBX_GITHUB_TOKEN` | — |
| `template_index_url`, `template_dir` | url/path | no | `EBX_TEMPLATE_INDEX_URL`, `EBX_TEMPLATE_DIR` | — | — | — | not settable via `config set` (env only, as today) | | |
| `mcp_auth_token`, `mcp_allowed_origins`, `mcp_runtime_dir` | | token yes | `EBX_MCP_*` | — | — | — | not settable via `config set` (env only, as today) | | |

Pool/WS/backoff tuning (`max_connections`, `max_keepalive_connections`, `keepalive_expiry`, `ws_ping_interval`, `retry_base_delay`): file-only (`[transport]`), env `EBX_<KEY>`, **not** exposed by `config set` in this release (as today).

### 1.3 Provider-scoped keys of built-in `alicloud-express`

`region`, `access_key_id`, `access_key_secret`(secret), `acr_namespace`, `acr_registry`, `acr_repo`, `acr_username`, `acr_password`(secret), `acr_instance_id`, `acr_vpc_id`, `acr_vswitch_ids`, `acr_security_group_id`, `team_id` — canonical env `EBX_ALICLOUD_EXPRESS_<KEY>`; native `ALICLOUD_ACCESS_KEY_ID`/`ALICLOUD_ACCESS_KEY_SECRET`; legacy `SANDBOX_REGION`, `AccessKey`, `AccessSecret`, `ACR_NAMESPACE`, `ACR_REGISTRY`, `ACR_REPO`, `ACR_USERNAME`, `ACR_PASSWORD`, `ACREE_INSTANCE_ID`, `ACR_VPC_ID`, `ACR_VSWITCH_IDS`, `ACR_SECURITY_GROUP_ID`, `TEAM_ID`, compat `E2B_TEAM_ID`. Exact order and storage per key come from `config-keys.json` (it is the source). Phase-1 storage: secrets and credential-like values in `~/.ebx/.env` under their **legacy** names (`ALICLOUD_ACCESS_KEY_ID`, `ACR_NAMESPACE`, `ACR_PASSWORD`...); `region` in `[transport] region`; the other new settable keys (`acr_registry`, `acr_repo`, `acr_username`, `acr_instance_id`, `acr_vpc_id`, `acr_vswitch_ids`, `acr_security_group_id`, `team_id`) in `[providers.alicloud-express]`.

Core-key consumption: the built-in provider implicitly consumes `sandbox_api_key`, `sandbox_base_url`, `sandbox_domain`, `http_timeout`, `http2`, `max_retries` (+ tuning keys). **Every other provider** consumes the non-secret tuning keys only; it receives `sandbox_api_key`/`sandbox_base_url`/`sandbox_domain` solely through its manifest `[core] inherit` list **intersected with** the list the user consented to at install/update (`receipt.consented.inherit`). This is the credential-isolation rule (design §4.6): switching the default provider never sends the Alibaba key to a plugin.

### 1.4 Reserved words

Key names starting with `shortcuts`, and the table names `core`, `transport`, `providers`, are reserved. Provider ids may not collide with them (the SDK's `RESERVED_PROVIDER_IDS` is in the JSON export).

---

## 2. Resolution (must match the Python resolver bit-for-bit)

### 2.1 Algorithm

```text
resolve(key K, provider P, sources S):
  names_env(K,P)  = [EBX_<P>_<K> if K is scoped to P,
                     EBX_<K> (core; for P != builtin only if K is a tuning key or K ∈ effective_inherit(P)),
                     ...compat/native env names in order,
                     ...legacy env names in order]
  layers = [ S.overrides, S.environ, S.dotenv[0] (./.env), S.dotenv[1] (~/.ebx/.env), S.toml, default ]
  for layer in layers:                      # layer-first
      for name in names(layer):             # name order, most specific first
          v = layer[name]; if v is a non-blank string / non-null: return (v, layer, name)
  return unset
```

* Blank/whitespace-only = unset in every layer, including overrides.
* `S.dotenv` = each existing candidate file in order (`./.env` first, then `~/.ebx/.env`); parse with dotenv semantics (`KEY=VALUE`, quotes, `export` prefix, comments), values `.trim()`ed.
* TOML names for `K`: `[providers.<P>].K`, `[transport].K`, `[transport].<legacy toml name>`, top-level flat legacy keys **only when the file has no `[transport]` table**.
* Numeric/boolean coercion identical to the SDK (`float(text)` / invalid numeric → warning to the log and treated as unset; booleans `true/1/yes/on` / `false/0/no/off`).
* **Derived defaults** (`sandbox_base_url`, `sandbox_domain` from `region`): apply only for providers whose schema declares `[endpoint.derive]` and only when the base URL was not explicitly set by an override or **process environment** variable (any name). Each derived key uses set-default semantics (existing `.env`/toml values are kept). Preserve this quirk: when the URL is explicit by override/env, the domain is *not* derived from the region.
* `source` labels for `config list`: override→(not shown), environ→`(env)`, dotenv/toml→`(user)`, derived/built-in→`(default)`, nothing→`(not set)`.

### 2.2 Provider selection

`explicit (--provider or provider:ref) > EBX_PROVIDER env > EBX_PROVIDER in ./.env > EBX_PROVIDER in ~/.ebx/.env > [core] provider > alicloud-express`. An unknown id → `E8001` (exit 4) naming `ebx provider list` / `ebx provider install`.

### 2.3 `config list`

Groups and order (key list per group; keys appear only if applicable to the **active provider** — for the built-in default every key below appears, like today plus the new ones):

| Group title | Keys |
|---|---|
| `Provider` | `provider` |
| `Sandbox authentication` | `sandbox_api_key` |
| `Alibaba Cloud credentials` (the active provider's display name when not built-in: `<display_name> credentials`) | provider keys flagged `credential`, then `acr_namespace` |
| `Alibaba Cloud registry (ACR)` (built-in only) | `acr_registry`, `acr_repo`, `acr_username`, `acr_password`, `acr_instance_id`, `acr_vpc_id`, `acr_vswitch_ids`, `acr_security_group_id`, `team_id` |
| `Connection` | `sandbox_base_url`, `region`, `sandbox_domain`, `http_timeout`, `http2`, `max_retries` |
| `LLM` | `llm_api_key`, `llm_model`, `llm_base_url` |
| `Integrations` | `github_token` |
| `Shortcuts` | unchanged |

The *new* groups/keys (`Provider`, the ACR registry group) are listed only when at least one of their keys has a value or the user passes `--all`; therefore **a user who never set them sees the old listing, modulo the renamed lines** (this keeps the golden diff minimal). `--json` is the flat `{key: value}` map with canonical keys (`--legacy-names` swaps the renamed keys back). Secrets masked exactly as today.

---

## 3. `ebx config`

### 3.1 New/changed options (all subcommands `get`, `set`, `delete`, `list`)

* `--provider ID` — resolve **bare provider keys** and list/get against provider `ID` instead of the default. Qualified keys ignore it.
* Qualified keys `providers.<id>.<key>` work for `get/set/delete`.

### 3.2 Key resolution order for `KEY` (exit 2 on failure, same error style as today)

1. `shortcuts`, `shortcuts.*` → unchanged.
2. Canonical core key or legacy alias (`api_key`→`sandbox_api_key`, `api_url`/`api_base_url`→`sandbox_base_url`, `domain`→`sandbox_domain`).
3. `providers.<id>.<key>` (qualified) — `<id>` must be built-in or installed (`E8001`), `<key>` ∈ that provider's schema or a core key it inherits (`effective_inherit`, see §1.3) — for inherited core keys the qualified form is an *override*: `providers.<id>.sandbox_base_url` is stored in `[providers.<id>]` and wins over the generic key for that provider only.
4. Bare key in the effective provider's schema (`--provider` else default). Not found → `Unknown config key: 'x'` with suggestion `Available keys: …` (same format as today, now listing core + active-provider keys) **and**, when other installed providers declare it, a second sentence: `Did you mean 'providers.<id>.x'?`.
5. Removed keys (`qwen_code_*`) → unchanged message.

### 3.3 Storage on `set`

Per `storage_phase1` while `[core] config_format` is absent or `1`, `storage_phase2` when it is `2`. Writers never delete a legacy-named stored value of the same key when writing the canonical one **unless** `config_format = 2`; in that case writing key K removes K's legacy-named copies (like today's llm migration) so a stale legacy value cannot re-appear. Clearing (`set K ""`/`delete`) removes **every** stored name of K (canonical and legacy, toml and env) — extends today's `llm_api_key` behaviour to all keys. Message strings are unchanged (`Set sandbox_base_url = …`, `Cleared sandbox_base_url (falls back to default: …)`); when the user typed a legacy key the success line echoes **the key as typed** (stdout unchanged for existing scripts).

### 3.4 Interactive hint (the only default-on signal)

After the normal stdout line, iff **stderr is a TTY** and not `--json`/`--quiet`/`--ci`/CI environment, and the typed key is a renamed legacy config key (`api_key`, `api_url`, `api_base_url`, `domain`): print to **stderr**

```
note: 'api_url' is now 'sandbox_base_url' (the old name keeps working).
```

### 3.5 `ebx config check`

```
Usage: ebx config check [--strict] [--json]

Report legacy names in use (environment, ./.env, ~/.ebx/.env, ~/.ebx/config.toml) and their canonical replacements. Values are never printed.
```

Text output (one line per finding, to stdout; nothing when clean except `No legacy names in use.`):

```
env      SANDBOX_API_KEY            -> EBX_SANDBOX_API_KEY (sandbox_api_key)
config   [transport] api_url        -> sandbox_base_url
```

`--json`: `[{"where":"env","name":"SANDBOX_API_KEY","canonical_key":"sandbox_api_key","canonical_name":"EBX_SANDBOX_API_KEY","kind":"legacy"}]`. Only `legacy` kind is reported (never `compat`/`native`). Exit 0; with `--strict` exit 1 if the list is non-empty.

### 3.6 `ebx config migrate`

```
Usage: ebx config migrate [--yes] [--dry-run]

Rewrite stored names in ~/.ebx/config.toml and ~/.ebx/.env to the canonical names (config_format = 2).
Older ebx/easy-sandbox versions will no longer read the migrated values.
```

Backs up `config.toml.bak`/`.env.bak` (0600, overwrites previous backups), prompts unless `--yes` (non-TTY without `--yes` → exit 2), supports `--dry-run` (prints `would rename X -> Y` lines, writes nothing). Sets `[core] config_format = 2`. Idempotent. The Python SDK ships the reference implementation (`transport.config.plan_migration()` / `apply_migration()`); the Node plan output must equal the Python plan for the same inputs (vector `migration-*.json`).

### 3.7 `ebx config init`

Prompt texts are **unchanged** for the built-in provider (they still say `sandbox_api_key / E2B_API_KEY`, "Alibaba Cloud AccessKey ID", …) — golden-stable. With a non-built-in default provider (or `--provider ID`), the wizard is generated from the provider's schema: one prompt per field in manifest order (`i/N Description (key[, ENV_NAME])`, secrets masked, required marked `*`), then `Stored <key> in ~/.ebx/.env` / `Set <key> = <value>`, then `Configuration complete. Review it with 'ebx config list --provider ID'.`

### 3.8 Help text deltas

`ebx config get --help` / `set --help` "Available keys" blocks gain, in this order after the current entries (and rename `api_url`/`domain` lines): `provider`, `sandbox_base_url`, `sandbox_domain`, the `acr_*` keys, `team_id`, `providers.<id>.<key>`. Wording (verbatim):

```
sandbox_base_url   Platform API URL, any E2B-protocol endpoint (e.g.
                   https://api.cn-hangzhou.e2b.fc.aliyuncs.com). Old name:
                   api_url (still accepted).
sandbox_domain     Envd data-plane domain (e.g. cn-hangzhou.e2b.fc.aliyuncs.com).
                   Old name: domain (still accepted).
provider           Default provider id (see 'ebx provider list'; default:
                   alicloud-express).
providers.<id>.<key>
                   Provider-scoped value; bare keys such as 'region' refer to the
                   default provider (or --provider ID).
```

`ebx config --help` first paragraph unchanged; add example `ebx config set providers.my-cloud.cluster prod`.

---

## 4. `--provider`, `--opt` and flag aliases

### 4.1 `--provider`

* Accepted as a **root option** (`ebx --provider ID <cmd> …`) and as a **command-level option** on every command that talks to a provider; the command-level value wins. Help: `--provider ID  Provider for this command (default: 'ebx provider default' value, else alicloud-express)`.
* Commands that take it (feature they require): `create`/`sandbox create` (`sandbox.lifecycle`), `list`/`sandbox list`, `info`, `kill`, `connect`, `exec`, `run`, `shell`, `shell-stream` (`exec.run`/`exec.stream`), `upload`/`download`/`files` (`files.rw`), `sandbox process …` (`process.manage`), `sandbox system …`, `sandbox timeout` (`sandbox.timeout`), `sandbox pause/resume` (`sandbox.pause`), `template list/info/build/deploy/delete/install/push/create` and `deploy` (`templates.read`/`templates.build`), `mcp install/start/deploy` (`sandbox.lifecycle`).
* Not provider-bound (never take it): `config` (has its own `--provider` for scoping), `template init/search`, `mcp status`, `provider *`.
* Typo hint: an unknown id adds `Did you mean 'X'?` (edit distance ≤ 2 against built-in/installed ids) to the `E8001` suggestion. Missing feature → fail **before** any side effect: exit 1, `[E8004] Provider 'ID' does not support 'FEATURE'.` + suggestion `Run 'ebx provider info ID' to see supported features.` (JSON: `{"status":"error","code":"E8004","message":…,"suggestion":…}`).
* Provider-scoped flags of the built-in provider (`--region/-r`, `--acr-*`, `--team-id`, `--vpc-id`, `--vswitch-ids`, `--security-group-id`) are accepted only when the effective provider declares the matching key; otherwise exit 2: `Option '--region' is not supported by provider 'ID'.` with suggestion `Use '--opt KEY=VALUE' for provider options (see 'ebx provider info ID').`

### 4.2 `--opt KEY=VALUE` (repeatable)

Sets a provider-scoped key for this invocation (override layer). `KEY` ∈ the effective provider's schema (or an inherited core key, as an override for this provider). Bad syntax / unknown key → exit 2 (`E8002`). `--opt` values appear in argv: for `secret` fields the CLI refuses (`E8002`: `Field 'KEY' is secret; set it with 'ebx provider config ID set KEY' or the EBX_<ID>_<KEY> environment variable.`).

### 4.3 Flag aliases (same option, same env var, same behaviour)

| Canonical | Alias | Commands |
|---|---|---|
| `--sandbox-api-key` | `--api-key` | `mcp install`, `mcp start` (+ the commands that gain it below) |
| `--sandbox-base-url` | `--api-url` | same |
| `--sandbox-domain` | `--domain` | same |
| `--acr-instance-id` | `--acree-instance-id` | template commands |

Env vars bound to flags follow §2 (flag envvar list = canonical + compat + legacy, in order). Existing `mcp install` behaviour of copying `E2B_API_URL`/`SANDBOX_REGION` into the editor config stays; it additionally copies `EBX_SANDBOX_BASE_URL`/`EBX_ALICLOUD_EXPRESS_REGION` when set in the process environment, **under the legacy names** (editor configs may be read by older versions) unless `config_format = 2`.

### 4.4 Qualified sandbox references

Input grammar: `[provider:]sandbox_id` for every command that takes a sandbox id (`info`, `kill`, `exec`, `connect`, `upload`, `download`, `files`, `sandbox process/system …`). The prefix is parsed iff the part before the first `:` matches the provider-id grammar **and** equals a built-in/installed provider id; otherwise the whole string is the id. Output format rule (identical in Python/Node): the **legacy format** (bare ids, no `provider` field) is used **only if both** the ambient provider (the configured default, ignoring `--provider`) **and** the effective provider are `alicloud-express`. In every other case printed ids are qualified (`local-process:sbx-1`) in text mode (tables and `--quiet`), and `--json` rows gain `"provider"` (the bare id stays in `sandbox_id`/`ID`). Rationale: an id pasted from output must be unambiguous when the default is later changed, yet scripts using only the built-in provider see no change. `--provider P` + reference `Q:id` with `P≠Q` → exit 2 `[E8030] Sandbox reference 'Q:id' conflicts with --provider P.`

`ebx list --all-providers` — adds a `Provider` column/key, queries every configured provider (those whose `credential` fields resolve), skips failing providers with a stderr warning (`warning: provider 'ID' skipped: <message>`), exit 0 if at least one succeeded else the first error's exit code.

---

## 5. `ebx provider`

```
Usage: ebx provider [OPTIONS] COMMAND [ARGS]...

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
  ebx provider list
  ebx provider install ./my-provider
  ebx provider install https://github.com/acme/ebx-provider-acme.git --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7
  ebx provider default acme
  ebx create --provider acme --template base
```

Related commands (also printed as the last paragraph of `ebx --help`): `ebx config`, `ebx info`.

Every subcommand honours `--json/--quiet/--ci/--no-color/--verbose` and the standard `-h/--help`.

### 5.1 `list`

`ebx provider list` → standard table, headers `["ID", "Name", "Version", "Kind", "Trust", "Default"]`, rows built-in first, then installed sorted by id; `Default` is `yes` or empty; `Kind` ∈ `builtin|rest|exec`; `Trust` ∈ `builtin|pinned|local|link|unpinned`. `--json` = the table's list-of-objects (house style, keys are the header strings). Always at least the built-in row. `--quiet` prints ids only (one per line; the standard quiet table output would be tab-separated rows — **override**: ids only, documented).

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
                     "default": "cn-hangzhou", "env": "EBX_ALICLOUD_EXPRESS_REGION",
                     "aliases": ["SANDBOX_REGION"], "description": "…", "description_zh": "…"}],
  "inherit": ["sandbox_api_key", "…"],
  "install": null
}
```

For installed providers `install` = the receipt object (§7.6 of the design) with `source.url` credentials redacted. Unknown id → exit 4 `[E8001] Provider 'x' is not installed.` (suggestion `Run 'ebx provider list'; install with 'ebx provider install <path-or-git-url>'.`).

### 5.3 `install SOURCE`

```
Usage: ebx provider install [OPTIONS] SOURCE

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
Source        https://github.com/acme/ebx-provider-local-process.git @ 4f1c2ab9… (pinned)
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
| manifest missing/invalid | E8014 | 1 | `Invalid ebx-provider.toml: <reason>.` |
| id reserved/conflict without `--force` | E8003 | 1 | `Provider id 'x' is already installed.` / `reserved` |
| digest mismatch | E8011 | 1 | `Tree digest mismatch: expected <a>, got <b>.` |
| non-interactive without `--yes` | E8012 | 2 | `Installing a provider requires confirmation.` / `Re-run with --yes after reviewing: ebx provider install <source> --ref <commit>` |
| unpinned git in non-interactive without `--allow-unpinned` | E8012 | 2 | `Refusing an unpinned git source in non-interactive mode.` / `Pass --ref <40-hex commit> or --sha256 <digest>.` |
| `--link` without `--yes`, or on Windows | E8012 | 2 | `--link requires --yes (the linked code is not pinned).` / `--link is not supported on Windows.` |
| insecure transport / credentials in URL | E8012 | 2 | `Insecure provider source 'git://…'.` / `Credentials in URLs are not accepted; use an SSH agent or a git credential helper.` |
| incompatible `requires` / protocol | E8013 | 1 | `Provider requires ebx cli >=0.4 (this is 0.3.0).` |
| path/size/symlink violations | E8010 | 1 | `Unsafe entry 'a/../b' in provider source.` etc. |

### 5.4 `uninstall ID`

Options `--purge` (also remove `[providers.<id>]` and `EBX_<ID>_*` from `~/.ebx/.env` and the `data/` dir), `-y/--yes`. Prompt `Remove provider 'ID'? [y/N]` (non-interactive without `--yes` → exit 2 `E8012`). Built-in → exit 2 `[E8003] The built-in provider cannot be removed.` If it was the default: stderr notice `Default provider reset to 'alicloud-express'.`. Unknown → exit 4 `E8001`. Success `Removed provider 'ID'`.

### 5.5 `update [ID | --all]`

Options: `--ref TEXT`, `--check`, `--all`, `-y/--yes`. `--check` prints `ID  installed → available (changes: runtime, security)` rows (table headers `["ID","Installed","Available","Changes"]`) and changes nothing (exit 0). Update applies design §7.6 (re-consent iff runtime/security/features/config-fields changed, pinned needs `--ref`, rollback on `initialize` failure). `link` and `local` installs: `[E8010] Provider 'ID' was installed from a local directory; reinstall it with 'ebx provider install --force <path>'.` (exit 1). Nothing to update: `All providers are up to date.`

### 5.6 `default [ID]`

* no arg: prints the effective default id (stdout, one line; `--json` → `{"default":"…","source":"env|dotenv|config|builtin"}`), exit 0.
* `ID`: validates it exists, writes `[core] provider = "ID"`, prints `Default provider set to 'ID'` (+ warning to stderr if `EBX_PROVIDER` is set and overrides it: `note: EBX_PROVIDER=… overrides this at runtime.`).
* `--unset`: removes the key, prints `Default provider reset to 'alicloud-express'`.
* Setting the built-in id writes nothing special (removes the key).

### 5.7 `config ID …`

```
ebx provider config ID list           # == ebx config list --provider ID
ebx provider config ID get KEY        # == ebx config get providers.ID.KEY
ebx provider config ID set KEY [VALUE]# masked prompt for secrets, same rules as `ebx config set`
ebx provider config ID unset KEY      # == ebx config delete providers.ID.KEY
ebx provider config ID init           # guided prompts from the schema (as §3.7)
```

Validation on `set`: type coercion from the manifest field type; `enum` membership; `url` must parse; `path` is stored as given; `required` fields are only enforced when a command runs. Errors → exit 2 `E8002` (`Invalid value for 'KEY': <reason>.`).

### 5.8 `doctor [ID]`

Runs without side effects: manifest valid, digest matches receipt, `requires` OK, config completeness (`required` fields resolved from which source — names only), spawns the plugin, `initialize`, compares advertised vs declared features. Output lines `ok|warn|fail  <check>  <detail>`; exit 0 all ok/warn, 1 any fail. `--json` → `[{"check":"digest","status":"ok","detail":"…"}]`. Warns when a generic `sandbox_api_key` would be sent to this provider and is also the effective key for another configured provider.

---

## 6. Node architecture (suggested; keep the Python module mirroring rule)

| Module | Responsibility |
|---|---|
| `src/utils/config_keys.ts` | registry from `config-keys.json`; `resolve()`; `exportSchema()`; alias helpers |
| `src/transport/config.ts` | `loadConfig`, `explainConfig`, `auditConfig`, `planMigration`/`applyMigration`; honours the same seams as the Python tests patch |
| `src/providers/base.ts` | `Provider`, `ProviderFeature`, `ConfigField`, `ProviderInfra` |
| `src/providers/registry.ts` | builtin + installed discovery, selection precedence (§2.2) |
| `src/providers/builtin.ts` | `alicloud-express` wrapping today's code paths (no behaviour change) |
| `src/providers/manifest.ts` | TOML parse (`smol-toml`) + all validation rules + version comparator |
| `src/providers/store.ts`, `installer.ts` | layout, lock, receipt, **tree digest**, git clone hardening, fs-safety checks, consent screen, update/rollback |
| `src/providers/exec_provider.ts` | EPP/1 client (NDJSON JSON-RPC over `child_process.spawn`, `shell:false`, scrubbed env, process-group kill), error mapping table |
| `src/providers/rest_provider.ts` | manifest-driven endpoint preset on top of the existing envd transport |
| `src/cli/commands/provider.ts` | the commands of §5 |
| `src/cli/commands/config_cmd.ts` | deltas of §3 |

Interface (wire fields stay `snake_case`):

```ts
export interface Provider {
  id: string; displayName: string; displayNameZh: string; version: string;
  kind: "builtin" | "rest" | "exec";
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

**Fixtures (copied unchanged from `docs/design/fixtures/`)**: `config-keys.json`, `config-resolution-vectors.json`, `tree-digest-vectors.json`, `epp-error-mapping.json`, `migration-vectors.json`. A test fails if a fixture differs from the Python repo's copy when both repos are checked out side by side.

1. `tests/utils/config_keys.test.ts` — registry equals `config-keys.json`; every alias row of design §5 resolves; id grammar and reserved ids; env-name derivation (`EBX_ALICLOUD_EXPRESS_ACR_VPC_ID`).
2. `tests/transport/config_resolution.test.ts` — **all vectors**; layer-first dotenv; blank values; legacy flat toml; derivation quirk; provider-scoped beats generic; no cross-provider leakage; `http_timeout_configured` equivalent.
3. `tests/cli/test_config_cmd_providers.test.ts` — key resolution order (§3.2) incl. `--provider`, qualified keys, ambiguity suggestion; phase-1 vs phase-2 storage; clearing removes every stored name; echo-as-typed; TTY-only note (TTY on: stderr line, TTY off/`--json`/`--quiet`/`--ci`: nothing); `config list` golden (renamed lines; `--legacy-names`; `--all`); `config check` (+`--strict`, JSON, never reports compat/native, never prints values); `config migrate` (dry-run, idempotent, backups 0600, matches plan vectors, refuses non-TTY without `--yes`).
4. `tests/cli/test_legacy_names_silent.test.ts` — for every legacy env/config/flag name: command output byte-identical to the canonical-name run; with `EBX_WARN_DEPRECATED=1` a stderr line per legacy name; `compat`/`native` never warn.
5. `tests/providers/manifest.test.ts` — each validation rule of design §7.5 (one test per rule), version comparator table, command-escape rule.
6. `tests/providers/store_installer.test.ts` — local dir; git via a temp bare repo (`--allow-insecure-transport` for `file://`); pinned/unpinned/`--sha256`; symlink/hardlink/traversal/case-collision/size/file-count rejections; credentials-in-URL rejection + redaction; `--link` requires `--yes`; `ls-tree` validation rejects symlink/submodule/oversize entries *before* any blob is written; unpinned wording (`tag/branch installs are not pinned`); **tree-digest vectors**; canary test (plugin writes a file if executed → must not exist after install); integrity failure after editing a file; update re-consent matrix; rollback; uninstall/purge; default fallback; lock contention; atomic swap crash-safety (kill between stage and swap leaves the old install intact).
7. `tests/providers/exec_provider.test.ts` — against `examples/providers/local-process` (copied from python-sdk): handshake, version mismatch (`E8013`), feature gating, **error mapping table**, timeouts, crash with stderr tail, malformed/oversized lines, env scrubbing (plugin echoes env: no `EBX_*`/`E2B_*`/`ALICLOUD_*`), secrets only via `initialize`, process-group kill, cancel, hybrid mode with `envd_url`; **plugin stderr is redacted** (a plugin echoing a secret to stderr: the secret never reaches the CLI's stderr, the doctor output or error messages) and the `initialize` request is never written to the debug/log output.
8. `tests/cli/test_provider_cmd.test.ts` — every command of §5: help goldens, table/JSON shapes, quiet override, exit codes, the error table, consent screen golden, non-interactive refusals, `default` messages incl. `EBX_PROVIDER` note, `doctor` output.
9. `tests/cli/test_provider_flag.test.ts` — `--provider` root+leaf precedence, missing feature fails before side effects (assert no HTTP/Docker call), provider-scoped flag rejection text, `--opt` secret refusal, qualified references, `E8030`, `list --all-providers` partial failure, JSON `provider` key only for non-builtin.
10. **Differential (oracle) cases** under `parity/diff/`: with the built-in provider only, every existing case is byte-identical except the `config list` cases (golden updated per §0). Add cases: legacy env var set vs canonical env var set → identical output for `list`, `create`, `kill` against the stub.
11. Cross-implementation conformance: install `examples/providers/local-process` from the Python repo with the **Node** installer, then load it with the **Python** SDK (and vice-versa): same receipt digest, both accept the other's receipt.

---

## 8. CLI follow-up checklist (ordered)

1. Wait for port parity (all ledger tests green, `parity:coverage` clean).
2. Copy fixtures from `python-sdk/client-sdk/tests/fixtures/` into `docs/design/fixtures/` and `tests/fixtures/` (the Python repo is the source of truth); add the fixture-identity test.
3. Implement `config_keys.ts` + the layer-first resolver; port `config_cmd.ts` onto it; keep **all** old behaviour for legacy names; regenerate `config list` goldens.
4. Add canonical env names to every flag `envvar` list, `--sandbox-*` flag aliases, `acr_*` keys via `config set`.
5. Add `config check`, `config migrate`, TTY note, `--legacy-names`, `EBX_WARN_DEPRECATED`.
6. Implement providers: manifest → store/installer (+digest) → registry/builtin → `exec_provider`/`rest_provider` → `ebx provider …` → `--provider/--opt` plumbing → qualified references → `list --all-providers`.
7. Update the CLI docs (`cli-design`, `cli-reference`, `configuration`, `environment-variables`, `authentication`, new `providers` guide) and zh mirrors; `SKILL.md`; `llms.txt`; CHANGELOG.
8. Make the `mcp install` copy rules (§4.3) and the MCP server env (`EBX_PROVIDER` is forwarded) consistent.
9. Review round with an adversary who did not write the slice (per PORTING.md), appending findings to `parity/review-log.md`.
10. Open items for later (do not build now): OS-level plugin confinement, keychain secret storage, registry/marketplace source, long-lived plugin daemons (EPP/2), gRPC transport.

---

## 9. Notes from the Python implementation (authoritative where they differ from the text above)

The Python SDK side was implemented after this spec was reviewed. These points are decisions made while implementing; the Node implementation must match them (the shared fixtures encode most of them).

1. **E8005 `ProviderResourceNotFoundError`** exists. EPP `-32002` maps to the class named by `data.sdk_code` (E2001, E4001, ...); with no `sdk_code` it maps to E8005 (not E2000). Exit code 4. `exit_code_for` order: auth → 3, not-found family (E8001, E8005, `TemplateNotFoundError`, `FileNotFound_`) → 4, timeout (`CommandTimeoutError`, E8022) → 5, quota → 6, config/trust/mismatch (E8002, E8012, E8030) → 2, else 1. `epp-error-mapping.json` is the source of truth.
2. **`sandbox.kill` is idempotent at the host adapter**: an E8005 from `sandbox.kill` is swallowed (the sandbox is already gone), so `ebx kill` of a vanished sandbox behaves like the built-in provider. Plugins should also make kill idempotent; the contract kit checks it.
3. **No-envd providers** get a marker URL `epp://<provider>/<sandbox_id>` as the sandbox's envd URL; every code path that would call envd (command listing, auth checks, terminals) must skip `epp://` URLs and use the provider's data-plane methods.
4. **Manifest `command`**: elements starting with `./` resolve inside the plugin directory and may not escape it; the consent screen prints the argv as written (`python3 ./provider.py`).
5. **Plugin environment** additionally carries `PYTHONDONTWRITEBYTECODE=1` (interpreters must not write into the digest-verified directory). Top-level `data/` is reserved for plugin state and excluded from the tree digest; `update` carries `data/` over.
6. **Process cleanup**: after the plugin exits (cleanly or not) the host still kills the process group, so grandchildren cannot outlive a session (`EppClient.close`).
7. **`close()`**: provider processes are owned by the sandbox object; the Python API gained `Sandbox.close()`. A CLI invocation must close its provider on every exit path (including `Ctrl-C`).
8. **Migration**: `apply_migration` drops an `[transport]` table that became empty after moving keys out; backups are `config.toml.bak` / `.env.bak` (mode 0600); the phase-1 storage name of `sandbox_api_key` is `E2B_API_KEY`, of `sandbox_base_url` is `api_url` (`[transport]`), and migration renames them. `migration-vectors.json` encodes the exact before/after files.
9. **`python -m easy_sandbox.providers`** is the SDK-only twin of `ebx provider` (same layout, same receipts, same digest). A provider installed by one tool must load in the other (§7 item 11).
10. **Not implemented in Python (follow-ups, same for the CLI)**: `sandbox.yaml` `provider:` / `provider_options:` and `@sandbox(provider=...)`; OS confinement; `list --all-providers` aggregation helper in the SDK (the SDK exposes `Sandbox.list(provider=...)` per provider only).


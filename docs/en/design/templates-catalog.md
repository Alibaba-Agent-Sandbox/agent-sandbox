# Templates Catalog Design

> The template catalog follows a **single source of truth (SSOT)** architecture:
> official & community template content, the machine-readable index
> (`awesome-templates.yaml`), releases and CI all converge on the dedicated
> repository [`alibaba-agent-sandbox/awesome-templates`](https://github.com/alibaba-agent-sandbox/awesome-templates).
> This repository **no longer maintains a publishable template collection** — it
> keeps only a minimal `python-hello` **offline fixture** under
> `examples/templates/`, explicitly marked as a fixture.
>
> Related documents: [CLI Design](./cli-design.md)
> (`abx template search` / `install` / `deploy`); the template contract (tiers,
> name resolution, `template.yaml`) is in the SDK's
> [Template System Design](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/template-system.md).

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  alibaba-agent-sandbox/awesome-templates (single source of truth)        │
│  ├── awesome-templates.yaml   ← machine-readable index          │
│  │                              (data source for search/install)│
│  ├── README.md / CONTRIBUTING.md  ← human index + contribution  │
│  ├── <template>/              ← content (template.yaml +        │
│  │                               Dockerfile + README.md         │
│  │                               [+ commands.py])               │
│  ├── tests/                   ← offline folder/index checks     │
│  │                              (308 test cases)                │
│  └── .github/workflows/ci.yml ← Py3.10–3.13 matrix CI           │
└─────────────────────────────────────────────────────────────────┘
          ▲ raw.githubusercontent.com (CDN, no API rate limit)
          │ fetchIndex(): cache in ~/.abx/index/ + ETag revalidation
┌─────────┴───────────────────────────────────────────────────────┐
│  main repository agent-sandbox                                    │
│  ├── src/utils/template_index.ts               ← index client    │
│  ├── src/cli/commands/template.ts              ← search/install  │
│  ├── examples/templates/python-hello/          ← minimal fixture │
│  └── tests/ (test_templates / test_utils / test_cli) ← offline   │
└─────────────────────────────────────────────────────────────────┘
```

**Ownership split**:

| Asset | Home | Notes |
|-------|------|-------|
| Official/community template content | Source-of-truth repo | Each folder: `template.yaml` + `Dockerfile` + `README.md` (plus `commands.py` when server-side commands are needed) |
| Machine-readable index | Source-of-truth repo root `awesome-templates.yaml` | The only data source for `search` / `install`; **no** file of that name exists in this repository |
| Releases & versions | Source-of-truth git tags/branches | The entry `ref` field pins a revision; no GitHub Release required |
| Directory consistency checks | Source-of-truth `tests/` + CI | Index ↔ folders ↔ README table reconciled field by field |
| Offline dev fixture | This repo's `examples/templates/python-hello/` | Used by offline unit/integration tests only; **never** add publishable templates here |
| Index client & degraded behaviour | This repo's `utils/template_index.ts` | Caching, conditional requests, rate-limit/offline fallback |

### 1.1 Why not "a mirrored copy + periodic sync"

An earlier design kept a full template copy in the main repository and
published it via `git subtree push`. That design had two structural problems:

1. **Double writes always drift**: the Qwen parameter contract
   (`max_turns` → `max_session_turns`) once diverged between the two copies —
   a direct consequence of duplicated content.
2. **Users got a stale copy**: a template list baked into the CLI can only
   refresh with SDK releases, so community templates had to wait for a new
   version before they could be discovered.

After convergence: content has exactly one write path (PRs to the
source-of-truth repo), discovery has exactly one path (the remote index), and
SDK release cadence is fully decoupled from template evolution.

---

## 2. Machine-Readable Index (`awesome-templates.yaml`)

```yaml
schema_version: 2
templates:
  - name: node-web                       # required; unique; kebab-case
    description: "Node.js web service runtime"  # human-readable (search hit source)
    repo: https://github.com/alibaba-agent-sandbox/awesome-templates  # required; github.com only
    path: node-web                       # in-repo subdir; omit if the whole repo is one template
    ref: v1.0.0                          # optional; pins a tag/branch/sha
    tags: [nodejs, web, express, api]    # searchable tags
    author: alibaba-agent-sandbox
    status: official                     # official | community | experimental
```

Conventions:

- **`schema_version`**: index format version, exactly `2`. Missing or unsupported versions fail explicitly; there is no legacy-version default. Entries locate authoritative spec-v4 manifests; they do not grant capabilities or duplicate workflow declarations.
- **`repo`**: only `github.com` `owner/repo` slugs or full URLs are accepted
  (normalised at parse time).
- **`path` / `ref` combination**: entries compose into a Terraform-style
  `owner/repo//path@ref` reference (`TemplateIndexEntry.install_ref`) handed
  straight to `RegistryClient.resolve()`; with no `path` it degrades to
  `owner/repo`.
- **`name` uniqueness**: duplicate entries fail at parse time so results never
  depend on ordering.
- Contract enforcement lives in the source-of-truth `tests/test_index.py`:
  exactly one entry per folder, fields matching `template.yaml` item by item,
  and `install_ref` parseable by the registry client.

---

## 3. Remote Index Client Behaviour (`utils/template_index.ts`)

### 3.1 Default location & overrides

| Item | Value |
|------|-------|
| Default index URL | `https://raw.githubusercontent.com/alibaba-agent-sandbox/awesome-templates/main/awesome-templates.yaml` |
| Env override | `ABX_TEMPLATE_INDEX_URL` (HTTP(S) URL or local file path) |
| CLI override | `abx template search/install --index-url <URL-or-path>` |
| Auth | `--token` > `GITHUB_TOKEN` > `./.env` > stored `github_token` (`abx config set github_token`; private mirrors, higher rate limits) |

Choosing `raw.githubusercontent.com` over `api.github.com` is deliberate: raw
files are served by a CDN and are **not** subject to the 60 req/hour anonymous
API limit; local file paths make enterprise mirrors and fully offline
deployments first-class.

### 3.2 Caching & conditional requests

- Cache lives in `~/.abx/index/` (kept separate from `~/.abx/templates/` so it
  can never be mistaken for an installed template): the index body plus
  `awesome-templates.meta.json` (`source_url` / `etag` / `fetched_at`).
- TTL `INDEX_MAX_AGE_SECONDS = 3600`: a fresh cache **makes no network call**
  (the common `search`/`install` path costs zero network).
- Once expired, an `If-None-Match` conditional request is sent; `304` only
  refreshes the metadata timestamp and reuses the cached body.
- `--refresh` / `force=True` bypasses the cache.
- A corrupt (unparseable) cache is discarded and re-fetched — garbage is never
  fed into the degraded path.

### 3.3 Degraded-mode matrix (explicit and predictable)

| Scenario | With cache | Without cache |
|----------|------------|---------------|
| Network unreachable (DNS/timeout/refused) | Stale cache + `stale=True` + warning ("using cached index") | `NetworkError` suggesting network / `GITHUB_TOKEN` / `--index-url` checks |
| GitHub rate limit (403 with `X-RateLimit-Remaining: 0`, or 429) | Same as above + warning pointing at `GITHUB_TOKEN` / `abx config set github_token` | `GitHubRateLimitError` (E5000) with the verified fine-grained PAT URL, `abx config set github_token` / `GITHUB_TOKEN` remediation, the `--token` leak warning, and a mirror hint; an interactive terminal is also offered a masked one-shot setup + exactly one retry |
| `404` | Falls into the generic network-error path | `NetworkError` suggesting verifying the index URL (`--index-url`) |
| Server errors (5xx) | Stale cache + warning | `NetworkError` |
| Other non-2xx | Stale cache + warning | `NetworkError` reporting the concrete status |
| Missing/unsupported `schema_version` | No degradation | `TemplateParseError` with `npm install -g @agent-sandbox/cli@latest` |
| Missing `templates` list / invalid YAML | No degradation | `TemplateParseError` (includes the source URL) |

Degradation is surfaced uniformly through `TemplateIndex.stale` + `notice`: the
CLI prints the warning before the results and keeps exit code 0 — a stale index
is still usable, just visibly stale.

---

## 4. CLI Behaviour (`abx template search` / `install`)

### 4.1 `abx template search <query>`

- Queries the remote index; substring match across `name` / `description` /
  `tags` / `author`; `--tag` / `--status` exact filters; `--refresh` forces a
  re-fetch; `-j` emits JSON.
- Prints a table (Name / Description / Tags / Status) plus the install hint
  `Install one with: abx template install <name> (index: <source_url>)`.
- On degradation the `notice` warning is printed before the results.

### 4.2 Bare-name resolution order for `abx template install <name>`

```
<name> is a local path?       → use it directly (no network, no index)
<name> is a builtin?          → BUILTIN_TEMPLATES = {base, code-interpreter-v1}
                                (platform images, no fetch, no index call)
<name> looks like owner/repo[//path][@ref]? → straight to RegistryClient (no index)
otherwise (bare name)         → query the remote index:
                                hit  → install_ref (possibly ref-pinned) → normal install
                                miss and cache is not stale → one forced refresh,
                                  giving freshly published templates a chance
                                still a miss → TemplateNotFoundError with a
                                  suggestion to run 'abx template search' or
                                  install directly from owner/repo//subdir
```

On an index hit the CLI prints
`Resolved '<name>' via the template index: <owner>/<repo>//<path>[@ref]`, so the
eventual source and version are auditable.

### 4.3 Version pinning & per-ref cache layout

A pinned `ref` (declared by the entry or passed explicitly with `@ref`) ends up
in the cache path `~/.abx/templates/<owner>/<repo>/<ref|default>/<path>`, so
different refs never bleed into each other. Entries without a `ref` follow the
source-of-truth default branch — "track latest" and "pin a version" are both
explicit choices.

---

## 5. Main-Repository Fixture Contract (`examples/templates/`)

`examples/templates/` is a **test-asset directory**, not a template catalog:

- Only `python-hello` may exist (`EXPECTED_FIXTURE_TEMPLATES`); any additional
  folder fails
  `tests/test_templates/test_template_catalog.test.ts` (`TestFixtureBoundary`)` immediately.
- Three explicit markers prevent it from being mistaken for a publishable
  template:
  1. directory-level `README.md` stating "this directory is NOT the publishing
     source" + a link to the source of truth + the remote install commands;
  2. a `FIXTURE` banner comment at the top of `python-hello/template.yaml`;
  3. a fixture notice block in `python-hello/README.md`.
- The fixture itself must still pass every template contract (real loader
  parse, valid capabilities, Dockerfile `FROM`) — it is the executable sample of the
  template specification.
- `python-hello` is also referenced by integration tests and golden files (CLI
  help, workflow E2E), so it is **never deleted or renamed**.

---

## 6. Test Strategy (offline-first)

### 6.1 Main repository (fully offline, no network)

| Suite | Coverage |
|-------|----------|
| `tests/test_utils/test_template_index.test.ts` | Index parsing/validation, `install_ref` construction, cache lifecycle (fresh short-circuit / force / 304), degraded matrix (offline / rate limit / 404 / 5xx / corrupt cache), token and env overrides |
| `tests/test_cli/test_template_index_commands.test.ts` | `search` output/filters/JSON/degraded notice/option passthrough; `install` bare-name index resolution, `@ref` pinning, builtin names never touching the index, friendly not-found with forced refresh |
| `tests/test_templates/test_template_catalog.test.ts` | Fixture boundary (uniqueness/markers/README contract) + fixture YAML/Dockerfile contracts |
| `tests/test_templates/test_local_install.test.ts` | The real CLI install pipeline (local tarball stubs, network tripwire guaranteeing zero egress) |

Network interception is done exclusively through the HTTP test seam (a stubbed
`fetch`) or `fetchIndex` stubs; the full unit suite runs in network-less environments
(CI sandboxes, enterprise intranets).

### 6.2 Source-of-truth repository (self-testing, evolves with content)

`tests/test_catalog.py` (32 cases) + `tests/test_index.py` (11 cases) +
`tests/test_commands_e2e.py` (10 cases): directory contracts, index
reconciliation, README table compared field by field, and the qwen-code
`max_session_turns` contract guard. CI runs on a Python 3.10–3.13 matrix
against `requirements-dev.txt` (`agent-sandbox-client[cli]` git main + pytest + pyyaml).

> Division of labour: **content correctness** belongs to the source-of-truth
> repo (a template change must update the index and README table in the same
> PR); **client behaviour** belongs to this repository (caching, degradation,
> resolution order). Neither side depends on the other's repository layout —
> they couple only through the public contract of the index file format.

---

## 7. Publishing & Contribution Flow

1. **Contribute**: open a PR against the source-of-truth repo
   (`CONTRIBUTING.md` defines the template anatomy, capability-group rules and
   local dev workflow). The PR must update `awesome-templates.yaml` and the
   README table in lock-step; the offline CI must be green.
2. **Release**: merging to `main` is the release (the index updates atomically
   with the content); tag `v1.0.0` for stable references, which users pin via
   `@v1.0.0`. **No GitHub Release needed** — `RegistryClient` resolves
   tags/branches/shas through the tarball API.
3. **Consume**: users discover via `abx template search` and install with
   `abx template install <name>`; a freshly published template is found
   immediately thanks to the single forced refresh on a cache miss, no TTL wait.
4. **Rollback**: point the entry `ref` at a known-good version; to pull a
   template urgently, remove its entry (invisible to new users; installed
   caches are unaffected).

---

## 8. Non-Goals (explicit boundaries)

| Not doing | Why |
|-----------|-----|
| Mirroring template content back into this repository | Double writes are the root problem this design eliminates |
| Keeping a copy of `awesome-templates.yaml` here | The index's single source of truth is the catalog repo; this repo only ships the client |
| Requiring an SDK release for a template update | The index mechanism already decouples the two release cadences |
| Hitting GitHub for real in unit tests | Offline-first is a hard constraint; networked checks are integration/manual |
| Automatic cross-repo sync (subtree/submodule/cron) | The catalog repo is the single entry point — no sync action, hence no sync drift |
| An Agent executing `git push` | Publishing is a human decision point |
| Deleting/renaming the `python-hello` fixture | Integration tests and golden files reference it by path; deletion breaks them |
| Reverting the `max_session_turns` contract | The parameter name established by task 181 is guarded by tests on both sides (catalog `test_commands_e2e.py`) |

---

## 9. Design Notes: Template Command Surface

These notes were carried over from the SDK's [Template System design](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/template-system.md), which owns the
template contract (tiers, name resolution, `template.yaml`, versioning). They describe the CLI side: the commands
below are design notes for the template marketplace and local cache; the commands implemented today are the ones in
[CLI Command System](cli-design.md#abx-template).

### 9.1 Local cache management commands

Templates downloaded from the GitHub tarball API are cached locally (see 4.3 for the per-ref layout used by the index
client). CLI cache management commands:

```bash
# View cached templates
abx template cache list

# Clean all caches
abx template cache clean

# Clean a specific template's cache
abx template cache clean hello/world

# Force re-download (skip cache when creating)
abx create hello/world --no-cache
```

### 9.2 Command overview

```bash
# ── Create Sandbox ─────────────────────────────
abx create python-base                       # Built-in template
abx create hello/world                       # GitHub default branch
abx create hello/world --tag v1.2.0          # GitHub specific ref (tag/branch/sha)
abx create ./my-template                     # Local template
abx create hello/world --no-cache            # Skip cache, force re-download

# ── Template Build and Push ────────────────────────
abx template build . --name my-app --tag v1.0
abx template push my-app:v1.0
abx template scaffold my-template                # Initialize template scaffolding

# ── Template Info and Search ────────────────────────
abx template info python-data-science
abx template list --market
abx template list --market --category data-science --sort stars
abx template search "machine learning gpu"

# ── Template Pull ──────────────────────────────
abx template pull community/awesome-ml-env:latest
abx template pull hello/world@v1.0.0

# ── Template Publish ──────────────────────────────
abx template push my-template --publish --category web-development

# ── Local Cache Management ──────────────────────────
abx template cache list                      # View cached GitHub tarball templates (fetched by tag/branch/sha, no Release needed)
abx template cache clean                     # Clean all caches
abx template cache clean hello/world         # Clean specific template cache

# ── Configuration ──────────────────────────────
abx config set github_token            # GitHub token: masked input, stored in ~/.abx/.env (private repos + rate limits)
abx config set github_token ""         # Remove the stored token
```

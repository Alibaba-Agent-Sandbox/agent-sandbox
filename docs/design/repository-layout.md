# Repository Layout Review: the `cli` repository

> Status: **recommendation** (architecture review, 2026-10-12). Maintainer-facing, English only. This is the
> CLI-relevant copy; the full review (Python packaging, python-sdk layout, shared decisions) is
> [`docs/en/design/repository-layout.md` in python-sdk](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/repository-layout.md).
> The two copies are not kept byte-identical; shared decisions are summarised here so this repo is self-contained.

## 0. Verdict

1. `cli` is its own repository (`github.com/alibaba-agent-sandbox/agent-sandbox`, npm `@agent-sandbox/cli`, bin `abx`), versioned
   **independently** of the Python SDK. First npm release is `0.3.0`.
2. **Keep the current `src/` tree until the parity gate, then re-home it once** (one mechanical commit)
   to `src/{bin,cli,core,agent,providers,pyparity}`. Moving earlier breaks the ledger (`tests/<python path>`) and
   the porting traceability that `docs/PORTING.md` promises; moving never would ship a layout that only makes
   sense to someone holding the Python tree.
3. **No npm workspace now.** One published package. Introduce `packages/provider-api`
   (`@agent-sandbox/provider-api`, types + `defineProvider`) when the provider plugin contract is frozen; keep
   `core` an internal directory guarded by a lint rule.
4. **Docs: the CLI owns CLI pages only.** Contract pages (template.yaml spec, error-code taxonomy, server HTTP
   API) are owned by python-sdk and linked by absolute URL. No page may exist byte-identically in both repos.
5. **`.agents/`** gets its own `README.md`, four ADRs move to python-sdk, cross-repo references become absolute
   URLs, evidence/research stay tracked and scrubbed of personal paths.
6. Publish the Node tree as one commit on top of the existing `agent-sandbox/agent-sandbox` history (tags kept), no umbrella monorepo; the SDK goes to the new `agent-sandbox/python-sdk` repository.
7. `scripts/check-repo-health.sh` encodes the definition of done; run it as the required `repo-health` CI check.

## 1. What exists today (measured)

| Fact | Evidence |
|------|----------|
| `src/` = `models utils transport protocol api session agent cli/commands framework` mirroring the Python tree, 1351-entry parity ledger keyed by `tests/<python path>` | `docs/PORTING.md`, `parity/` |
| `framework/` is not a CLI framework in the Node sense: it holds Python-stdlib/click emulation (`difflib.ts`, `py.ts`, `exceptions.ts`, `formatting.ts`); seven more Python-emulation helpers are scattered over modules: `agent/_py.ts`, `agent/_pycompat.ts`, `api/_pyerrors.ts`, `api/_shlex.ts`, `utils/_pyformat.ts`, `utils/_pypath.ts`, `models/_pydantic.ts` | `src/` |
| `package.json` bin points at `dist/bin/abx.js` but `src/bin/abx.ts` did not exist at review time | `package.json`, `src/` |
| No `.gitignore`; `node_modules` is a symlink into `/tmp/parity`; no `package-lock.json`; devDependencies (`typescript`, `vitest`, `@types/node`) and, at review time, runtime deps `yaml`/`smol-toml`/`ws`/`@inquirer/prompts` missing from `package.json`: a fresh clone cannot build | `cli/` |
| `repository.url` points at the old `agent-sandbox` repo; no `homepage`, `bugs`, `publishConfig.access` (a scoped package defaults to restricted) | `package.json` |
| `.github` has community files but **no `workflows/`**; `dependabot.yml` still lists `pip` | `.github/` |
| Python leftovers: `benchmarks/bench_cli_startup.py`, `scripts/{build_hermes,deploy_all_templates,deploy_remaining}.sh` call `agent_sandbox.cli` / `.venv/bin/python` with a hard-coded `/Users/anycodes/...Qoder...` path; `tests/_fuzz_tmp.test.ts` was a scratch file at review time | `benchmarks/`, `scripts/`, `tests/` |
| `docs/PORTING.md` cites `/tmp/agent-sandbox`, `/tmp/venv-orig`, "this VM" (not publishable as is) | file |
| The evidence README documents a generator (`scripts/capture_cli_evidence.py`) that no longer exists in either repo | `.agents/evidence/README.md` |
| 15 broken relative links, 16 dangling ADR/evidence slugs (ADRs now living in python-sdk), doc pages that link SDK-only pages (`sdk-usage.md`, `declarative-usage.md`, `design/architecture.md`, `reference/api-reference.md`) | health script |
| `npm view`: unscoped `abx` is taken by a third party; `@agent-sandbox/cli` is unpublished; npm scope ownership unverified | npm registry |

## 2. Decision C - TypeScript layout

### 2.1 Is the mirrored tree sensible for an npm CLI?

For the port: yes. As the public layout: no, for four reasons: (1) `cli/commands` nests the product's core concept
two levels deep and `cli` sits next to SDK-ish siblings; (2) the SDK-like core (`transport`, `protocol`, `api`,
`models`) has no boundary, so commands can reach into anything; (3) Python-emulation shims (`_py*`, `framework`)
are mixed with product code and cannot be found or deleted as a group; (4) file names keep Python's snake_case
(`session_manager.ts`) while Node convention is kebab-case.

### 2.2 Options

| | 1. Keep mirror forever | 2. **Re-home once after the gate (recommended)** | 3. npm workspace now (`packages/core`, `packages/cli`, providers) |
|---|---|---|---|
| Traceability to Python during the port | perfect | perfect until the gate, then via `parity/ledger-map.json` | needs a package-boundary decision before the code settles |
| Public readability / contributor onboarding | poor | good | good |
| Provider plugin support | needs a place for `providers/` anyway | `core/provider` (contract) + `providers/` (builtin) | clean (`provider-api` package) |
| Migration cost / risk | none / none | one codemod commit, tests must be green before and after (pure rename risk) | high now (publishing 3 packages, version coordination) |
| Verdict | rejected | **recommended** | deferred until a second consumer exists |

Triggers to move from 2 to 3: a third-party provider plugin needs types (publish `@agent-sandbox/provider-api`
first, as the only extra workspace package), or a TypeScript SDK is requested (extract `@agent-sandbox/core`).
Moving later is a `git mv` plus CI path changes; it is cheap, so do not pre-pay.

### 2.3 Target tree (after the parity gate)

```text
src/
├── bin/abx.ts                 # entry; built to dist/bin/abx.js (shebang preserved by tsc)
├── cli/
│   ├── main.ts  output.ts     # program, global flags, OutputManager
│   ├── commands/              # one file per command group (config, deploy, mcp, sandbox*, template, provider)
│   └── framework/             # command parsing / help rendering (from src/framework)
├── core/                      # SDK-like, no imports from cli/ or agent/ (ESLint no-restricted-imports)
│   ├── models/ transport/ protocol/ api/ session/ utils/
│   └── provider/              # provider interface, registry, plugin loader
├── agent/                     # MCP server, coding-agent integration, template authoring/adoption
├── providers/alicloud/        # builtin default provider (from api/fc_template, docker_builder bits)
└── pyparity/                  # every _py*/_pyerrors/_pyformat/_pypath/_pydantic/_shlex/difflib shim
```

Rules: file names kebab-case (ESLint `unicorn/filename-case`); `core` is import-isolated; `pyparity` is the only
place allowed to emulate Python behaviour and is deleted as parity tests stop needing it; provider plugins are
loaded dynamically (`abx provider install <path|git>`) and import only `@agent-sandbox/provider-api`.

### 2.4 Tests

* **Now**: keep `tests/<same relative path as python>.test.ts` and verbatim titles; the ledger and
  `scripts/parity-coverage.mjs` depend on them. Remove `tests/_fuzz_tmp.test.ts` (scratch).
* **Parity gate** (all must hold): (1) `npm run parity:coverage` reports 0 missing, 0 skipped of 1351; (2) the
  differential harness has 0 unexplained diffs; (3) adversarial review signed off;
  (4) tag `parity-v1`.
* **Re-home** in the same mechanical commit as the `src/` move: `tests/unit/**` mirrors the new `src/` tree,
  `tests/integration/`, `tests/golden/` (byte-exact snapshots, unchanged content), `tests/e2e/` (diff harness).
  Before moving, generate `parity/ledger-map.json` (python test id -> new `file::title`) and make the coverage
  script read it, so traceability survives the rename; titles may then be reworded freely. Afterwards archive
  `parity/` and `docs/PORTING.md` under `docs/porting/` (read-only history) and drop them from CONTRIBUTING.

## 3. Decision B (CLI part) - docs, examples, scripts

| Area | Decision |
|------|----------|
| README | root `README.md` + `README.zh-CN.md`: install (`npm i -g @agent-sandbox/cli`, binary), quick start, command overview, docs map, link to python-sdk (SDK, server runtime) |
| Docs | one tree `docs/{en,zh}/{guide,reference,design}`; CLI-owned pages: `cli-tutorial`, `cli-reference`, `cli-design`, `binary-installation`, `agent-skill-installation`, `using-templates`, `deploy-and-build`, `e2e-template-workflow`, `templates-catalog`, plus its own trimmed `getting-started`, `authentication`, `environment-variables`, `troubleshooting`, `configuration`, `mcp-integration`, `authoring-templates`. Add `guide/providers.md` (install, use, author), `guide/contributing-code.md`. `docs/design/repository-layout.md` (this file) is English-only maintainer documentation |
| Owned elsewhere (link, never copy) | `reference/template-yaml-spec`, `reference/error-codes` (taxonomy; keep CLI-specific codes such as `E2007` and the exit-code map), `reference/server-http-api`, `design/server-api`, SDK pages (`sdk-usage`, `declarative-usage`, `api-reference`, `architecture`) |
| Examples | `examples/`: CLI recipes, CI usage (`--ci --json`), a provider-plugin skeleton |
| Scripts / benchmarks | `scripts/` = repo tooling only (`parity-coverage.mjs`, `check-repo-health.sh`, `build_binary.mjs`); maintainer E2E deployment scripts go to `.agents/ops/` without personal paths; `benchmarks/startup.mjs` replaces the Python benchmark |
| Shared tooling | `.githooks` + `.secrets.baseline` (copies are fine), ESLint + Prettier + `.editorconfig` + `.nvmrc`; no Python `pre-commit` config |
| CI | `ci.yml`: `npm ci`, typecheck, lint, unit tests on Node 20/22 x Linux/macOS/Windows, `parity:coverage` until the gate, pack smoke test (`npm pack` -> install -> `abx --version`), `repo-health`; `release.yml`: tag `vX.Y.Z` -> `npm publish --provenance --access public` (OIDC); `release-binary.yml`: Node SEA binaries attached to the GitHub Release; `docs-links.yml`: scheduled `lychee` |
| Dependabot | `npm` (root) + `github-actions`; remove `pip` |

## 4. Decision D (CLI part) - `.agents/`

* Add `.agents/README.md` (what `notes/`, `evidence/`, `research/`, `design/` are; ADR rules; "a file lives where the
  code the decision changed lives").
* Move to python-sdk (contract owned there): `2026-09-02-transport-config`, `2026-09-09-server-command-registry`,
  `2026-09-03-custom-commands-schema`, `2026-09-09-docker-builder-acr-push`. Mark
  `2026-09-04-single-distribution-cli-extra` superseded (`superseded/` state, `Superseded-by:` line).
* ADR numbering stays date-slugged (no cross-repo collisions); add a generated `notes/INDEX.md`.
* All references to ADRs in the other repo become absolute URLs
  (`https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/.agents/notes/...`). Today 16 slugs dangle (e.g. the
  dual-auth, capability-model, sdk-capability-surface, release-publish-flow ADRs).
* `evidence/README.md` must describe what is actually here and how to regenerate it (a `scripts/capture-evidence.mjs`
  against the Node CLI, or remove the "AUTO-GENERATED" header); `research/README.md` must list only
  `mcp-and-agent-integration.md`; the four product research notes live in python-sdk.
* Scrub `/Users/anycodes/...`, `file:///...`, `Qoder` paths. Add ADR `2026-10-12-cli-repository-layout`.

## 5. Decision E - publishing

* No umbrella monorepo; `/workspace` stays a disposable staging area.
* The CLI keeps the existing repository `agent-sandbox/agent-sandbox` (decided by the maintainer), so stars, issues and
  the tags `v0.1.0`/`v0.2.0` stay with it: one commit replaces the tree with `/workspace/cli` (the Node rewrite) on
  top of the existing history. The SDK lives in the new
  repository `agent-sandbox/python-sdk`.
* Before the first push: add `.gitignore` (a `git add cli` today would commit the `node_modules` symlink), generate
  `package-lock.json`, fix `package.json` metadata, scrub personal paths, health script green, create the npm org
  `agent-sandbox` (verify the scope), enable branch protection (required: `ci`, `repo-health`), secret scanning,
  Discussions.

## 6. Decision F - naming and links

`agent-sandbox/agent-sandbox` (existing docs and issue forms already use it; `abx` would also be a fine repo name but would touch
every cross-link), npm `@agent-sandbox/cli`, bin `abx`, later `@agent-sandbox/provider-api`. Cross-repo links are
absolute `https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/...` URLs (CHANGELOG uses tag-pinned URLs); never
`../python-sdk`. The health script rejects relative links that leave the repo.

## 7. Ordered move plan (CLI)

Legend: **NOW** = new files or files no builder owns; **COORD** = small edit to a shared file; **LATER** = after
the builders finish; **WAIT** = after the parity gate.

| # | Step | When |
|---|------|------|
| C1 | add `.gitignore` (`node_modules`, `dist`, `coverage`, `parity/.vitest-report.json`), `.editorconfig`, `.nvmrc`, `eslint.config.js`, `.agents/README.md`, `.github/workflows/{ci,release,docs-links}.yml`, `.github/CODEOWNERS`, `scripts/check-repo-health.sh` (done) | NOW |
| C2 | `dependabot.yml`: `pip` -> `npm` | COORD |
| C3 | remove/rewrite Python leftovers (benchmark, three shell scripts), remove `tests/_fuzz_tmp.test.ts` | NOW (tests file: LATER, builders own `tests/`) |
| C4 | `docs/PORTING.md`: drop `/tmp/...` and "this VM", cite commit `b15b88f` | NOW |
| C5 | `.agents`: README, ADR moves/supersede, scrub, absolute cross-repo URLs, ADR `2026-10-12-cli-repository-layout` | NOW |
| C6 | `package.json` completion + `package-lock.json` + real `node_modules` | COORD |
| C7 | docs ownership sweep, SDK-page links to absolute URLs, `guide/providers.md`, `guide/contributing-code.md`, `examples/` | LATER |
| C8 | keep the mirrored `src/` and `tests/`; new code only in new directories (`src/providers/`, `src/core/provider/`) | until the gate |
| C9 | one mechanical commit: `git mv src/{models,transport,protocol,api,session,utils} src/core/`; `git mv src/framework src/cli/framework`; shims -> `src/pyparity/`; kebab-case renames; codemod imports; ESLint isolation rule; tests re-homed; `parity/ledger-map.json`; archive `parity/` + `PORTING.md` | WAIT (post-gate, builders frozen) |
| C10 | health script green with `--strict`; publish (section 5) | LATER (final) |

## 8. Definition of done (cli)

* [auto] README (en/zh) with Install (`npm install -g @agent-sandbox/cli`) / CLI usage / Documentation /
  Contributing / License; `LICENSE`, `NOTICE`, `CHANGELOG` (`[Unreleased]`, Keep a Changelog), `AGENTS.md`, `llms.txt`,
  `SKILL.md`.
* [auto] `package.json`: name, bin, ESM, engines, license, `repository`/`homepage`/`bugs` -> `agent-sandbox/agent-sandbox`,
  `publishConfig.access=public`, `files` whitelist, scripts `build|typecheck|test`; `package-lock.json`; every import
  declared; real, git-ignored `node_modules`; `src/bin/abx.ts`; no scratch tests; no Python leftovers; no script
  calling a CLI binary that is not this package.
* [auto] `.github`: CoC, CONTRIBUTING, SECURITY, PR template, issue forms, `ci.yml`, `release.yml` (`npm publish`,
  provenance), dependabot `npm` and `github-actions`, no `pip`; warn: binary release, CODEOWNERS, docs-links.
* [auto] docs en/zh parity; required CLI pages exist; no relative link leaves the repo; no broken link; no leaked
  local path; no byte-identical page with `../python-sdk`; `.agents/README.md`; ADR name/status valid; no dangling
  slugs; warn: providers and contributor guides, `examples/`, stale "coming soon".
* Manual: npm org + 2FA + provenance; `0.3.0` published and smoke-tested (`npx @agent-sandbox/cli --version`) on
  Linux/macOS/Windows; parity-gate evidence archived; branch protection; Discussions; repo topics.

## 9. `scripts/check-repo-health.sh`

Read-only; `--strict` makes WARN fail; `--quiet` prints only problems. Uses `bash` + `node` (>= 20). Checks: top-level
files, README/CHANGELOG headings, `.github` + CI semantics (npm vs pip, `npm ci`, `npm publish`, provenance),
`package.json` completeness and undeclared imports, symlinked `node_modules`, `.gitignore`, Python leftovers, stale
scripts, docs (en/zh parity, required pages, `examples/`), `.agents` (README, ADR rules), content hygiene (broken
relative links, links leaving the repo, leaked local paths, dangling ADR slugs, stale "coming soon", pages
byte-identical with `../python-sdk`).

Results (the builders kept writing during the review, so the numbers moved; re-run for the live state):
first run PASS 67 / WARN 13 / FAIL 25 (no `.gitignore`, no `ci.yml`, `package.json` metadata and devDependencies,
`node_modules` symlink, Python leftovers, leaked paths in 10 files); latest run PASS 83 / WARN 13 / FAIL 12:
no `release.yml`; `repository`/`homepage`/`bugs`/`publishConfig.access`; no `src/bin/abx.ts`; no `examples/`; no
`.agents/README.md`; 14 broken links; `/Users/...` paths left in 2 `.agents` evidence files; 16 dangling ADR slugs;
`template-yaml-spec` byte-identical with python-sdk. Expected end state: exit 0 with `--strict`.

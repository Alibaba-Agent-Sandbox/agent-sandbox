# Decision: Docs ownership audit — the `cli` repository documents only the CLI

Status: implemented

## Problem
`cli/docs` was created as a full copy of the pre-split documentation set. Its design index and
READMEs still sent a CLI reader to SDK pages (SDK API design, SDK architecture, server API,
template-system, `template.yaml` spec). Twelve English pages were near-duplicates of the
`python-sdk` copies and `scripts/check-repo-health.sh` flagged byte-identical pages
(`template-yaml-spec`, among others). There was no CLI-owned architecture document: the layer
breakdown of `src/` lived only in the SDK-flavoured architecture page.

## Decision
1. **Ownership principle.** Every documentation page is owned by exactly one repository and
   describes only that repository. This repository owns the `abx` command surface, its config and
   credential handling as seen from the command line, the CLI-hosted MCP server, template
   authoring/deploy workflows, binary and Agent Skill distribution, and the TypeScript port.
   The `python-sdk` repository owns the Python client/server API, the server HTTP API, the
   `template.yaml` contract and the SDK architecture.
2. **Audit.** Classification of every page (en and zh mirrors are always in step):

| Page (under `docs/{en,zh}/` unless noted) | Class | Disposition |
|---|---|---|
| `design/cli-design`, `design/templates-catalog` | CLI | kept; templates-catalog gained section 9 (cache and market command notes moved from the SDK copy) |
| `design/architecture` | CLI | new: written from `src/` and `docs/PORTING.md` (layers, directories, exit codes, build, SEA binary, parity); ends with a Related SDK section |
| `design/mcp-server` | shared concept | kept as the CLI view (`abx mcp start/deploy`, FC deploy options); SDK internals replaced by a Related SDK section |
| `design/template-system` | SDK | deleted; the SDK page owns the contract and is linked from the Related SDK section |
| `DESIGN.md` | CLI | rewritten as a CLI-only index (v3.0) |
| `README.md`, `docs/README.md` | CLI | rewritten as CLI-only guide/reference/design tables |
| `guide/cli-tutorial`, `using-templates`, `deploy-and-build`, `binary-installation`, `agent-skill-installation`, `byo-agent-integration`, `e2e-template-workflow` | CLI | kept; SDK-only sections removed (SDK code moved to the SDK first), a Related SDK section added where useful |
| `guide/getting-started`, `authentication`, `environment-variables`, `troubleshooting`, `mcp-integration`, `authoring-templates` | shared concept | kept as CLI views; Python-only sections removed after confirming the SDK page holds them; Related SDK section |
| `reference/cli-reference` | CLI | kept |
| `reference/configuration`, `reference/error-codes` | shared concept | kept as CLI views (`abx config`, exit codes 0-6, `E*` codes as printed by the CLI); the credential-resolution table is the shared contract |
| `reference/template-yaml-spec` | SDK | deleted (byte-identical duplicate); the SDK owns the `template.yaml` contract |
| `PORTING.md`, `design/repository-layout`, `design/providers-and-credentials-cli*` (+ fixtures) | CLI | untouched here (other workers); `providers-and-credentials-cli*` are listed in the design index as English-only drafts |
| `SKILL.md`, `llms.txt`, `AGENTS.md`, `README*.md` | CLI | updated to list CLI-owned docs only; `SKILL.md` unchanged (already CLI-only) |

3. **Shared concepts.** A page that both tools need (authentication, configuration, error codes,
   MCP) exists in both repositories as a view written for that repository's tool. The only content
   shared verbatim is the credential-resolution order, which is a contract documented in
   [`providers-and-credentials`](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/providers-and-credentials.md) on the SDK side
   and in `docs/design/providers-and-credentials-cli.md` here.
4. **Information moves.** Before any section was removed here, the equivalent SDK page was checked
   for the content; the few gaps were filled in the SDK first (`Sandbox.deploy` and `Image`
   in the SDK `build-and-deploy` guide, the agent workflow pattern in `sdk-usage`).
5. **Link policy.** Cross-repository links are absolute
   `https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/...` URLs in a single "Related SDK
   documentation" section per page (or a subsection of the README). SDK-only anchors are not
   referenced from CLI body text.
6. **Indexes.** `docs/README.md`, `docs/{en,zh}/README.md`, `docs/{en,zh}/DESIGN.md`,
   `README.md`, `README.zh-CN.md`, `AGENTS.md` and `llms.txt` list only CLI-owned pages and add a
   Related SDK block.

## API Design
N/A — this decision does not involve API changes.

## Alternatives considered
- **Keep parallel full copies of every page in both repositories** — rejected: the copies drift
  (several pages already differed) and a reader of one repository is sent to the other for its own
  architecture.
- **Make one repository the single home of all shared-concept pages and link from the other** —
  rejected: credential, configuration, error-code and MCP pages are read in the context of the tool
  in hand (`abx` commands versus Python calls); a pure link loses that context. Only the contract
  parts are shared (see Decision 3).
- **Create a third documentation repository** — rejected: no tooling or ownership benefit for two
  repositories, and it would split the bilingual page sets again.

## Dependencies
The `python-sdk` repository's matching audit
([ADR](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/.agents/notes/implemented/process/2026-10-12-docs-ownership-audit.md)) so that each
removed section still exists in its owning repository. No code or package dependencies.

## Test Strategy
- `scripts/check-repo-health.sh`: no relative link escapes the repository, all relative markdown
  links resolve, en/zh page sets match, no page is byte-identical with the `python-sdk` docs.
- `scripts/check-no-local-paths.sh`: the edited files add no findings.
- Manual: every removed section was diffed against the owning repository's page; the CLI README
  command examples were compared with the former SDK README examples.

## Acceptance criteria
- `docs/en/DESIGN.md` and `docs/zh/DESIGN.md` link no SDK-owned page except in the Related SDK section.
- `docs/{en,zh}/design/architecture.md` exist and describe `src/` layers, exit codes, build and parity.
- `docs/{en,zh}/design/template-system.md` and `reference/template-yaml-spec.md` do not exist.
- The check "no byte-identical doc pages shared with ../python-sdk" passes.
- Every link to the SDK repository is an absolute URL.

## Consequences
- Two copies of a shared-concept page can still drift; the credential-resolution contract is the
  one fact that must be changed in both repositories together.
- `docs/zh/design/providers-and-credentials-cli*.md` exist while the English originals are under
  `docs/design/`; the en/zh page-set check reports this until the providers worker aligns them.

## Files changed
New: `docs/{en,zh}/design/architecture.md`. Deleted: `docs/{en,zh}/design/template-system.md`,
`docs/{en,zh}/reference/template-yaml-spec.md`. Rewritten or pruned: the pages marked above plus
`README.md`, `README.zh-CN.md`, `AGENTS.md`, `llms.txt`, `docs/README.md`.

# `.agents/` — engineering record of the cli repository

Maintainer and AI-agent facing records of **why** the CLI looks the way it does. Nothing here is published to npm
(`package.json#files` is an allow-list). All new documents are written in English.

## Ownership rule

A record lives in the repository that owns the code the decision changed. ADRs for the CLI (command surface,
credential resolution, templates deploy flow, MCP integration, providers) live here; ADRs for the Python SDK, the
server runtime and the `template.yaml` schema live in
[`agent-sandbox/python-sdk`](https://github.com/alibaba-agent-sandbox/python-sdk/tree/main/.agents). Records are never
copied between repositories: link with an absolute URL
(`https://github.com/alibaba-agent-sandbox/<repo>/blob/main/<path>`), never with `../python-sdk`, never with a bare slug.

## Layout

| Path | Contents |
|------|----------|
| [`notes/`](notes/README.md) | Architecture Decision Records (ADRs), dated and slugged: `YYYY-MM-DD-<slug>.md` |
| `notes/proposed/<category>/` | Under review (`architecture`, `feature`, `process`) |
| `notes/implemented/<category>/` | Accepted and shipped |
| `notes/rejected/` | Considered and rejected, with the reasoning (flat) |
| `notes/superseded/` | Replaced by a newer ADR (flat); carries a `Superseded-by:` line |
| `design/` | Long-form design documents (for example the final CLI design) |
| [`research/`](research/README.md) | Pre-design research owned by the CLI (MCP and agent integration) |
| [`evidence/`](evidence/README.md) | Point-in-time artifacts: `evidence/cli/` (command input/output captures), `evidence/research/` (audits), `evidence/verify/` (E2E runs) |

## ADR states

`Status:` on the second line of an ADR **must** equal its state directory.

1. `proposed` — open for review.
2. `implemented` — accepted and merged; the code matches the text.
3. `rejected` — not adopted; keep it so the question is not re-litigated.
4. `superseded` — replaced; keep the file, add `Superseded-by: <slug or URL>`.

Move the file and edit `Status:` in the same commit. Required sections and the template are in
[`notes/README.md`](notes/README.md).

## Research and evidence

- **Research** answers "what is out there" before a design exists; it is not updated afterwards.
- **Evidence** is immutable once written. Captures of the original Python `abx` keep the behaviour of v0.2.0; a
  capture of the Node CLI is a new file. Never paste credentials, tokens or machine-local paths.
- Removals of obsolete files (Python leftovers and similar) are recorded as ADRs under `notes/implemented/process/`.

`scripts/check-repo-health.sh` enforces ADR naming, the `Status:`/directory match, and that no slug dangles.

## Standard E2B behavior work

The active [proposed contract](notes/proposed/architecture/2026-10-16-e2b-behavior-contract.md) defines the pinned Alibaba migration surface and project extension boundary. Verification evidence is point-in-time; read the latest E2B run before reporting completion.

The provider ownership review is recorded in [verification](evidence/verify/2026-10-16-provider-boundary-review.md); do not conflate typed command registration with complete backend adaptation.

The multi-agent review proposes [operation unification](notes/proposed/architecture/2026-10-16-provider-operation-unification.md). It remains a proposal: feature gates, resume error handling, generic CLI coverage, conditional availability and full artifact auditing still have open work.

See the [multi-agent findings and scoped verification](evidence/verify/2026-10-16-multi-agent-architecture-review.md) for fixed defects, remaining priorities and artifact limitations.
- [Provider portability and updates](notes/implemented/architecture/2026-10-18-provider-portability-updates.md) · [verification](evidence/verify/2026-10-18-provider-portability-updates.md)

- [Provider isolation verification](evidence/verify/2026-10-18-provider-complete-isolation.md)

Accepted cleanup: [retire unused CLI ports](notes/implemented/architecture/2026-10-18-retire-orphan-cli.md).
Auth migration: [explicit sandbox API keys](notes/implemented/architecture/2026-10-18-data-plane-auth-contract.md).

- [Legacy retry compatibility](notes/implemented/architecture/2026-10-18-retry-compatibility.md).
- [Layer dependency cleanup](notes/implemented/architecture/2026-10-18-layer-dependencies.md).

- [Compatible tool patches and accepted records](notes/proposed/process/2026-10-18-compatible-tool-patches.md).

- [Provider/main integration](notes/proposed/architecture/2026-10-18-provider-main-integration.md) · [verification](evidence/verify/2026-10-18-provider-main-integration.md)
- [Current-host provider integration](evidence/verify/2026-10-18-provider-current-host-checkpoint.md)

- [Provider port and file URL boundary checkpoint](evidence/verify/2026-10-18-provider-port-url-boundaries.md)

- [Standard/provider convergence](notes/proposed/feature/2026-10-18-standard-provider-convergence.md) · [verification](evidence/verify/2026-10-18-standard-provider-convergence.md)
- [MCP source/lifecycle delivery](notes/proposed/feature/2026-10-18-mcp-source-and-lifecycle.md) · [verification](evidence/verify/2026-10-18-mcp-source-and-lifecycle.md)
- [Current provider isolation and Express acceptance](evidence/verify/2026-10-18-provider-isolation-acceptance.md)

- [Final provider convergence acceptance](evidence/verify/2026-10-18-provider-convergence-acceptance.md)

- [Provider-owned metadata follow-up](evidence/verify/2026-10-18-provider-owned-metadata-followup.md)

# `.agents/` — engineering record of the cli repository

## Current public CLI 0.5.6 — 2026-10-25

[Changelog attribution correction](notes/proposed/process/2026-10-25-environment-changelog-attribution.md) keeps the later environment-guide update under Unreleased Documentation; [verification](evidence/verify/2026-10-25-environment-changelog-attribution.md) preserves its exact text and prior evidence.

[Current environment guidance](notes/proposed/process/2026-10-25-cli-environment-guidance.md) corrects terminal/process/application scope and standard-versus-native shell behavior; [verification](evidence/verify/2026-10-25-cli-environment-guidance.md) records actual published help without cloud work.

CLI **0.5.6** is published on GitHub and official npm. [Publication and public consumption](evidence/verify/2026-10-25-cli-056-publication.md) records six applicable source checks, the five-platform release, all 12 assets, independent npm/SEA checks and actual public-npm named-command error controls with owned sandbox absence. The website mirror still selected 0.5.4 at readback; website promotion is separate. This does not certify the full template/provider matrix. The [publication note](notes/proposed/process/2026-10-25-cli-056-publication.md) records this documentation follow-up; historical candidate evidence is unchanged.

## Earlier 0.5.4 preparation checkpoint — 2026-10-25

CLI 0.5.4 prepares matched Python 0.4.0a4 consumption and preserves definite native template absence as existing E2001. Python 0.4.0a4 is published; latest generated-artifact checks and CLI publication remain pending. Earlier a3 candidate receipts remain history. [Latest a4 verification](evidence/verify/2026-10-25-cli-054-public-a4-consumption.md) · [Decision](notes/proposed/process/2026-10-25-cli-054-runtime-consumption.md) · [verification](evidence/verify/2026-10-25-cli-054-runtime-consumption.md).

## Earlier public 0.5.3 delivery — 2026-10-25

CLI 0.5.3 retains the current public Python runtime across generation, scaffolding and MCP artifacts and fixes Windows journal writes. Version 0.5.2 was withheld after its real Windows artifact failure. [Decision](notes/proposed/process/2026-10-25-cli-052-release.md) and [verification](evidence/verify/2026-10-25-cli-052-release.md) distinguish candidate checks, publication and fresh public-install reruns. The [Windows correction and release verification](evidence/verify/2026-10-25-cli-053-windows-release.md) records the prepublication platform gate. CLI 0.5.3 is now public on GitHub and npm; the official website default mirror selects it. Fresh isolated installations and real managed/process/file/deadline checks passed, with exact owned resources independently confirmed absent. See the new [current regression verification](evidence/verify/2026-10-25-current-known-issue-runner.md) and [release](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.5.3). This does not certify the whole template matrix.

## Earlier delivery — 2026-10-25

CLI **0.5.1** fixes the public managed-template catalog lookup omitted in 0.5.0.
The complete spec v5 template launches through one command without a workflow
selector. Readiness commands cover overall readiness; known Server v2 endpoints
receive health/discovery checks, and all declared service endpoints are returned.

- [Public release verification](evidence/verify/2026-10-25-cli-051-public-release.md)
  records exact-head CI, artifacts, public npm installation and the actual bare
  catalog-name cloud experiment.
- [Managed catalog decision](notes/implemented/feature/2026-10-25-managed-catalog-resolution.md)
  and [candidate evidence](evidence/verify/2026-10-25-cli-051-managed-catalog.md)
  preserve the 0.5.0 failure and distinguish it from earlier fixture tests.
- [Publication decision](notes/implemented/process/2026-10-25-cli-051-public-release.md)
  keeps released packages, tags and historical evidence immutable.

The earlier delivery entries below describe historical releases, not the current
installation recommendation or a claim that every template/provider combination
has been retested by this patch.

## Historical delivery — 2026-10-24

- Published CLI: **0.4.17**, with [public distribution and actual public-package cloud regression](evidence/verify/2026-10-24-cli-0417-release.md).
- Default source preparation supports Express and OpenSandbox. [Launch instructions](../docs/en/guide/template-launch.md) and [workflow contract](../docs/en/guide/template-workflows.md) describe actual inputs, application bindings and cleanup.
- Application token compatibility preserves gateway credentials; application discovery and calls honor `ABX_HTTP_TIMEOUT`. That request deadline does not change cloud build deadlines.
- The [92-case source-template matrix](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/78c30fbbd186cb59c3a0f0abd9fdf85b10c84b35/.agents/evidence/verify/2026-10-24-public-template-matrix.md) used public CLI **0.4.16**, Python **0.3.1a5**, 46 source templates and two providers. It is not a 0.4.17 rerun or evidence for every interpreter, PTY, desktop or real-model task.
- [Issue 131](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/131), complex generated environment build timeouts, remains deferred. Request-timeout acceptance does not resolve it.

[Documentation synchronization decision](notes/implemented/process/2026-10-24-current-docs-and-records.md) · [verification and acceptance reconciliation](evidence/verify/2026-10-24-current-docs-and-records.md).

Earlier entries below are a decision history. A remaining proposal is not a current product guarantee; read the linked acceptance scope before treating its full criteria as complete.


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

- [Platform ENV argument pairs](notes/implemented/feature/2026-10-20-step-env-pairs.md) · [verification](evidence/verify/2026-10-20-step-env-pairs.md)

- [Explicit native step entry and patch publication](notes/proposed/feature/2026-10-20-native-step-entry.md) · [verification](evidence/verify/2026-10-20-native-step-entry.md)

## Standard E2B behavior work

The active [proposed contract](notes/proposed/architecture/2026-10-16-e2b-behavior-contract.md) defines the pinned Alibaba migration surface and project extension boundary. Verification evidence is point-in-time; read the latest E2B run before reporting completion.

The provider ownership review is recorded in [verification](evidence/verify/2026-10-16-provider-boundary-review.md); do not conflate typed command registration with complete backend adaptation.

The multi-agent review proposes [operation unification](notes/proposed/architecture/2026-10-16-provider-operation-unification.md). It remains a proposal. Accepted main and the latest convergence record resolve feature gates, resume error handling and much generic CLI coverage; conditional local acceptance is now recorded in the 2026-10-19 conditional-acceptance receipt; the technical artifact inventory is covered by the latest artifact-delivery verification.

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

- [Standard artifact delivery](notes/proposed/feature/2026-10-18-standard-artifact-delivery.md) · [verification](evidence/verify/2026-10-18-standard-artifact-delivery.md)
- [Provider preflight](notes/proposed/feature/2026-10-18-provider-preflight.md) · [verification](evidence/verify/2026-10-18-provider-preflight.md)

- [Conditional Express acceptance](notes/proposed/feature/2026-10-19-conditional-acceptance.md) · [verification](evidence/verify/2026-10-19-conditional-acceptance.md)

- [Provider image host merge](notes/proposed/feature/2026-10-19-provider-image-beta-merge.md) · [verification](evidence/verify/2026-10-19-provider-image-beta-merge.md)

- [Public release boundary](notes/implemented/process/2026-10-19-public-release-boundary.md) · [verification](evidence/verify/2026-10-19-public-release-boundary.md)

- [Canonical active-guide link verification](evidence/verify/2026-10-19-canonical-guide-links.md)

- [CLI0.4.0 publication](notes/implemented/process/2026-10-19-cli-040-publication.md) · [verification](evidence/verify/2026-10-19-cli-040-publication.md)

- [Npm publication recovery](notes/implemented/process/2026-10-19-npm-publication-recovery.md) · [verification](evidence/verify/2026-10-19-npm-publication-recovery.md)

- [Provider-owned template launch](notes/proposed/feature/2026-10-19-provider-template-launch.md) · [verification](evidence/verify/2026-10-19-provider-template-launch.md)
- [Express conditional support](notes/implemented/process/2026-10-19-express-conditional-support.md) · [verification](evidence/verify/2026-10-19-express-conditional-support.md)

- [Project tool deadline normalization](notes/proposed/feature/2026-10-19-project-tool-deadline.md) · [verification](evidence/verify/2026-10-19-project-tool-deadline.md)

- [Shared conditional Provider operations](notes/implemented/architecture/2026-10-20-provider-conditional-capabilities.md) · [verification](evidence/verify/2026-10-20-provider-conditional-capabilities.md)

- [Contextual Provider help and canonical runner](notes/implemented/architecture/2026-10-20-provider-context-help.md) · [Issue #83](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/83)
- [Bundled Provider SDK delivery](notes/implemented/feature/2026-10-20-bundled-provider-sdk.md) · [Issue #85](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/85)
- [Website CLI mirror installation guidance](notes/proposed/process/2026-10-20-website-cli-mirror-docs.md) · [verification](evidence/verify/2026-10-20-website-cli-mirror-docs.md)

- [Shortcut help descriptions](notes/proposed/feature/2026-10-21-shortcut-help-descriptions.md) · [verification](evidence/verify/2026-10-21-shortcut-help-descriptions.md)

- [Shortcut help patch release](evidence/verify/2026-10-21-shortcut-help-release.md) · [Issue #91](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/91)

- [CLI onboarding](notes/proposed/feature/2026-10-21-cli-onboarding.md) · [verification](evidence/verify/2026-10-21-cli-onboarding.md) · [Issue #93](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/93)

- [Release CI output](notes/proposed/process/2026-10-21-release-ci-output.md) · [verification](evidence/verify/2026-10-21-release-ci-output.md) · [Issue #95](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/95)

- [Inline template project creation](notes/proposed/feature/2026-10-21-template-project-autocreate.md) · [verification](evidence/verify/2026-10-21-template-project-autocreate.md) · [Issue #97](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/97)

- [Guided operation configuration](notes/implemented/feature/2026-10-22-guided-configuration.md) · [verification](evidence/verify/2026-10-22-guided-configuration.md) · [Issue #99](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/99)

- [Read-only npm credential diagnostics](notes/implemented/process/2026-10-22-npm-credential-diagnostics.md) · [verification](evidence/verify/2026-10-22-npm-credential-diagnostics.md)

- [Npm provenance repository capitalization](notes/implemented/process/2026-10-22-npm-provenance-repository-case.md) · [verification](evidence/verify/2026-10-22-npm-provenance-repository-case.md)

- [Remove retired project compatibility](notes/implemented/architecture/2026-10-22-remove-legacy-compatibility.md) · [verification](evidence/verify/2026-10-22-remove-legacy-compatibility.md)

- [Compatibility cleanup remote acceptance](evidence/verify/2026-10-22-remove-legacy-acceptance.md)

- [Current compatibility-removal documentation verification](evidence/verify/2026-10-22-remove-legacy-docs.md).

- [Recover interactive setup and align template commands](notes/implemented/process/2026-10-22-template-command-guidance.md) · [verification](evidence/verify/2026-10-22-template-command-guidance.md)

- [Error reporting proposal](notes/proposed/architecture/2026-10-22-error-reporting.md) (design only).

- [Command recovery review](notes/implemented/process/2026-10-23-command-recovery-review.md) · [verification](evidence/verify/2026-10-23-command-recovery-review.md)

- [Release contract recovery](notes/implemented/process/2026-10-23-release-contract-recovery.md) · [verification](evidence/verify/2026-10-23-release-contract-recovery.md)

- [npm readback recovery](notes/implemented/process/2026-10-23-npm-readback-recovery.md) · [verification](evidence/verify/2026-10-23-npm-readback-recovery.md)

- [Terminal installation and prompts](notes/implemented/feature/2026-10-23-terminal-install-prompts.md) · [verification](evidence/verify/2026-10-23-terminal-install-prompts.md)

- [Template workflows](notes/implemented/architecture/2026-10-23-template-workflows.md) · [verification](evidence/verify/2026-10-23-template-workflows.md)
- [OpenSandbox maturity](notes/implemented/process/2026-10-23-opensandbox-maturity.md) · [verification](evidence/verify/2026-10-23-opensandbox-maturity.md)

Provider installation progress: [decision](notes/implemented/feature/2026-10-23-provider-install-progress.md), [local verification](evidence/verify/2026-10-23-provider-install-progress.md).

- [Workflow review safety](notes/implemented/feature/2026-10-23-workflow-review-safety.md) · [verification](evidence/verify/2026-10-23-workflow-review-safety.md) · [Issue 122](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/122)

- [CLI 0.4.11 integration](notes/implemented/process/2026-10-24-release-integration.md) · [verification](evidence/verify/2026-10-24-release-integration.md)

- [Prompt platform steps](notes/implemented/feature/2026-10-24-prompt-platform-steps.md) · [verification](evidence/verify/2026-10-24-prompt-platform-steps.md)

Current generation fix: [Express workspace ownership](notes/implemented/feature/2026-10-24-generated-workdir-ownership.md).

- [Express source workflows](notes/implemented/feature/2026-10-24-express-source-workflows.md) · [verification](evidence/verify/2026-10-24-express-source-workflows.md).

- [Public source recipe preparation](notes/implemented/feature/2026-10-24-source-template-preparation.md) · [verification](evidence/verify/2026-10-24-source-template-preparation.md).

- [CLI 0.4.15 publication](evidence/verify/2026-10-24-cli-0415-release.md) · immutable tag, five platform assets and public npm installation.

- [Proxy application token compatibility](notes/implemented/feature/2026-10-24-proxy-application-token.md) · [verification](evidence/verify/2026-10-24-proxy-application-token.md).

- [CLI 0.4.16 publication](evidence/verify/2026-10-24-cli-0416-release.md) · five-platform assets, public npm readback and fresh installation.

- [Current provider guidance](notes/implemented/process/2026-10-24-current-provider-guidance.md) · [verification](evidence/verify/2026-10-24-current-provider-guidance.md).

- [Provider operation boundaries](notes/implemented/process/2026-10-24-provider-operation-boundaries.md) · [verification](evidence/verify/2026-10-24-provider-operation-boundaries.md).

- [Application HTTP timeout](notes/implemented/feature/2026-10-24-application-http-timeout.md) · [verification](evidence/verify/2026-10-24-application-http-timeout.md) · [Issue 147](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/147).

- [CLI 0.4.17 publication](notes/implemented/process/2026-10-24-cli-0417-public-release.md) · [public verification](evidence/verify/2026-10-24-cli-0417-release.md).

- [Generated native-step validation](notes/proposed/feature/2026-10-25-generated-steps-validation.md) · [verification](evidence/verify/2026-10-25-generated-steps-validation.md) · [Issue #157](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/157).
- [Standalone provider identity correction](notes/proposed/feature/2026-10-25-standalone-provider-identity.md) · [verification](evidence/verify/2026-10-25-standalone-provider-identity.md) · [Issue 156](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/156).

- [Docker launch prerequisite correction](notes/proposed/feature/2026-10-25-docker-launch-preflight.md) · [verification](evidence/verify/2026-10-25-docker-launch-preflight.md) · [Issue 160](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/160).

- [Native template JSON correction](notes/proposed/feature/2026-10-25-native-template-json.md) · [verification](evidence/verify/2026-10-25-native-template-json.md) · [Issue 162](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/162).

- [Generated whole-template launch](notes/proposed/feature/2026-10-25-generated-template-launch.md) · [verification](evidence/verify/2026-10-25-generated-template-launch.md).

- [Total command execution deadline](notes/proposed/feature/2026-10-25-command-total-deadline.md) · [verification](evidence/verify/2026-10-25-command-total-deadline.md) · [Issue 166](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/166).

- [Current known-issue runner](notes/implemented/process/2026-10-25-current-known-issue-runner.md) · [verification](evidence/verify/2026-10-25-current-known-issue-runner.md).

- [Configuration identifier privacy](notes/proposed/process/2026-10-25-access-key-identifier-masking.md) · [verification](evidence/verify/2026-10-25-access-key-identifier-masking.md) · [Issue175](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/175).
- [Incompatible template source guidance](notes/proposed/feature/2026-10-25-template-source-version-guidance.md) · [verification](evidence/verify/2026-10-25-template-source-version-guidance.md).

- [CLI 0.5.4 report follow-up](evidence/verify/2026-10-25-cli-054-report-follow-up.md) records the integrated candidate checks; public release and developer reruns remain separate.

- [Active Express source entry cleanup](evidence/verify/2026-10-25-cli-054-active-source-script.md) separates current argument/preflight proof from the still-blocked default Docker cloud run.

- [Managed coding-agent JSON output](notes/proposed/process/2026-10-25-managed-agent-json-output.md) · [verification](evidence/verify/2026-10-25-managed-agent-json-output.md)

- [CLI 0.5.5 final runtime consumption](evidence/verify/2026-10-25-cli-055-public-a6-consumption.md). Final publication and public developer reruns remain pending.

- [Named-command JSON errors](notes/proposed/feature/2026-10-25-named-command-json-errors.md) · [verification](evidence/verify/2026-10-25-named-command-json-errors.md) · [Issue180](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/180).

- [Verify requested MCP resources](notes/proposed/feature/2026-10-26-mcp-create-resource-verification.md) · [verification](evidence/verify/2026-10-26-cli-live-resource-verification.md).

- [Native Express Template Cache](notes/proposed/feature/2026-10-26-express-template-cache-commands.md) · [verification](evidence/verify/2026-10-26-express-template-cache-commands.md).

- [Atomic MCP shutdown registration](notes/proposed/feature/2026-10-26-mcp-shutdown-registration.md) · [verification](evidence/verify/2026-10-26-mcp-shutdown-registration.md).

- [Real template and tool acceptance](notes/proposed/process/2026-10-26-skill-template-tools-acceptance.md) · [verification](evidence/verify/2026-10-26-skill-template-tools-acceptance.md).

- [Seventeen-scenario Skill acceptance](evidence/verify/2026-10-26-skills-delivery-acceptance.md) (PARTIAL; includes installed-agent, network, cost and cleanup receipts).

- [Requirement-level Skill verification](notes/proposed/process/2026-10-26-skills-delivery-acceptance.md).

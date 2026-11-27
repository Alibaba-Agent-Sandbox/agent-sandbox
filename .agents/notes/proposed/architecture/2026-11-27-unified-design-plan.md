# Decision: Implement the unified CLI through the shared Node client
Status: proposed

## Problem

The target design changes command routing, template deployment, client selection and Agent access together. Implementing only the command names would leave credentials, helper installation, SDK behavior and resource cleanup inconsistent. Existing commands and historical verification remain evidence of their tested versions; they do not establish that the target workflow is available.

This proposal assigns the CLI repository's implementation work. It does not implement or release the design.

## Decision

The CLI consumes the Node Client SDK for Provider operations, access resolution, data protocols and helper execution. CLI code owns argument parsing, terminal output, user configuration, installation orchestration and deployment records. The shared client must remain usable without CLI state or imports.

| Task | Deliverable | Order and observable completion |
| --- | --- | --- |
| CLI-01 | Canonical command routing, static descriptions, `PATH INSTANCE`, `sandbox help INSTANCE` and TOML shortcuts | After shared operation contracts. Every accepted path reaches its declared operation; unknown paths and conflicting inputs fail before business execution. Static help neither imports helper code nor starts a runtime. |
| CLI-02 | Template initialization, source helper installation and local style selection | After source/descriptor contracts. A template containing an unpublished Node helper installs to CLI-managed dependencies; init records an explicit recommendation, installation does not set a default, and first deployment associates a prepared selection only with a confirmed cloud template identity. |
| CLI-03 | Resource YAML build/deploy/status and explicit resource cleanup | After template and Provider contracts. Build produces artifacts, deploy records actual resources and failures, status remains read-only, and deletion uses an explicitly selected real ID. Updated input cannot silently reuse an incompatible deployment description. |
| CLI-04 | Create/connect and business calls through the Node Client SDK | After the relevant Node/Provider capabilities. A protected instance created in one CLI process is usable from a later process without copying tokens; a new machine explicitly connects. Help and ordinary calls never connect or resume implicitly. |
| CLI-05 | Fixed MCP tool catalogs and the CLI operation Skill | After CLI-01 and CLI-04; helper tools also depend on CLI-02. MCP explicitly creates/connects, retains the returned access handle, invokes the selected operation and distinguishes owned from borrowed cleanup. Skill instructions describe the implemented commands and actual preparation steps. |
| CLI-06 | Installable artifacts, bilingual usage and release evidence | After the relevant preceding tasks. Test the actual npm/standalone artifacts in isolated installations, then update affected user documentation, system Skill material and changelog for the verified release. |

CLI-02 and CLI-03 may proceed independently after their contracts are fixed. A usable existing-instance path through CLI-04 does not wait for unrelated Serving deployment work. There is no compatibility command tree, implicit shell fallback, public engine command, bindings file or replacement for the removed bulk undeploy command.

## API Design

The public surface is the canonical resource tree: `template`, `sandbox`, `volume`, `provider`, `config` and `mcp`. Provider-specific account resources remain under `provider PROVIDER_ID`; a Provider's implementation location alone does not determine public routing.

The CLI projects shared operation inputs and results. Dynamic business operations use `abx sandbox <path...> INSTANCE [options]`; `abx sandbox help INSTANCE` resolves the selected instance catalog. Fixed management operations remain available when a style dependency is absent. `--help` without an instance uses static published metadata and cannot import or execute a helper.

`template style install` prepares a selected Node source and returns its precise package identity. CLI rules can select that identity, but SDK applications use their own dependencies and explicit imports. SDK clients must not read CLI installation directories, template rules, credential records or implicit HOME/CWD defaults.

Human selection hints use stderr. JSON output contains one result with selection metadata; streams retain their actual protocol. Explicit connection stores access information privately with its target and audience. Ordinary output never serializes tokens. Platform ingress authentication and explicitly selected application authentication remain separate.

## Alternatives considered

- Rename the old command tree while retaining old routing and fallback behavior: rejected because it would preserve the wrong lifecycle and discovery semantics.
- Reimplement HTTP, authentication and helpers inside the CLI: rejected because SDK-only applications would continue to behave differently.
- Install or activate helpers during help, init or first business use: rejected because these operations do not authorize code installation or execution.
- Add a cross-machine deployment takeover or bulk deletion mechanism: outside this design; explicit real-resource management already provides the required cleanup path.

## Dependencies

The companion records below target `main`. Each link becomes available when that owner's planning PR merges; publishing a plan does not establish product delivery.

- [Node client, helper and server work](https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).
- [Provider contracts and implementations](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).
- [Template and Registry YAML ownership](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).
- [Registry static distribution and discovery](https://github.com/Alibaba-Agent-Sandbox/registry/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).
- [Python contracts and independent consumer](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/.agents/notes/proposed/architecture/2026-11-27-unified-design-plan.md).

Land shared contracts before their consumers. Pin and record the actual compatible artifacts when implementing a task; this plan assigns no future version number.

## Test Strategy

For this proposal alone, validate ADR structure and links, repository health and hygiene. Do not create cloud resources to validate prose. Runtime work follows the repository definition of done, required CI/review gates, `make test`, `make lint`, `make typecheck`, build checks and applicable real-component E2E. Update affected command snapshots without rewriting historical captures.

Exercise parsing with reserved words as instance aliases, missing targets, host/business option collisions, shortcuts and unavailable styles. Use a helper import sentinel to prove static help does not execute code. Exercise unpublished local/Git helper sources, conflicting identities, uninstall and deterministic reinstall.

Use one controlled platform setup for the supported end-to-end path: initialize and customize a template, install its helper, deploy, create, run help, perform a file-backed business operation, reconnect in a separate process and delete owned resources. Verify public/protected/unknown authentication outcomes without anonymous retries. Separately inject cleanup failures to verify retryable handles and preserved errors. MCP must demonstrate an actual business result and cancellation/ownership handling, not only a handshake.

## Acceptance criteria

- CLI-01 through CLI-06 have separately recorded implementation, tested artifact and remaining-gap status; approving this ADR completes none of them.
- An ordinary CLI user can complete the supported template-to-result path without parsing internal records, manually exporting an application token or learning engine commands.
- The same Node operation and helper produce equivalent business results through the SDK and CLI; CLI-only preferences do not change SDK behavior.
- Help, status and tool listing cannot create/resume instances, install code or initiate business work. Failure preserves useful static help and identifies the missing information.
- A failed or partial deployment and a failed delete expose actual known targets and retained resources. Independent observation confirms owned test-resource cleanup.
- Required tests, real-component evidence, bilingual usage, applicable changelog, artifact checks and remote gates pass before claiming the corresponding feature delivered. Public examples describe available releases; design-only material stays in engineering records.

Document validation and review disposition: [verification](../../../evidence/verify/2026-11-27-unified-design-plan.md).

# Decision: Retain agent-sandbox Agents API delivery operations

Status: proposed

## Problem

The CLI has implementation evidence, but the cross-repository continuation, actual package verification and remaining deployment operations need one owner entry that does not depend on a workspace-only plan.

## Decision

Keep the CLI operation sequence here, indexed from .agents/README.md. Extend dated verification for every new execution; preserve old failures, warnings and source-specific results. Store only sanitized facts and commands. The existing implementation ADR remains the source of the parser and ownership decisions.

## API Design

No command/API change. This follow-up records how to verify the v1 consumer and continue the Managed deployment work.

### Verification operations

```sh
npm ci
env -u NODE_PATH make ci
bash scripts/check-repo-health.sh --quiet
make dist-check
```

Run installed-package validation using scripts/check-release-artifact.mjs against the actual installed executable, as .github/workflows defines. Do not replace that check with source imports. The f1c5d0c correction migrates a stale artifact-test manifest while retaining uncertain-outcome/provider-identity, closed-loopback, no-missing-sidecar, JSON, real terminal cancellation and license assertions. SEA native-parser support is still a separate unverified delivery shape.

### Planned cloud operations

Use `abx template init`, `abx template build`, `abx deploy --plan`, `abx deploy`, `abx status`, `abx logs`, `abx recover` and `abx delete` exactly as documented in the Managed template. logs needs actual FC logConfig. Query/control/recovery/deletion must work from recorded identity and private control auth after source/model config removal. Do not require fresh model credentials for cleanup.

Preserve the original configuration source directory when builds snapshot source without dotenv files. Keep resolved credentials and custom Worker values ephemeral; plans contain references/safe names only. Freeze AK/SK/STS once for native/component requests. Reuse generated business/internal keys across revisions, preserve old Session routing and drain, and retain ownership on uncertain results.

After operator prerequisites are available, record one real root-command build/deploy/update/old-Session/close/delete chain and independent owned cleanup. The template owner orchestrates the two Agents; CLI retains its own command and lifecycle evidence.

### Existing owner records

- [Parser, credentials, control and final local checks](../../../evidence/verify/2026-11-12-native-template-project-parser.md).
- [Adoption and declared-port preservation](../../../evidence/verify/2026-11-12-template-v1-adoption.md).
- [Implementation decision](../architecture/2026-11-12-native-template-project-parser.md).

## Alternatives considered

A shared root-only runbook leaves CLI maintainers without the exact package/lifecycle checks. Repeating cloud/model matrices adds cost without proving a new boundary. Retaining one owner sequence plus absolute cross-repository links is sufficient.

## Dependencies

Tracking: https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/309. Cross-repository links refer to owner branches
and do not assert that pending work is merged or published.

- [awesome-templates owner operations](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/feat/template-v1-migration-20261112/.agents/notes/proposed/process/2026-11-12-agents-api-delivery-operations.md).
- [python-sdk owner operations](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/feat/template-v1-runtime-20261112/.agents/notes/proposed/process/2026-11-12-agents-api-delivery-operations.md).
- [registry owner operations](https://github.com/Alibaba-Agent-Sandbox/registry/blob/feat/template-v1-registry-20261112/.agents/notes/proposed/process/2026-11-12-agents-api-delivery-operations.md).
- [blogs owner operations](https://github.com/Alibaba-Agent-Sandbox/blogs/blob/docs/agents-api-owner-records-20261112/.agents/notes/proposed/process/2026-11-12-agents-api-delivery-operations.md).

## Test Strategy

Check documentation/record links, naming/lifecycle, secret hygiene and whitespace for this record-only change. Historical make ci, Node matrix and installed-artifact outcomes stay bound to their captured product heads. Do not rerun cloud suites for prose.

## Acceptance criteria

The CLI checkout retains necessary commands, evidence locations, ownership/recovery conditions and explicit unrun gates. A green package check alone never closes real Managed cloud acceptance.

## Evidence

- [Record-placement verification](../../../evidence/verify/2026-11-12-agents-api-delivery-operations.md).

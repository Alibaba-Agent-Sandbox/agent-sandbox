# Evidence

Point-in-time artifacts that back decisions in [`../notes/`](../notes/README.md). They are kept verbatim and are not
edited afterwards (see [`../README.md`](../README.md)).

## `cli/` — command input/output captures

Each file shows the exact command invoked, its stdout, exit code and stderr (when non-empty). They were generated
offline (mocked backend, 99 cases) from the **Python `abx` v0.2.0**
([`abx` tag `v0.2.0`](https://github.com/alibaba-agent-sandbox/agent-sandbox/releases/tag/v0.2.0)) with a capture
script that did not survive the rewrite to Node.js; they are the behavioural oracle for the Node CLI, not output of
it. The original index also listed `connect.md` and `run.md`; those two files are not present in this tree. To record the Node CLI, add a new
dated file; do not regenerate these.

Node CLI captures: [provider commands](cli/2026-10-16-provider-commands.md) and
[create-time Volume mount help](cli/2026-10-16-volume-mount.md).

- [`cli/config/config.md`](cli/config/config.md)
- [`cli/create.md`](cli/create.md)
- [`cli/download.md`](cli/download.md)
- [`cli/error.md`](cli/error.md)
- [`cli/exec.md`](cli/exec.md)
- [`cli/help.md`](cli/help.md)
- [`cli/info.md`](cli/info.md)
- [`cli/kill.md`](cli/kill.md)
- [`cli/list.md`](cli/list.md)
- [`cli/mcp/mcp.md`](cli/mcp/mcp.md)
- [`cli/template/template.md`](cli/template/template.md)
- [`cli/upload.md`](cli/upload.md)
- [`cli/version.md`](cli/version.md)

## `research/` — audits

- [`research/2026-09-04-overdesign-audit.md`](research/2026-09-04-overdesign-audit.md)
- [`research/2026-09-04-qwencli-and-agents-doc-audit.md`](research/2026-09-04-qwencli-and-agents-doc-audit.md)

## `verify/` — E2E runs

- [`verify/2026-10-16-provider-management-aggregate-recheck.md`](verify/2026-10-16-provider-management-aggregate-recheck.md)
- [`verify/2026-10-16-provider-management-recheck.md`](verify/2026-10-16-provider-management-recheck.md)
- [`verify/2026-10-16-provider-management-commands.md`](verify/2026-10-16-provider-management-commands.md)
- [`verify/2026-10-16-provider-management-final-review.md`](verify/2026-10-16-provider-management-final-review.md)
- [`verify/2026-10-16-provider-command-spec-review.md`](verify/2026-10-16-provider-command-spec-review.md)

- [`verify/2026-09-08-template-deploy-e2e.md`](verify/2026-09-08-template-deploy-e2e.md)
- [`verify/2026-10-12-e2e-foundation.md`](verify/2026-10-12-e2e-foundation.md)
- [`verify/2026-10-12-cli-capability-e2e.md`](verify/2026-10-12-cli-capability-e2e.md)
- [`verify/2026-10-14-node-providers-engine.md`](verify/2026-10-14-node-providers-engine.md)

Evidence for the Python SDK and server lives in the
[`python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk/tree/main/.agents/evidence).

# Whole-template startup

Run `abx --provider PROVIDER template launch TEMPLATE --yes`. A template has one startup: the CLI prepares its contents, creates a sandbox, runs `start_cmd` when present, waits for `ready_cmd`, and resolves every service declared in `provides`. There is no workflow selector or application/exec/interpreter launch type.

Templates use `spec_version: 5`. Keep the application's services, commands, packages and startup script together. Declare all service endpoints in `provides`; a startup script can launch multiple processes. Named business commands run only when explicitly called after launch. Known Agent Sandbox Server v2 endpoints are verified using health/discovery and command listing, without executing business commands. Other service protocols use the declared readiness command and returned Provider endpoint; launch does not claim to understand their application protocol.

A source template uses its Dockerfile or supported platform build recipe. A fixed `image` or an owning `provider` plus `template_id` can identify an already prepared template; these are author-specified artifacts, not selectable execution modes. Image references require an immutable `@sha256:` digest. Provider credentials, upload, registration and platform addressing remain Provider responsibilities. The CLI checks required Provider operations before creating resources.

For public catalog managed entries, use their catalog name, for example `abx --provider alicloud-express template launch base --yes`. The CLI reads the managed manifest directly from the catalog. For an external service that is already running, connect using its server client; launching a template always creates a sandbox.

## Migrating v4

Remove `workflow_contract_version`, `default_workflow` and `workflows`; set `spec_version: 5`. Preserve all `provides` services, `start_cmd`, `ready_cmd`, environment and application code. Remove `--workflow` and `--service-url` from launch commands. The current CLI rejects v4 manifests with a migration error instead of guessing which former workflow to execute. Update the CLI and template catalog together; old binaries cannot read v5 manifests.

Existing verification receipts remain historical evidence for their recorded versions. Static operation checks are not real-platform test results and do not establish that an account or service is ready.

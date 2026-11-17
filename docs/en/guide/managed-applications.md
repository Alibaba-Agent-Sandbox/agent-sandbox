# Managed Agents applications

The [Agents API Harness family](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/docs/agents-api-harnesses.md) provides a stable Gateway, revision-specific Worker/Dispatcher functions and a reusable Sandbox template. Session compute is created by the application at runtime.

Its `template.yaml` uses named `sandbox` and `serving` resources with native FC props. Business policy belongs in that template's author-defined variables and startup code. Database access, model configuration, application authentication, revision routing and publication are owned by the template's scripts; the generic CLI does not infer them from three FC functions.

Use the template's current bilingual README for exact private environment inputs, dependencies, deployment and HTTP/SDK examples. It generates and reuses application credentials locally, verifies a candidate before moving stable ingress, and retains old Workers for existing Sessions. Keep the internal control key stable while old revisions remain.

Start deployment with the template's `abx deploy` recipe. Before deleting, run its application drain/destroy script so live Sessions and uncertain cleanup are checked. Direct generic resource deletion does not inspect the application's database. Existing database, RAM roles and supplied images remain external resources.

The current source contract differs from published older CLI releases. Build/install a matching source CLI and use the matching template revision; schema availability alone does not prove a complete business deployment has been verified.

[Generic resource configuration](template-workflows.md) · [Build/deploy](deploy-and-build.md)

Choose `agents-api-codex`, `agents-api-qwen-code`, `agents-api-claude-code`, `agents-api-qoder`, `agents-api-opencode` or `agents-api-deepseek-harness`. They share the business HTTP contract and use native credentials for each Harness. These candidate recipes require the matching new runtime release; published older packages do not supply the new adapters.

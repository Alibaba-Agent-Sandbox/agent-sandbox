# Complete template workflow

Acquire or generate editable source with [template authoring](authoring-templates.md), then follow [deploy and build](deploy-and-build.md). Use [deployment and cleanup](template-launch.md) for startup, authentication, failure recovery and ownership boundaries.

Actual verification calls the template’s business API, checks results and generated files, then deletes this run’s owned resources. A version query, health check or successful build does not replace business verification. Model tasks also require the endpoint to support the tool turns actually used by the template.

Fixed-version acceptance remains in the owning repository’s engineering evidence; it does not certify the current template, Provider, account or region. Contributors can use [end-to-end test tiers](testing-e2e.md).

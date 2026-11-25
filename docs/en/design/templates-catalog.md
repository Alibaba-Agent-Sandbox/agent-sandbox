# Template catalog and source lifecycle

The template repository owns manifests and specifications. Registry ingests them and publishes discovery data; the CLI consumes catalog entries and source references. Catalog visibility is not runtime qualification or proof of Provider support.

`template list` and `template info` read the reusable catalog. `template init --from` copies source without cloud or runtime validation, so authors can inspect a newer manifest before deployment support exists. Directory overwrite requires explicit confirmation or `--force`. It does not implicitly build or deploy.

`deploy` resolves a catalog name, Git source or local project, then validates the supported contract. Sandbox templates declare their services and readiness; the launcher prepares the Provider template, creates one Sandbox and starts the whole declared service set. Managed applications are selected by explicit `application.deployment.profile`, not merely by the presence of an HTTP server or by a specification number.

The template owner supplies a small profile normalization contract. It fills fixed mechanism defaults only when omitted. Explicit conflicting or null values remain visible to validation. Credentials, region, resource sizes and business policy are not invented by normalization. CLI and Registry consumers pin this producer and verify matching fixtures.

Authors may run `template build SOURCE` to build local Docker images without cloud registration. Resource v1 deploy reuses verified local images automatically and publishes static templates/volumes/Serving; `create --template NAME` then creates an instance. Native Steps and Serving actions execute during deploy, not local build. Existing source v5 deploy still starts its declared service set. See [native resources](../guide/native-resources.md) for the format boundary.

`template publish --tag VERSION` requires a clean committed repository, an existing GitHub remote and a new tag. It returns a commit-pinned source reference. Catalog contribution remains the owning repository's contribution workflow.

See [using templates](../guide/using-templates.md), [authoring](../guide/authoring-templates.md), [Provider operations](../guide/provider-commands.md), and the [template specification](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/docs/template-spec.md).

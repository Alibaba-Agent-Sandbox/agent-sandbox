# Template catalog and source lifecycle

The template repository owns manifests and specifications. Registry ingests them and publishes discovery data; the CLI consumes catalog entries and source references. Catalog visibility is not runtime qualification or proof of Provider support.

`template list` and `template info` read the reusable catalog. `template init --from` copies source without cloud or runtime validation, so authors can inspect a newer manifest before deployment support exists. Directory overwrite requires explicit confirmation or `--force`. It does not implicitly build or deploy.

`deploy` resolves catalog names, Git source or local projects and validates the specVersion: 1 named-resource contract. Sandbox prepares templates and static volumes; Serving deploys native components. SDKs, explicit instance commands or the template’s run.py start dynamic instances and business services. Managed references without source use `sandbox create --template`.

The template owner supplies a small profile normalization contract. It fills fixed mechanism defaults only when omitted. Explicit conflicting or null values remain visible to validation. Credentials, region, resource sizes and business policy are not invented by normalization. CLI and Registry consumers pin this producer and verify matching fixtures.

Authors may run `template build` to create reusable artifacts, then supply them to deployments with `--build`. A deployment checks source and target identity before reuse. Cleaning the deployment retains a borrowed author artifact; cleaning the artifact requires no active consumers. Native template IDs are Provider-managed references and are not claimed to be universally immutable across all backends.

`template publish --tag VERSION` requires a clean committed repository, an existing GitHub remote and a new tag. It returns a commit-pinned source reference. Catalog contribution remains the owning repository's contribution workflow.

See [using templates](../guide/using-templates.md), [authoring](../guide/authoring-templates.md), [Provider operations](../guide/provider-commands.md), and the [template specification](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/docs/template-spec.md).

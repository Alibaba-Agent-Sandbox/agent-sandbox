# Start a Sandbox template

Run `abx --provider PROVIDER deploy TEMPLATE --name my-app --yes`. A Sandbox template has one startup: prepare its source, create the instance, run `sandbox.start`, wait for `sandbox.ready`, and resolve every endpoint in `sandbox.services`. Business commands run when called after startup.

Use `specVersion: 1` and one local `template.yaml`. Source uses `sandbox.template.source`, an existing image uses `sandbox.template.image`, and a Provider-native reference uses `sandbox.provider` with `sandbox.template.reference`. Image references require an immutable `@sha256:` digest. Keep image dependencies and startup files with the project. Configure the instance in `sandbox.instance`, including its timeout, environment, metadata and the selected Provider's supported resource options.

```yaml
specVersion: 1
name: example
sandbox:
  template:
    source: {dockerfile: Dockerfile, context: .}
    props: {cpu: 2, memory: 2048}
  instance:
    timeout: 300
    envs: {ABX_SERVER_TOKEN: ""}
  start: python3 commands.py
  services:
    app: {protocol: agent-sandbox-server, version: 2, port: 9000, operations: [commands.list, commands.run]}
```

The CLI generates and privately saves a missing application token. Provider traffic authentication remains separate. See the [template v1 specification](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/docs/template-spec.md) for complete fields and Provider boundaries. Local use does not require `registry.yaml`; publication metadata and initialization questions belong there when publishing a catalog template.

Public native catalog entries can be deployed by name, for example `abx --provider alicloud-express deploy base --name my-app --yes`. Managed Agents use their [application lifecycle](managed-applications.md). General native Serving projects can be parsed, but their deployment/removal lifecycle is currently unsupported by this CLI; mixed Sandbox/Serving projects without a supported application type stop before creating resources.

Old public YAML formats must be migrated structurally to v1. Renaming their version field is insufficient. Choose a current source revision; refreshing the catalog does not refresh downloaded source files or change a pinned Git revision. The CLI does not rewrite or delete source files automatically.

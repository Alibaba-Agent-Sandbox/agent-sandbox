# CLI commands

`abx` deploys reusable templates, manages their running instances, and exposes Sandbox operations. The commands below describe the current source tree; install a CLI built from this revision when using this command layout. Released 0.5.10 uses the earlier layout.

<!-- fixed-set -->

`abx deploy`, `abx list`, `abx status`, `abx logs`, `abx delete`, `abx recover`, `abx template`, `abx sandbox`, `abx config`, `abx provider`, `abx mcp`.

## Deploy and manage

```bash
abx config init
abx deploy python-hello --name demo --yes
abx status demo
abx delete demo --yes
```

`deploy SOURCE` accepts a catalog name, a Registry source reference, or a local template directory. `--name` names the resource deployment. Omit the name to use the template's name. `--plan` validates the source and previews required resources without building or deploying. `--yes` approves changes in automation; JSON output does not grant approval.

`sandbox create --template ID --timeout 600 --yes` creates a dynamic instance from an existing native template. Its `--env`, `--metadata` and `--volume-mount` options configure creation; use `sandbox upload` for files. Deploy `--build-timeout` controls resource preparation and `sandbox exec --timeout` controls one command.

Serving declares native component configuration under `serving.<name>.props`. Reference external services and credentials through private environment values; application code and SDKs manage runtime behavior.

`list` combines local deployment records with Sandboxes from the selected Provider. `--local` avoids cloud queries; `--all-providers` queries all configured Providers. `--limit`, `--offset` and `--status` filter remote Sandbox results. Recorded deployment state is labelled separately from remote observations.

`status`, `logs` and `delete` also accept raw Sandbox IDs. A matching local name takes precedence. Use a Provider-qualified ID when you need to address a raw ID explicitly. `status --revisions` includes retained application revisions; `delete NAME --revision REVISION` retires an unused revision.

`logs NAME --resource SERVING_NAME` reads the selected Serving function’s FC logs. Use a Sandbox ID for dynamic instance logs; function log delivery must already be configured.

`recover NAME` inspects interrupted effects using saved ownership records. It never repeats an uncertain creation or publication request. Follow its result before retrying deployment or deletion. Local records live under `~/.abx/deployments`; keep them while their resources exist. A local deployment lock does not coordinate deployments from different machines.

Deleting a deployment removes its recorded owned resources. Externally supplied services and explicitly reused build artifacts remain owned by their original source. Any manually retained image artifacts are shown in the result; delete those using their registry's image-management tools when no longer needed.

## Template authoring

```bash
abx template list python
abx template info python-hello
abx template init ./my-template --from python-hello
abx template init ./my-mcp --template mcp
abx template build ./my-template --yes
abx deploy --build BUILD_FILE --name demo --yes
abx template publish ./my-template --tag v1.0.0 --yes
abx template build --clean BUILD_FILE --yes
```

`list` and `info` inspect the reusable catalog. Provider-native cloud templates are inspected through Provider operations.

`init --from` copies source without validating it for execution, building images or deploying resources. `init --template` creates a local skeleton; `--prompt` and `--adopt` are authoring options. Generated files remain editable.

`build` prepares a Provider-specific reusable artifact and preserves its source snapshot and resource journal. A build may perform billable remote work. The output identifies its artifact file. `deploy --build` verifies the source and target before using its prepared reference. Native Provider references can have Provider-specific mutability; they are not a universal immutable image format. A build in use cannot be cleaned. Managed application builds retain their image digest and locked component toolchain.

`publish` pushes a committed source version to an existing GitHub remote using a new tag and returns a commit-pinned Registry source reference. It does not create a catalog listing. Choose a new version tag for changed content; existing remote tags are never overwritten.

## Sandbox operations

Use `sandbox exec`, `sandbox connect`, `sandbox files`, `sandbox process`, `sandbox command`, `sandbox system`, `sandbox capabilities`, `sandbox pause`, `sandbox resume`, `sandbox metrics`, `sandbox snapshot`, `sandbox fork` and `sandbox network`. Commands accept a named Sandbox deployment or a native Sandbox ID. Available advanced operations depend on the Provider.

```bash
abx sandbox exec demo -- python -c 'print("hello")'
abx sandbox files list demo /home/user
abx sandbox command list demo
abx sandbox connect demo
```

## Configuration and Providers

`config init/get/set/list/delete` owns credentials, Provider configuration and defaults. Interactive configuration is saved for the current user; options and environment variables provide temporary overrides.

`provider list/info/install/update/uninstall/doctor` manages Provider plugins. `provider run OPERATION` is the single native operation execution path. `provider command list/info` preserves machine-readable descriptions and input schemas. SDK engine and contract-test tools remain available for Provider developers. Use `--help` on the selected Provider operation for supported input fields.

## MCP and output

`mcp install/start/status/stop` manages local MCP integration. Create an editable HTTP MCP service with `template init --template mcp`, then deploy it as a template.

`--json`, `--quiet`, `--verbose`, `--no-color` and `--ci` use the same parser for every command. Streaming operations emit their documented stream output. Provider selection never changes the command parser. `--help` is the authoritative option list for each command.

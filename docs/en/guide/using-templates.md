# Use a Sandbox template

These commands use the [current source CLI](binary-installation.md). Published 0.5.10 uses the earlier command layout.

## Build from the Registry, then create a Sandbox

`template list` and `template info` inspect the public catalog. Configure your Provider and its build credentials first. For Express Docker builds, prepare an image repository that you can push to. The `python-hello` template needs no model credentials. [Configuration and permissions](permissions.md)

```bash
abx config init
abx template list python
abx template info python-hello
abx template build python-hello --out .abx/hello-build.json --yes
abx create --build .abx/hello-build.json --name hello --sandbox-timeout 600 --yes
abx status hello
abx sandbox command list hello
abx sandbox command run hello hello --arg name=Ada
```

Build prepares a reusable template without starting an instance. Create uses the saved build, starts the declared service and checks readiness. The command returns `Hello, Ada!`. Use the same build file with another name to create a second Sandbox without rebuilding.

Delete each instance before cleaning its build:

```bash
abx delete hello --yes
abx template build --clean .abx/hello-build.json --yes
```

Build cleanup reports any images that still need manual removal. Verify they are unused before deleting them from your registry. [Creation and cleanup details](template-launch.md)

## Copy a template to customize it

```bash
abx template init ./hello --from python-hello
# Edit files in ./hello.
abx template build ./hello --out .abx/hello-custom-build.json --yes
abx create --build .abx/hello-custom-build.json --name hello-custom --yes
```

`init --from` only copies source to a local directory, including manifests the installed CLI may be unable to execute. Pin Git inputs with `owner/repository//subdirectory@COMMIT`. For a private GitHub source use hidden input with `abx config set github_token`, or inject `GITHUB_TOKEN` in automation.

## Use an existing native template

Check a Provider-managed catalog entry with `abx --json template info base`. A result with `source: null` and a `manifest` contains the existing `manifest.provider` and `manifest.template_id`. For the Express `base` entry:

```bash
abx --provider alicloud-express create --template-id base --name base-demo --yes
abx --provider alicloud-express delete base-demo --yes
```

Creating from a native ID uses the Provider's existing template and deleting the instance leaves that template available. To deploy a managed FC application exposing a business HTTP API, see [managed applications](managed-applications.md).

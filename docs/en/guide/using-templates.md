# Use a template

`template list` and `template info` inspect the public catalog. They do not list a cloud account's native templates. Select a source or managed entry, then deploy one named instance:

```bash
abx template list python
abx template info python-hello
abx deploy python-hello --name hello --yes
abx status hello
```

For customization, acquire editable source first. `init --from` copies files without interpreting the deployment specification; fetching a future manifest does not prove the installed CLI can deploy it.

```bash
abx template init ./hello --from Alibaba-Agent-Sandbox/awesome-templates//python-hello
abx deploy ./hello --name hello-custom --yes
```

Git references accept `owner/repository//subdirectory@COMMIT`. Pin the commit for reproducible input. For private GitHub source, use `abx config set github_token` with hidden input or `GITHUB_TOKEN` in automation. Source acquisition does not deploy, build images or create cloud resources. Managed catalog entries without source can be deployed directly but cannot be copied for editing.

Sandbox applications expose declared services. Discover Server commands with `abx sandbox command list hello`, invoke with `abx sandbox command run hello COMMAND`, and remove owned resources with `abx delete hello --yes`. Managed applications expose their own business HTTP APIs; see [managed applications](managed-applications.md).

[Authoring, reusable builds and Git publication](authoring-templates.md) · [Startup and cleanup](template-launch.md)

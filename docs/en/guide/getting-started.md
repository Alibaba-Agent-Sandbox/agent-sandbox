# Get started

Use the [installation guide](binary-installation.md), then run `abx --version` and `abx --help`. These commands use the 0.6 preview; follow [the upgrade guide](upgrading-to-0.6.md) when moving from 0.5.10.

Configure the selected Provider once. `config init` explains each credential and saves values entered interactively. For Express, a Sandbox API key authorizes runtime calls; cloud AccessKeys authorize platform management. Application and model tokens are separate.

```bash
abx config init
abx deploy --template-id base --name my-sandbox --yes
abx status my-sandbox
abx exec my-sandbox -- echo 'Hello from sandbox'
abx delete my-sandbox --yes
```

To run an application, choose a catalog template instead:

```bash
abx template list python
abx template info python-hello
abx deploy python-hello --name hello
abx status hello
abx delete hello --yes
```

The CLI prepares the source, starts it and verifies declared readiness. A template requiring Docker, an image registry or model access needs those prerequisites. Application authentication is generated and saved automatically when the template declares it. Use the returned service endpoint for external HTTP clients; they must send the application token and any Provider gateway headers.

For an already prepared native template, `--template-id` names the Provider's template or supported image reference. A local deployment name is a convenient handle saved on this host; an SDK instead connects to the actual Sandbox ID shown by `status`.

Continue with [template authoring](authoring-templates.md), [configuration](guided-configuration.md), [Sandbox operations](operations.md) or [managed applications](managed-applications.md).

[Sandbox API operations](sandbox-api.md) explains how to bind an application OpenAPI contract before using `abx sandbox TARGET --help` and invoking its operations. Templates without that declaration continue to use their documented HTTP/SDK interfaces.

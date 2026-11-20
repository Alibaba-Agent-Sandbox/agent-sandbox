# Get started

Use the [installation guide](binary-installation.md), then run `abx --version` and `abx --help`. The commands here describe current source; an older published binary may have a different surface.

Configure the selected Provider once. `config init` explains each credential and saves values entered interactively. For Express, a Sandbox API key authorizes runtime calls; cloud AccessKeys authorize platform management. Application and model tokens are separate.

```bash
abx config init
abx sandbox create --template base --yes
abx status SANDBOX_ID
abx sandbox exec SANDBOX_ID -- echo 'Hello from sandbox'
abx sandbox delete SANDBOX_ID --yes
```

To run an application, choose a catalog template instead:

```bash
abx template list python
abx template info python-hello
abx template init ./python-hello --from python-hello
cd python-hello
abx deploy . --name hello --yes
python run.py --template TEMPLATE_ID
abx sandbox delete SANDBOX_ID --yes
abx delete hello --yes
```

Deployment prepares the reusable template. Read TEMPLATE_ID from its resource result; the template’s run.py creates a dynamic instance and starts its service. Read SANDBOX_ID from that runtime result. Follow the selected template README for Python SDK prerequisites and private application authentication. Runtime lifetime and environment belong to explicit creation, not deploy.

Continue with [template authoring](authoring-templates.md), [configuration](guided-configuration.md) and [Sandbox operations](operations.md).

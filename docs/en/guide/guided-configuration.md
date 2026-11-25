# Guided configuration

Run `abx config init` to configure the selected Provider and optionally find a template to deploy. Entered supported values are saved to the current user's local configuration and reused. There is no configuration-scope menu. Existing option/environment overrides are not copied into saved configuration.

```bash
abx config init
abx config init --build
abx config init --llm
abx config list
abx --provider PROVIDER config init
```

Runtime calls need the selected Provider's API credentials and endpoint. Builds may additionally need cloud AccessKeys, Docker and registry access. Source-only `template init --from` or a built-in template needs no cloud credentials. Model-assisted `template init --prompt` or `--adopt` needs its coding tool and model key; generation writes source and stops before deployment.

| Credential | Purpose and source |
| --- | --- |
| Sandbox API key | Runtime access; obtain it from the selected Provider |
| Cloud AccessKey pair | Platform management; obtain an authorized RAM credential |
| Model API key | Model requests; obtain it from the model service |
| Application token (`ABX_SERVER_TOKEN`) | Protect the application API; generated locally by the CLI, not issued by a cloud console |
| GitHub token | Private source/rate-limited reads; use the appropriate GitHub access token |

When the template declares an empty application token, deployment generates a random value, saves it privately and reuses it for later commands. This also works with `--yes`. To choose a custom value, use hidden input with `abx config set server_token`. External clients send that application token separately from Provider traffic authentication. Changing saved configuration does not change an already running application's startup environment.

The wizard shows the selected Provider and region. Secrets use hidden input. In `config init`, Enter keeps the effective value without copying environment variables or project `.env` values to your user configuration. Ctrl+C during input cancels the current collection. If a saved value is overridden, the wizard names the variable and its source. Update or remove that override to use the saved value. Use `--verbose` for API host and managed-key details.

```bash
abx config set sandbox_api_key
abx config set llm_api_key
abx config set llm_base_url
abx config set llm_model
abx config delete llm_api_key
```

Automation supplies required values before `--yes`. JSON, quiet, CI and piped execution never open configuration questions. `config init --yes` prints setup guidance without collecting values. Missing permissions, quota, network access or a Provider capability cannot be solved by inventing configuration. Creating or renewing a cloud management key retains its separate explicit confirmation; writing an AccessKey locally is not that consent.

MCP editor registration can continue offline and does not write cloud secrets into IDE files. A remote HTTP MCP service needs application authentication and runtime Provider configuration; initialize it with `abx template init ./mcp --template mcp`, then review and deploy its source. See [MCP integration](mcp-integration.md).

A missing project is initialized explicitly with `template init`. After a failed deployment, inspect `status` and `recover`; never replay an uncertain cloud submission just because local configuration is now complete.

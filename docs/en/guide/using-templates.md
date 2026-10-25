# Using Templates

Templates are preconfigured sandbox environment definitions that include a base image, pre-installed software, declared services and startup commands, and custom commands.

---

## What Is a Template

A template is a directory containing a `template.yaml` that defines the sandbox runtime environment. Templates can:

- Specify a base Docker image and pre-installed packages
- Declare every service and its operations
- Define custom commands
- Set default environment variables and resource specifications

Project templates require `spec_version: 5` and `provides`. A single `start_cmd` starts all application services; `ready_cmd` checks readiness. Retired `capabilities`, `tested_on` and `providers` fields are rejected; there is no implicit capability grant.

---

## List Available Templates

Use `abx template search python` to search the public catalog, and `abx template list` for templates registered with the selected provider. Download source with `abx template install <ref> --download-only`; cached source is kept under `~/.abx/templates/`.

---

## Install Templates

### Install from GitHub

```bash
# Basic format: owner/repo
abx template install owner/repo

# Specify a version tag
abx template install owner/repo@v1.0

# Specify a subdirectory
abx template install owner/repo//path/to/template

# Use an alias
abx template install owner/repo --alias my-python

# Private repository / higher rate limit: save the token once (masked asterisk prompt)
abx config set github_token
abx template install owner/private-repo

# One-off override for a single command (may leak into shell history or the process list)
abx template install owner/private-repo --token ghp_xxx
```

Anonymous GitHub downloads are limited to 60 requests/hour; a saved token raises the limit to 5000/hour. Prefer `abx config set github_token` over `--token` — the latter is a one-off override that may leak into shell history or the process list. Resolution priority: `--token` > `GITHUB_TOKEN` > `./.env` > stored `github_token`. When no token is configured and the anonymous limit is hit, interactive terminals offer a guided one-shot setup (`--token` is never required).

### Install from a Local Directory

```bash
abx template install ./my-template --registry-type local
```

### Shortcut

Install with `abx template install`:

```bash
abx template install owner/repo
```

---

## Create a Sandbox from a Template

```bash
abx create my-python
```

---

## Natural Language Creation

When you are unsure which template to use, you can describe your needs in natural language:

```bash
abx create --prompt "a Python data analysis environment with pandas and matplotlib"
```

New generated applications require a separate runtime application token. Export `ABX_SERVER_TOKEN` before creation, or provide it through the existing `-e ABX_SERVER_TOKEN=...` option. The CLI validates it before model work and injects it when starting the application; it does not write the token value into generated files or build steps. Generation-only remains local. The create JSON keeps its original fields and also returns `TemplateID` and `Services` for exact cleanup and application access.

`abx create --prompt "<description>"` (without an existing template positional argument) takes the generation path: it calls Qwen Code to generate a Dockerfile, a `commands.py` HTTP server entry point (`agent_sandbox.server`) and a template.yaml, builds and deploys them, then creates the sandbox from the generated template.

For non-interactive use, add `--yes`; `--detach` is accepted and this generation path already returns without opening a terminal. Discover generation-specific options with `abx create --prompt "DESCRIPTION" --help`.

The default uses local Docker and ACR. On Express, explicitly select the existing platform steps path when Docker is unavailable:

```bash
abx create --prompt "a Python data analysis environment with pandas and matplotlib" \
  --yes --detach --build steps --dir ./generated
```

This still calls the real model. It generates self-contained `base.image` and `build.run` content, submits the template, waits for **Ready**, then creates the sandbox. Local source files are not uploaded as a COPY build context. The generated server uses the published `agent-sandbox-server==0.4.0a3` alpha from the official PyPI index; it is not a stable SDK release. Review the generated files and test their actual APIs. A model may produce invalid or unsuitable code; validation errors preserve the workspace and stop creation.

For generated native steps, the CLI uses the provider-resolved image, runtime user and workdir, installs the server, and writes the final local source bytes into the build recipe. The model only supplies business files and extra dependency commands in the existing `build.run` list. It does not encode source files or duplicate provider preparation fields. Invalid output still preserves the workspace and stops before deployment.

`abx template deploy --build steps` by itself still returns **submitted**; inspect `abx template info <id>` until Ready before creating from that template. Generation and deployment require model credentials, sandbox API configuration and AK/SK; steps does not require ACR credentials.

---

## Templates and runtime operations

`base` and `code-interpreter-v1` are platform template aliases. A registered alias is different from a project source directory. Use the provider's actual runtime operations and the template service declarations; installing Python in an image does not itself implement the code-interpreter protocol.

Project manifests explicitly bind their application service and required operations. Inspect the sandbox with `abx sandbox capabilities <id>` and list its named application commands with `abx sandbox command list <id>`. See [Authoring Templates](authoring-templates.md) and the SDK's [Template YAML Spec](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md).

---

## Custom Commands

Templates can define custom commands, invoked by users with `abx sandbox command run`:

```bash
abx sandbox command run sbx-xxxx dev --arg port=8080
```

---

## Next Steps

- [Authoring Templates](authoring-templates.md) — Create your own templates
- [CLI Tutorial](cli-tutorial.md) — Complete CLI tutorial

---

## Related SDK documentation

Creating sandboxes from templates in Python (`Sandbox.create(template=...)`, `sandbox.run()`, `sandbox.list_commands()`) is covered by the SDK's [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md). The `template.yaml` field reference is the [Template YAML Spec](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md).

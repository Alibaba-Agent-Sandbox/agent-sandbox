# Using Templates

Templates are preconfigured sandbox environment definitions that include a base image, pre-installed software, capability declarations, and custom commands.

---

## What Is a Template

A template is a directory containing a `template.yaml` that defines the sandbox runtime environment. Templates can:

- Specify a base Docker image and pre-installed packages
- Declare supported capabilities (`shell`, `files`, `code`, `terminal`, `ports`)
- Define custom commands
- Set default environment variables and resource specifications

A template that omits `capabilities` gets the default capability set `{shell, files, code}`.

---

## List Available Templates

Currently, the template list comes from locally installed templates (located in `~/.abx/templates/`). Use `abx template install` to install templates.

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
abx create --template my-python
```

---

## Natural Language Creation

When you are unsure which template to use, you can describe your needs in natural language:

```bash
abx create --prompt "a Python data analysis environment with pandas and matplotlib"
```

`abx create --prompt "<description>"` (without an explicit `--template`) takes the generation path: it calls Qwen Code to generate a Dockerfile, a `commands.py` HTTP server entry point (`agent_sandbox.server`) and a template.yaml, builds and deploys them, then creates the sandbox from the generated template.

---

## Built-in Templates

| Template | Description | Default Capabilities |
|----------|-------------|----------------------|
| `base` | Basic Ubuntu environment | `shell`, `files`, `code` |

> **Tip**: You can install more templates from the community via `abx template install`, or create your own by following [Authoring Templates](authoring-templates.md). A project that already has source code can be adapted in place with `abx template scaffold --adopt`.

---

## Capability Model

Templates declare the sandbox's supported capabilities via the `capabilities` field:

| Capability | Description | Default |
|------------|-------------|---------|
| `shell` | Execute shell commands | ✅ |
| `files` | Filesystem operations | ✅ |
| `code` | Code Interpreter code execution | ✅ |
| `terminal` | PTY terminal sessions | ❌ (must be explicitly declared) |
| `ports` | Port URL access | ❌ (must be explicitly declared) |

When a template does not declare `capabilities`, the default capability set `{shell, files, code}` is used.

---

## Custom Commands

Templates can define custom commands, invoked by users with `abx run`:

```bash
abx run sbx-xxxx dev --arg port=8080
```

---

## Next Steps

- [Authoring Templates](authoring-templates.md) — Create your own templates
- [CLI Tutorial](cli-tutorial.md) — Complete CLI tutorial

---

## Related SDK documentation

Creating sandboxes from templates in Python (`Sandbox.create(template=...)`, `sandbox.run()`, `sandbox.list_commands()`) is covered by the SDK's [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md). The `template.yaml` field reference is the [Template YAML Spec](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/template-yaml-spec.md).

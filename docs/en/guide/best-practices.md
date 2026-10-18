# Best practices

Which knob to turn, and when. Command syntax stays in the [CLI reference](../reference/cli-reference.md) and the [operations page](operations.md).

## `--provider`: one command, one backend

Pass `--provider <id>` on a single invocation when that invocation should use a plugin or a backend other than the current default. It is accepted before the sandbox ID for exec; other commands retain their global option positions (`abx create --provider my-cloud --template base`).

Leave it off when every command should use the built-in `alicloud-express`. That is the default, and sandbox ids stay bare. Set a lasting default with `abx provider default <id>` or `ABX_PROVIDER` when the whole shell should switch. A sandbox id that already starts with a known provider (`my-cloud:sbx-1`) selects that provider by itself; `--provider` must name the same id.

Provider options for one command are `--opt KEY=VALUE`. A field marked `secret` in the manifest is refused on the command line. Store it with `abx config set providers.<id>.<key>`, which prompts with the value masked.

Full order and install steps: [Providers](providers.md). Writing a plugin: [Authoring providers](authoring-providers.md).

## `--model`: one generation, one model id

`--model <id>` is a flag on the commands that ask the coding agent to write a template:

- `abx create --prompt "<description>" --model <id>`
- `abx template scaffold --prompt "<description>" --model <id>`
- `abx template scaffold --adopt <directory> --model <id>`

It overrides `llm_model`, `ABX_LLM_MODEL`, and `OPENAI_MODEL` for that command only. Use it when the endpoint rejects the stored model, or when one description should be drafted with a different id. An interactive terminal can offer a replacement and store the choice; a non-interactive run keeps the flag you passed.

`--model` does not select the program inside a sandbox. `abx exec`, `abx run`, and `abx sandbox` ignore it.

## `llm_model`: the model you want every generation to use

`llm_model` is the stored name of the model that drafts templates. The default is `qwen3-coder-plus`.

```bash
abx config set llm_model qwen3-coder-plus
```

For one shell, export `ABX_LLM_MODEL` (then `OPENAI_MODEL` if that is unset). A process environment variable wins over `./.env`, which wins over the value stored by `abx config set`. `abx config list` shows which layer won. The key, the base URL, and this model name are the LLM profile; they are separate from the sandbox API key.

## Credentials

| What you are calling | Store it as | Command |
|---|---|---|
| The sandbox control plane | `sandbox_api_key` (`E2B_API_KEY`) | `abx config set sandbox_api_key` |
| Template build and deploy (AccessKey) | `access_key_id`, `access_key_secret` | `abx config set access_key_id` and `access_key_secret` |
| Natural-language template generation | `llm_api_key` (`ABX_LLM_API_KEY`, then Bailian, DashScope, and OpenAI names) | `abx config set llm_api_key` |
| A provider plugin secret | `providers.<id>.<key>` in `~/.abx/.env` | `abx config set providers.<id>.<key>` |
| Template download from GitHub | `github_token` | `abx config set github_token` |

`abx config init` walks through the platform key, region, LLM key, ACR namespace, and AccessKey once. Omit the value on a secret key and the prompt masks it. `abx config list` prints sources and masks secrets. `abx config get` of a secret prints the mask, not the value.

Resolution order and the name aliases: [Configuration](../reference/configuration.md#credential-resolution) and [Authentication](authentication.md).

## Standalone binary

Install the single-file `abx` binary when the machine should not need Node.js: a CI image, an agent host, or a copy taken from a GitHub release asset. The binary contains the Node runtime and the CLI. The commands on the [operations page](operations.md) are the same.

Use the binary installer or a locally built npm archive. The public npm package is not published; the source package requires Node.js20+. See [installation](binary-installation.md).

Checksums, platforms, and the install commands: [Binary installation](binary-installation.md).

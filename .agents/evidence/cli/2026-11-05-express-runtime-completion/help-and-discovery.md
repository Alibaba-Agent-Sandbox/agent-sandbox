# CLI evidence: Express runtime completion

Date: 2026-11-05. Source CLI help and catalog discovery; no backend or credentials.
Base: `b77b75d91617483bc088f28b8eaecf74cbea711a`, task branch `fix/express-api-completion-20261105`.

All commands use `node --import tsx src/bin/abx.ts` with only PATH and locale inherited. Help does not authorize lifecycle operations.

## `abx --native create --help`

```text
Usage: abx create [options] [TEMPLATE_NAME]

Create a new sandbox.

'abx create' is the shortcut of 'abx sandbox create'. A positional argument
selects a template; the default is base. Natural language uses --prompt.

  abx create base                        launch the base template
  abx create code-interpreter-v1         launch an existing template
  abx create --prompt "DESCRIPTION"      generate a template, build and launch

--prompt and an explicit template cannot be combined.

--timeout is the sandbox lifetime in seconds (default: 300).

Examples:
  abx create base              # explicit 'base' template
  abx create -e API_KEY=xxx -e DEBUG=1    # inject env vars
  abx create --upload ./app --timeout 600 # upload dir, 10-min lifetime
  abx create --prompt "a python data science env"  # generate, build, deploy,
create
  abx create -y --prompt "a node.js api server"    # non-interactive full
pipeline
  abx create -y --detach --build steps --prompt "a Python data analysis API"
  abx template scaffold --prompt "a python data science env"  # template files
only

Notes:
  Template generation needs the Qwen Code CLI and a DashScope/ModelStudio
  key ('abx config init --llm'); building and deploying also needs
  'abx config init --build'. It researches publicly verifiable facts
  itself (tool stack, official install method, common dependencies) and
  only asks for private preferences or business decisions it cannot
  infer — one question at a time in interactive sessions. Non-interactive
  shells must pass --yes to generate without asking. To generate local
  template files only, use abx template scaffold --prompt "DESCRIPTION".
  Application authentication is generated, saved locally and reused
automatically.
  Optionally supply your own ABX_SERVER_TOKEN in the environment (or -e).
  --detach is accepted on this path: generated sandboxes already return
  without opening a terminal. --build steps uses platform build steps
  instead of local Docker/ACR; the default build path stays unchanged.

Related commands:
  abx list                 List existing sandboxes
  abx info SANDBOX_ID      Inspect a created sandbox
  abx template scaffold DIR    Scaffold a new template project (local)
  abx template scaffold --prompt "DESC" Generate a template only (no build)
  abx template search KEY  Find reusable templates
  abx config init          Set credentials and region

Options:
  --prompt <PROMPT>                Generate a sandbox from a natural-language
                                   description. Mutually exclusive with a
                                   template.
  -d, --detach                     Return after creation without opening a
                                   terminal (already the default for --prompt).
                                   Does not replace --yes.
  -T, --template <TEMPLATE>        Provider-native template reference (e.g.
                                   'base'); Express uses a platform ID or
                                   already registered alias. Git Registry source
                                   uses template launch. Defaults to 'base' when
                                   omitted. Cannot be combined with DESCRIPTION.
  -u, --upload <PATH>              Local file or directory to upload after
                                   creation
  -t, --timeout <INTEGER>          Sandbox lifetime in seconds (positive
                                   integer; default: 300)
  --request-timeout <FLOAT>        HTTP request timeout in seconds for the
                                   create call (floor: 120s for cold starts, or
                                   your configured http_timeout if larger).
                                   Increase for very slow sandbox creation.
  -e, --env <ENV>                  Environment variable for the sandbox, format
                                   KEY=VALUE (repeatable)
  -m, --metadata <METADATA>        Metadata key-value pair, format KEY=VALUE
                                   (repeatable)
  --volume-mount <PATH=NAME>       Mount an existing same-Team Volume by name at
                                   an absolute Unix path (Express only;
                                   repeatable)
  --network-file <FILE>            Native Express create: read snake_case
                                   network configuration from a private JSON
                                   file. Does not change standard create
                                   semantics.
  --traffic-token-output <FILE>    Explicitly save the created public-port
                                   gateway token to a new private 0600 file;
                                   never print it.
  -y, --yes                        Skip interactive prompts (the template-only
                                   switch, Qwen Code install, credentials,
                                   description clarification, build/deploy
                                   confirmation) and run the full create
                                   pipeline. Required for template generation in
                                   non-interactive shells.
  --model <MODEL>                  Model id for the template generation step
                                   (for example qwen3-coder-plus). Overrides
                                   llm_model / ABX_LLM_MODEL / OPENAI_MODEL for
                                   this command. When the endpoint rejects the
                                   model, an interactive terminal offers coding
                                   and chat models with the arrow keys.
  --acr-namespace <ACR_NAMESPACE>  ACR namespace for building the generated
                                   template (env: ACR_NAMESPACE, or set in .env
                                   file)
  --build <BUILD>                  Generated template publish path. steps
                                   generates self-contained platform steps
                                   without local Docker/ACR; auto keeps the
                                   Dockerfile default. [default: auto] (choices:
                                   "auto", "dockerfile", "steps")
  --dir <DIRECTORY>                Parent directory for the generated template
                                   files (Dockerfile, commands.py,
                                   template.yaml); a new <name>-<timestamp>-<id>
                                   subfolder is created inside it. Default:
                                   ~/.abx/generated (an interactive terminal is
                                   asked when omitted).
  -v, --verbose                    Verbose output (DEBUG level)
  -h, --help                       Show this message and exit.
[exit_code:0]
```

## `abx --native sandbox pause --help`

```text
Usage: abx sandbox pause [options] <SANDBOX_ID>

Pause an existing sandbox using the selected provider's declared operation.

Options:
  -h, --help  Show this message and exit.
[exit_code:0]
```

## `abx --native sandbox resume --help`

```text
Usage: abx sandbox resume [options] <SANDBOX_ID>

Resume an existing sandbox using the selected provider's declared operation.

Options:
  -h, --help  Show this message and exit.
[exit_code:0]
```

## `abx --native sandbox timeout --help`

```text
Usage: abx sandbox timeout [options] <SANDBOX_ID> <SECONDS>

Set an existing sandbox lifetime in seconds without connecting or resuming.

Options:
  -h, --help  Show this message and exit.
[exit_code:0]
```

## `abx --native run --help`

```text
Usage: abx run [options] <SANDBOX_ID> <COMMAND_NAME>

Run a named command registered in the sandbox.

'abx run' is the shortcut of 'abx sandbox command run'.

Named commands are functions the template registers on the SandboxServer
that runs inside the sandbox (``POST /commands/NAME``). List them with
'abx sandbox command list SANDBOX_ID'. Arguments are validated and
converted by the server according to the registered signature.

Pass arguments with --arg KEY=VALUE (repeatable) and/or --json-args
'{"key": value}' for typed values. The command's return value is printed
(JSON with --json). Fails with a clear error when the sandbox has no
server.

Examples:
  abx run abc123 build
  abx run abc123 test --arg file=tests/
  abx run abc123 add --json-args '{"x": 1, "y": 2}'
  abx --json run abc123 greet --arg name=Ada

Related commands:
  abx sandbox command list SANDBOX_ID   List the registered commands
  abx exec SANDBOX_ID -- CMD            Run an arbitrary command
  abx info SANDBOX_ID                   Inspect the target sandbox

Options:
  -a, --arg <ARGS>             Command argument, format KEY=VALUE (repeatable)
  --json-args <JSON_ARGS>      Command arguments as a JSON object, e.g. '{"x":
                               1}' (for typed values)
  --server-port <INTEGER>      Port of the SandboxServer inside the sandbox
                               (default: 9000)
  --traffic-token-file <FILE>  Read the separate public-port gateway token from
                               a private 0600 file; does not renew or resume the
                               sandbox.
  -h, --help                   Show this message and exit.
[exit_code:0]
```

## `abx --native sandbox command list --help`

```text
Usage: abx sandbox command list [options] <SANDBOX_ID>

List the named commands registered in a sandbox.

Shows each command's name, argument signature and description, read from
the SandboxServer in the sandbox. Errors when no server is reachable.

Examples:
  abx sandbox command list abc123
  abx --json sandbox command list abc123

Related commands:
  abx run SANDBOX_ID NAME    Run one of them
  abx sandbox capabilities SANDBOX_ID

Options:
  --server-port <INTEGER>      Port of the SandboxServer inside the sandbox
                               (default: 9000)
  --traffic-token-file <FILE>  Read the separate gateway token from a private
                               0600 file without renewing the sandbox.
  -h, --help                   Show this message and exit.
[exit_code:0]
```

## `abx provider command info alicloud-express sandbox.mounts.append`

```text
[write] Append named or inline mounts to a running sandbox; existing mounts, roles and VPC are retained.

Provider: alicloud-express
Effect: write; idempotent: false.
Requires --yes to confirm this operation.

Usage:
  abx --provider alicloud-express provider run sandbox.mounts.append --input-file request.json --yes
  Write a request matching the input schema to request.json. Do not put secrets in command-line arguments.

Input fields (JSON, not individual CLI flags):
  sandbox_id: string (required)
  request_timeout: integer (optional)
  named_volume_mounts: array (optional)
  inline_volume_mounts: object (optional)

Full input/output schemas:
  abx --json provider command info alicloud-express sandbox.mounts.append
[exit_code:0]
```

## `abx provider command info alicloud-express sandbox.network.update`

```text
[write] Replace egress network rules; an explicit empty network object clears the rules.

Provider: alicloud-express
Effect: write; idempotent: false.
Requires --yes to confirm this operation.

Usage:
  abx --provider alicloud-express provider run sandbox.network.update --input-file request.json --yes
  Write a request matching the input schema to request.json. Do not put secrets in command-line arguments.

Input fields (JSON, not individual CLI flags):
  sandbox_id: string (required)
  network: object (required)
  request_timeout: integer (optional)

Full input/output schemas:
  abx --json provider command info alicloud-express sandbox.network.update
[exit_code:0]
```

## `abx provider command info alicloud-express sandbox.timeout`

```text
[write] Set an existing sandbox lifetime in seconds without connecting or resuming it.

Provider: alicloud-express
Effect: write; idempotent: false.
Requires --yes to confirm this operation.

Usage:
  abx --provider alicloud-express provider run sandbox.timeout --input-file request.json --yes
  Write a request matching the input schema to request.json. Do not put secrets in command-line arguments.

Input fields (JSON, not individual CLI flags):
  sandbox_id: string (required)
  timeout: integer (required)
  request_timeout: integer (optional)

Full input/output schemas:
  abx --json provider command info alicloud-express sandbox.timeout
[exit_code:0]
```

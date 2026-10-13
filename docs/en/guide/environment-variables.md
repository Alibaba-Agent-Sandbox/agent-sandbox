# Environment Variables in Sandboxes (CLI)

This guide explains how to set and read environment variables inside a sandbox from the `ebx` CLI, and which
execution rules apply to the commands you send. The underlying model — two independent process scopes inside every
sandbox — is the same for the CLI and the Python SDK; the full description, with code examples for the SDK and the
in-sandbox server, is in the SDK documentation linked at the bottom.

> **Looking for the CLI's own configuration variables** (`EBX_SANDBOX_API_KEY`, `ALIBABA_CLOUD_REGION_ID`, `EBX_LLM_API_KEY`, …)?
> Those configure `ebx` itself, not the sandbox. Each key has one variable. See the [Configuration Reference](../reference/configuration.md).

---

## Two process scopes

Inside every sandbox there are two independent process trees, each with its own environment:

| Scope | Process owner | How env vars propagate |
|-------|--------------|----------------------|
| **envd scope** | The `envd` daemon (PID 1) | Variables set at sandbox creation are inherited by every process started through envd — `ebx exec`, `ebx run`, code execution and terminal sessions |
| **Server scope** | The in-sandbox `SandboxServer` process (optional) | Changes made through the server's `/env` endpoint only reach child processes spawned by the server itself |

The two scopes never leak into each other: a variable written through the server's `/env` endpoint is invisible to
`ebx exec`, and vice versa. There is no single "set env" command, by design.

---

## Setting variables at creation time (envd scope)

`ebx create` accepts `--env` / `-e KEY=VALUE`, repeatable. The variables are injected into the envd root process and
inherited by all later commands for the lifetime of the sandbox:

```bash
ebx create --template base --env MY_KEY=value --env LOG_LEVEL=debug
```

There is no CLI command that changes envd variables after creation. To use a different value for one command, wrap
it explicitly (`ebx exec <sandbox-id> "sh -c 'MY_KEY=other python app.py'"`).

> **Secrets:** values given with `--env` are sent to the platform API over HTTPS. Avoid putting secrets into shell
> history; prefer reading them from your own environment (`--env "TOKEN=$TOKEN"`) and never commit them. Do not
> confuse this with the CLI's own credentials, which are stored with `ebx config set`.

## Reading variables

```bash
# One variable, as the process sees it (no shell needed)
ebx exec <sandbox-id> "printenv MY_KEY"

# The environment reported by the in-sandbox server, optionally filtered
ebx sandbox system env <sandbox-id> --filter PATH,HOME,LANG
```

`ebx sandbox system env` automatically leaves out variables whose names contain `TOKEN`, `SECRET`, `KEY`,
`PASSWORD` or `CREDENTIAL`.

---

## Direct-exec semantics

Commands sent through envd are executed with a direct `exec`, not through a shell. Unquoted shell operators (`|`,
`;`, `&&`, `||`, `>`, `<`, `(...)`, `$(...)`) are detected and the command is transparently wrapped in `sh -c`.
Everything else needs an explicit `sh -c '...'`:

| Works without `sh -c` | Needs `sh -c '...'` |
|-----------------------|---------------------|
| Pipes, redirects, `&&`, `\|\|`, `;`, subshells, `$(...)` | Variable expansion (`$VAR`, `${VAR}`), backticks, glob patterns (`*`, `?`, `[...]`) |

```bash
ebx exec <sandbox-id> "ls /tmp | grep log"             # pipe: auto-wrapped
ebx exec <sandbox-id> "sh -c 'echo \$HOME'"            # expansion: explicit sh -c
ebx exec <sandbox-id> "sh -c 'ls *.py'"                # glob: explicit sh -c
ebx exec <sandbox-id> "printenv HOME"                  # simplest way to read one variable
```

Because `$VAR` is not expanded, `ebx exec <id> "echo $VAR"` prints the literal text unless your **local** shell
expands it first — quote the whole command and use `printenv VAR` or `sh -c` instead.

---

## Quick reference

| What | How | Scope | Lifetime |
|------|-----|-------|----------|
| Set at creation | `ebx create --env KEY=VALUE` | envd | Sandbox lifetime |
| Read one variable | `ebx exec <id> "printenv KEY"` | envd | — |
| Read the server's view | `ebx sandbox system env <id>` | Server | — |

---

## Related SDK documentation

The complete model — per-call `env` dictionaries, `run_code(envs=)`, the `@sandbox(envs=)` decorator, the server's
`GET/POST /env` endpoints (read, set, protected and redacted variables) and recommended patterns — is documented in
the SDK's [Environment Variables guide](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/guide/environment-variables.md)
in the `python-sdk` repository.

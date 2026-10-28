# CLI capture: Automatic application authentication

Command: `abx create --help`

Built source candidate based on7aac212, package version0.5.8; this is not a new public release. Exit0.

```text
Usage: abx sandbox create|cr [options] [template]

create sandbox and connect terminal to it

Arguments:
  template                        create and connect to sandbox specified by
                                  [template]. Defaults to base

Options:
  -d, --detach                    create sandbox without connecting terminal to
                                  it
  --lifecycle.ontimeout <action>  action when sandbox timeout is reached: pause
                                  or kill
  --lifecycle.autoresume          enable sandbox auto-resume, requires
                                  --lifecycle.ontimeout pause
  --timeout <seconds>             sandbox timeout in seconds
  -u, --user <user>               user to start the terminal session as
  -c, --cwd <dir>                 working directory for the terminal session
  -e, --env <KEY=VALUE>           set environment variable for the terminal
                                  session (repeatable) (default: {})
  -h, --help                      display help for command

Standard create expects a registered platform template ID or alias. For Git Registry source, use abx template launch SOURCE --yes.
Agent Sandbox: --prompt <description> generates a template before creation. Use abx create --prompt DESCRIPTION --help for its --yes, --detach and --build options.
```

Actual terminal/cloud authentication flows and cleanup are recorded in [verification](../verify/2026-10-28-automatic-application-auth.md). No token or platform-key value is included.

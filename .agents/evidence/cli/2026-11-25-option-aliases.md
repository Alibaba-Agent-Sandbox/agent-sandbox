# CLI capture: Provider option aliases

Date: 2026-11-25. Built source candidate; not a new release.

Command: `abx provider test --help`

Exit code: 0

~~~text
Usage: abx provider test [options] <ID>

Run the provider contract tests against a provider.

Exercises the provider through the same adapters the CLI uses (sandbox
lifecycle, exec, files, ... as far as the provider declares them) and reports
one line per case. Cases for features the provider does not declare are
skipped. Exit code 0 when no case failed, 1 otherwise.

Examples:
  abx provider test local-process
  abx provider test opensandbox -o domain=127.0.0.1:8080 -o
use_server_proxy=true

Options:
  -o, --opt <KEY=VALUE>  Provider option (repeatable)
  --option <KEY=VALUE>   Provider option (repeatable)
  -k <FILTER>            Only run cases whose name contains this text
  -h, --help             Show this message and exit.
~~~

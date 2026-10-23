# Template launch help

Captured from the source CLI with `node --import tsx src/bin/abx.ts template launch --help`.

```text
Usage: abx template launch [options] <TEMPLATE_REF>

Build/register a template with the selected provider and create a sandbox using
its returned reference. Configure the provider first; --yes permits billable
operations. The selected workflow determines required operations before build.
This project extension does not convert IDs between clouds.

Options:
  --service-url <SERVICE_URL>      Explicit external service URL for a service
                                   workflow
  --build-profile <BUILD_PROFILE>  Explicit manifest build profile; preserves
                                   its Dockerfile without rewriting source
  --workflow <WORKFLOW>            Explicit workflow ID (defaults to the
                                   manifest default_workflow)
  -a, --alias <ALIAS>
  --timeout <FLOAT>                Build deadline in seconds (maximum 3600)
  --sandbox-timeout <FLOAT>        Sandbox lifetime in seconds
  -y, --yes
  -h, --help                       Show this message and exit.
```

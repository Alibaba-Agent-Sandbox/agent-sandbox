# Build a reusable template

`template build` prepares a source artifact without starting an instance. `deploy --build FILE` consumes it; `--build` identifies the artifact. Direct deployment prepares source and creates a named application.

```bash
abx template build ./project --out .abx/build.json --timeout 600 --yes
abx deploy --build .abx/build.json --name my-app --yes
abx template build --clean .abx/build.json --yes
```

Set `sandbox.<name>.template.buildConfig` to either Dockerfile/context or native steps. Context defaults to the Dockerfile directory. These branches are mutually exclusive.

```yaml
specVersion: 1
name: example
sandbox:
  agent:
    provider: alicloud-express
    template:
      region: cn-hangzhou
      buildConfig:
        dockerfile: ./sandbox/Dockerfile
        context: ./sandbox
```


Preparation waits for readiness. `--timeout` on build and `--build-timeout` on deploy set a budget greater than zero and at most 3600 seconds, default600. Use `sandbox create --timeout` for instance lifetime. A local timeout does not prove that remote work stopped. Keep recovery records and use status/recover/delete for an owned deployment. A separate build must have all consumers removed before cleanup. Explicit private environment values are not copied into build snapshots; keep the original configuration source available for later deployment and recovery. See [authoring templates](../guide/authoring-templates.md) and [managed applications](../guide/managed-applications.md).

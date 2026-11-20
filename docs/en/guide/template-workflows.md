# Template resources

`template.yaml` declares named Sandbox templates, static volumes and Serving resources. Deploy prepares these resources; create dynamic Sandbox instances from business code or an explicit SDK/CLI call.

```yaml
specVersion: 1
name: demo
vars:
  region: cn-hangzhou
sandbox:
  agent:
    provider: alicloud-express
    template:
      region: "${vars.region}"
      image: registry.example.com/team/agent:v1
      buildConfig:
        dockerfile: ./sandbox/Dockerfile
serving:
  api:
    component: serverless-devs/fc3@0.1.26
    props:
      region: "${vars.region}"
      functionName: demo-api
      runtime: custom-container
      customContainerConfig:
        image: registry.example.com/team/api:v1
        port: 9000
      environmentVariables:
        SANDBOX_TEMPLATE_ID: "${resources.agent.output.templateId}"
```

Replace the example registry addresses with your existing images or writable build targets. `vars` is optional: authors choose every key, and literals can be written directly in resource properties. Catalog initialization fields belong in `registry.yaml.parameters`; editing local configuration does not require that catalog file.

Sandbox region belongs to `sandbox.NAME.template.region`; sibling volumes use that region. Express template attributes stay flat. `buildConfig` selects either `dockerfile` with optional `context`, or native `steps`, never both. Paths are relative to `template.yaml`; omitted context is the Dockerfile directory. A Dockerfile is not automatically discovered when `buildConfig` is absent.

With a Dockerfile, `image` is the build/push destination. Without a Dockerfile it is an existing source image; native Steps customize that source into a Sandbox template. Steps do not promise an exported OCI image. Omit `registryConfig` unless explicit authentication, certificates or registry networking are needed. Software installation belongs in the Dockerfile/base image. Native `startCommand` and `readyCommand` run during template preparation, not at each dynamic instance creation.

Serving keeps native component `props`. Use resource-local `actions.pre-deploy` with `component: serverless-devs/fc3@0.1.26 build ...` when a Serving build is needed. Shell `run` and component actions execute on the deployment host. `success-deploy` runs after resource readiness; `fail-deploy` handles failure and `complete-deploy` runs at completion. Output references create dependency ordering; missing resources and cycles fail before deployment. Actions may run again on a new deployment attempt, so write retry-safe scripts.

The named-resource executor currently supports Express and exact-version `serverless-devs/fc3` components. Other Provider instance APIs remain separate. An application's token, database, model and instance environment are application configuration, not generic template fields. Keep secrets in private environment/file references. Managed Agents API provides its own startup/publication scripts; follow that template's README.

[Build and deployment](deploy-and-build.md) · [Native expressions](../design/template-v1-parser.md) · [Complete field reference](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/docs/template-spec.md)

# Sandbox templates and Serving resources

A local `template.yaml` with `specVersion: 1` declares reusable cloud resources. Deploying it prepares Sandbox templates and static volumes, and deploys Serving components. Instances are created separately. The current resource adapter supports Alibaba Cloud Express and the pinned Serverless Devs `fc3` component. OpenSandbox remains available for instance operations; a native resource adapter is not available for this YAML path. Native component execution currently requires the npm CLI.

## Complete local example

Copy the [example directory](../../examples/native-resources/template.yaml), including `guest/Dockerfile` and `guest/hello.py`. Set `sandbox.agent.template.region` and `image` to your actual region and writable image repository. The repository must already exist. Docker builds need a running local Docker daemon; deployment also needs configured cloud management credentials and permission to push the image.

```yaml
specVersion: 1
name: resource-example
sandbox:
  agent:
    provider: alicloud-express
    template:
      region: cn-hangzhou
      image: registry.example.com/your-namespace/agent:unique-version
      buildConfig:
        dockerfile: guest/Dockerfile
      generation: 2
      cpu: 2
      memorySize: 4096
      diskSize: 15360
      internetAccess: true
```

`vars` is optional and its keys are author-defined. Local resource use does not require `registry.yaml`; catalog forms and API declarations are separate publication metadata. `buildConfig` selects Dockerfile/context or native Steps. For Dockerfile, context defaults to the Dockerfile directory. `template.image` is the Docker publication destination, or the source image for native Steps/existing-image preparation. Native Steps do not export a finished OCI image to that address.

```bash
abx template build .
abx deploy . --name tools --plan
abx deploy . --name tools --yes
abx status tools
abx create --template tools --resource agent --name work --timeout 300 --yes
abx status work
abx delete work --yes
abx delete tools --yes
```

Build returns local image IDs. It performs no cloud registration, hooks or runtime-secret lookup. Unrelated runtime variables may remain unresolved; Dockerfile/context paths must be concrete. A matching local image is reused only after its content identity and Docker image ID are verified. Native Steps and Serving actions are reported as deferred; `no_local_build` does not mean they have been deployed. `--timeout` limits local image construction; `deploy --build-timeout` applies to resource preparation.

`tools` names a resource deployment; `work` names a dynamic instance. Omit `--resource` when the deployment contains exactly one Sandbox template. Native template IDs can also be passed directly with `abx create --template ID`. Instance environment and volume mounts belong to create, for example `--env MODE=demo --volume-mount /workspace=my-volume`.

Named template selection uses its recorded Provider, native template ID, region, Team and endpoint. Cloud management credentials must belong to the recorded account. The managed runtime-key path receives the selected Team. A manually configured Sandbox API Key remains a separate credential and must authorize that Team and template; the management-account check does not validate an opaque runtime key's owner.

## Serving and resource dependencies

Serving preserves native component props and command actions:

```yaml
specVersion: 1
name: serving-example
serving:
  api:
    component: serverless-devs/fc3@0.1.26
    props:
      region: cn-hangzhou
      functionName: serving-example
      runtime: nodejs20
      code: ./server
      handler: index.handler
      memorySize: 512
      timeout: 30
```

Provide the actual `server` source expected by the FC component before deployment. This example creates a function; an HTTP trigger/domain and business API behavior must be configured separately in native props and code. Component versions are exact. Shared `auto` dependencies remain retained when the function is removed.

Sandbox and Serving can contain several named resources. Their logical names are globally unique. `${vars.key}` and `${env('KEY')}` are resolved by the official Devs parser during deploy. `${resources.agent.output.templateId}` refers to the ready template's native ID and establishes deployment order. Missing references and cycles are rejected. Actions support `pre-deploy`, `success-deploy`, `fail-deploy` and `complete-deploy` per resource; they run on the deployment host and are not instance startup hooks.

## Readiness and cleanup

`status` reads saved native identities and reports current cloud state separately from recorded deployment completion. Authentication and network failures do not mean a resource is missing. `recover NAME` observes interrupted operations without replaying publication. An uncertain image push remains unresolved; inspect the reported destination before deleting/retrying with a new image tag.

Delete removes confirmed owned templates, volumes and functions. Borrowed references, retained volumes, shared component dependencies and image destinations remain with their owner. Deleting resource templates does not delete separately created instances. Local image IDs can be managed with Docker.

Creating a Sandbox does not automatically start a business HTTP service, inject application credentials, bind OpenAPI or provision an Agents API gateway. Express `startCommand`/`readyCommand` retain their template-build/snapshot meaning. Existing source `spec_version: 5` deployment recipes keep their declared service startup path; see [build and deploy](deploy-and-build.md).

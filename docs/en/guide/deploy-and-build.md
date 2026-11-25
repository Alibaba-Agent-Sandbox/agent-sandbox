# Build and deploy

`abx template build SOURCE` builds local Docker images. It does not push images, register templates, create instances or execute deployment actions. Use `abx deploy SOURCE --name NAME` to publish resources. There are no build files to copy or pass between commands.

```bash
abx template build ./project --timeout 600
abx deploy ./project --name my-project --yes
abx status my-project
abx delete my-project --yes
```

For resource `specVersion: 1`, deploy prepares the declared Sandbox templates, volumes and Serving resources. Create a dynamic instance separately:

```bash
abx create --template my-project --resource agent --name my-instance --yes
abx status my-instance
abx delete my-instance --yes
```

The resource selector is needed only when several Sandbox templates exist. Creating an instance does not start or authenticate a business API automatically. See [resource projects](native-resources.md) for configuration and supported boundaries.

Existing `spec_version: 5` source recipes retain their current deployment behavior: deploy prepares the template and starts its named instance and declared services. Their plain Dockerfiles can be built locally; their Provider-specific preparation still runs during deploy. Managed application recipes prepare their builds during deploy.

Build results distinguish built local images, partial local builds and configurations with no local build. Native Steps and Serving actions run during deployment. Unrelated runtime secrets are not needed for local builds; Dockerfile and context paths must be concrete. Docker defaults to `linux/amd64`; context defaults to the Dockerfile's directory for resource v1.

Delete removes confirmed owned cloud resources. Existing references, explicitly retained volumes, component-managed shared resources and image repositories remain with their owner. Local build images are ordinary Docker images; remove an unused image by the image ID shown in the build result using Docker. Use `abx recover NAME` when a deployment is incomplete; it observes saved operations without replaying publication.

`template publish SOURCE --tag VERSION` publishes committed source to a new version on an existing GitHub remote. It does not deploy resources or create a catalog entry.

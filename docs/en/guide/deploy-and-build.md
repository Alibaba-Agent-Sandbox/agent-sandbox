# Deploy and build

Prepare resources directly, or build once and reuse the prepared Sandbox templates:

```bash
abx template init ./project --template python
abx deploy ./project --plan
abx template build ./project --out ./.abx/build.json --yes
abx deploy --build ./.abx/build.json --name my-app --yes
abx status my-app
```

Direct `abx deploy ./project --name my-app --yes` combines preparation and Serving deployment. Neither command creates a dynamic Sandbox instance. `template build` prepares Sandbox templates/static volumes and runs Serving build actions; `deploy --build` borrows the prepared resources and deploys Serving. Keep the original source and native component build files unchanged until reuse is complete. Secrets remain in private configuration rather than the build record.

Use the template's documented `run.py` or the SDK to start its dynamic business service. To create a bare instance explicitly:

```bash
abx sandbox create --template TEMPLATE_ID
abx sandbox delete SANDBOX_ID
```

`buildConfig` chooses Dockerfile/context or native Steps. Docker requires a working local daemon, writable image repository and platform pull access. Native Steps produce a template ID. See [resource configuration](template-workflows.md).

```bash
abx delete my-app --yes
abx template build --clean ./.abx/build.json --yes
```

Deletion removes confirmed owned templates/volumes/functions. Borrowed builds remain available until every consumer is removed. Explicitly retained volumes and image tags remain yours to manage. FC component `auto` may create or reuse logging/network/storage/role resources; those potentially shared resources are retained and listed separately, not treated as exclusively owned by the function.

`abx status APP` reports saved state. After an uncertain operation use `abx recover APP` to observe its identity before retrying or cleaning up; recovery does not replay deployment hooks. A local timeout does not prove a submitted cloud operation stopped. Preparation deadlines apply to waits and child component actions; Docker daemon work may need separate cancellation.

`template publish SOURCE --tag VERSION` publishes committed source to a fixed GitHub version, without deploying or creating a catalog entry.

[Authoring](authoring-templates.md) · [Deployment and logs](template-launch.md)

An existing deployment stays bound to its selected reusable build. Use another deployment name, or delete it before switching to a different build artifact.

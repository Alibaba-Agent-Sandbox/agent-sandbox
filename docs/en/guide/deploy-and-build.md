# Deploy and build

Initialize editable source, deploy it under an application name, then manage that deployment:

```bash
abx template init ./project --template python
abx deploy ./project --name my-app --yes
abx status my-app
abx delete my-app --yes
```

`deploy` prepares the required template and starts the deployment. The manifest and Provider determine Dockerfile or supported platform-step preparation. `--build-profile` selects an explicitly declared profile and never silently switches recipes.

Docker builds need a working local Docker and writable image repository; the runtime must be able to pull the image. Platform-step runtime, file inputs and permissions depend on the Provider. Deploy does not call a model; model use belongs to `template init --prompt` or `--adopt`.

Deletion cleans resources recorded as owned by that deployment. Follow any reported retention or image-cleanup guidance. On failure, use `abx status APP` and `abx recover APP` before retrying a potentially submitted create.

`template publish SOURCE --tag VERSION` publishes committed source to an immutable version on an existing GitHub remote and returns a commit-pinned reference. It neither deploys an application nor automatically creates a catalog entry.

[Full authoring guide](authoring-templates.md) · [Deployment and failure boundaries](template-launch.md)

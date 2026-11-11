# Deploy and build

Author source, prepare builds, deploy running instances and publish source versions as distinct tasks:

```bash
abx template init ./project --template python
abx template build ./project --out ./.abx/build.json --yes
abx deploy --build ./.abx/build.json --name my-app --yes
abx status my-app
abx delete my-app --yes
abx template build --clean ./.abx/build.json --yes
```

Use `abx deploy ./project --name my-app` when no separately reusable build is needed. `template build` starts no instance; `deploy --build` takes an artifact file, not a build mode. The manifest and Provider determine Dockerfile or supported platform-step preparation. `--build-profile` selects an explicitly declared profile and never silently switches recipes.

Docker builds need a working local Docker and writable image repository; the runtime must be able to pull the image. Platform-step runtime, file inputs and permissions depend on the Provider. Deploy does not call a model; model use belongs to `template init --prompt` or `--adopt`.

Deletion cleans resources recorded as owned by that deployment. Separately prepared builds remain reusable; remove their consumers before cleaning, and inspect retained images requiring manual cleanup. On failure, use `abx status APP` and `abx recover APP` before retrying a potentially submitted create.

`template publish SOURCE --tag VERSION` publishes committed source to an immutable version on an existing GitHub remote and returns a commit-pinned reference. It neither deploys an application nor automatically creates a catalog entry.

[Full authoring guide](authoring-templates.md) · [Deployment and failure boundaries](template-launch.md)

# Build a template and create a Sandbox

Initialize the project if you need editable source. Build the template once, then create a Sandbox from its build file.

```bash
abx template init ./project --template python
abx template build ./project --out ./.abx/build.json --yes
abx create --build ./.abx/build.json --name my-app --yes
abx status my-app
abx delete my-app --yes
abx template build --clean ./.abx/build.json --yes
```

`template build` can read a Registry reference directly. Build never starts an instance. `create --build FILE` uses the saved build and can create multiple separately named Sandboxes. The manifest and Provider determine Dockerfile or supported platform-step preparation. `--build-profile` selects an explicitly declared profile and never silently switches recipes.

Docker builds need a working local Docker and writable image repository; the runtime must be able to pull the image. Platform-step runtime, file inputs and permissions depend on the Provider. The authoring stages `template init --prompt` and `--adopt` use your configured model. Build and create need model credentials only when the template application requires them.

Deletion cleans resources recorded as owned by that deployment. Separately prepared builds remain reusable; remove their consumers before cleaning, and inspect retained images requiring manual cleanup. On failure, use `abx status APP` and `abx recover APP` before retrying a potentially submitted create.

`template publish SOURCE --tag VERSION` publishes committed source to an immutable version on an existing GitHub remote and returns a commit-pinned reference. It neither deploys an application nor automatically creates a catalog entry.

[Full authoring guide](authoring-templates.md) · [Creation and recovery](template-launch.md) · [Deploy a managed FC application](managed-applications.md)

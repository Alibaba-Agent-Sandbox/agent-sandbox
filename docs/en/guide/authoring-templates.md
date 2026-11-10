# Authoring templates

A template is reusable source. Deploying it creates a named application that you
manage separately. The authoring commands are `template list`, `info`, `init`,
`build` and `publish`.

## Find or create source

```bash
abx template list python
abx template info python-hello
abx template init ./my-template --template python
abx template init ./my-copy --from owner/repo//template@COMMIT
abx template init ./my-mcp --template mcp
```

Built-in cases are `python`, `node`, `minimal` and `mcp`; `template init --list`
shows them. `--from` copies catalog, repository or local template source. It does
not build, register or deploy anything. Newer manifest versions can be copied
and edited even when this CLI cannot execute their deployment contract. A
provider-managed catalog entry without source can be deployed, but cannot be
copied with `--from`.

A project contains `template.yaml` and its source files, commonly a Dockerfile,
application entry point and README. The manifest declares services, startup,
readiness, resource defaults and runtime environment inputs. The selected
Provider's image profile determines the base image and platform startup rules.
Keep API keys and application tokens outside these source files.

Existing files are shown before replacement. Interactive replacement needs a
confirmation; automation must use `--force`. `--yes` alone does not overwrite
existing files.

## Generate or adapt application code

```bash
abx template init ./my-template --prompt "a Python data analysis service"
abx template init --adopt ./app --hint "the API listens on port 8080"
abx template init --adopt ./app --dry-run
```

Generation uses the configured coding model. `--prompt` sends the description;
`--adopt` sends an inspected copy of the project after confirmation. `--dry-run`
shows the candidate files without calling the model or writing the project.
Noninteractive generation needs `--yes`.

Adoption writes only Dockerfile, commands.py, template.yaml and, when absent,
.dockerignore. Other generated changes are discarded. Replaced files receive
numbered `.abx-bak` backups. An existing template or unrelated commands.py needs
`--force`. The source-copy checks exclude secrets, symlinks, large/binary files
and dependency directories; existing Docker ignore rules must exclude secrets.
Generated files still need review before building or deploying.

## Build once, deploy an application

```bash
abx template build ./my-template --yes
# Use the build path printed by the command:
abx deploy --build BUILD_FILE --name my-app
abx status my-app
```

Build prepares the real image/template without starting an application. Its
private artifact records the Provider target, prepared result, resource journal
and a source snapshot. The default is a unique file under `.abx`; `--out FILE`
chooses another unused path. An existing artifact is never overwritten.
`--build-profile NAME` selects a declared Dockerfile profile; `--timeout` bounds
sandbox template preparation.

`deploy --build` verifies the snapshot and Provider target before reusing the
prepared result. Editing the original project does not edit an existing build.
For a new version, build again. Direct `abx deploy ./my-template --name my-app`
combines preparation and deployment when a separate build is unnecessary.

Service implementations belong in application code. For SandboxServer named
commands, use the server's `@command()` registration and the application's
explicit invocation endpoint. Arbitrary HTTP services, including MCP, declare
their own protocol and use their documented HTTP API.

## Publish reusable source

Commit the template to a repository with an existing GitHub HTTPS or SSH remote:

```bash
git add template.yaml Dockerfile commands.py README.md
git commit -m "feat: add analysis template"
abx template publish . --tag v1.0.0 --yes
```

Publishing pushes a new tag pointing to the clean, committed source and returns
a reference pinned to the commit SHA. It does not create a catalog listing or
start an application. A remote tag pointing to another commit is refused; choose
a new version. `--remote NAME` selects an existing remote. Git uses your configured
authentication; credentials must not be embedded in the remote URL.

Others can copy the returned reference with `template init --from REFERENCE` or
deploy it with `abx deploy REFERENCE --name APP`. Catalog contributions follow the
[template repository's contribution guide](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/CONTRIBUTING.md).

## Resource cleanup

Remove a running application with `abx delete my-app --yes`. A separately prepared
build remains reusable until explicitly cleaned:

```bash
abx template build --clean BUILD_FILE --yes
```

Cleanup refuses a build still used by an application and deletes only confirmed
owned resources. Keep failed build artifacts and their journals for retry.
Retained images requiring manual cleanup are listed in the result. Source
snapshots and artifacts remain available for inspection; remove those local files
when you no longer need them.

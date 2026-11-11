# Troubleshooting

Check `abx --version`, the selected Provider and the failing phase first. Use [operations](operations.md) for current source commands and the installed release’s `--help` for older versions.

## Configuration and authentication

Inspect effective configuration with `abx config list` and enter secrets with hidden input, for example `abx config set sandbox_api_key`. Check that key, region and endpoint belong to the same Provider. Sandbox keys, cloud AccessKeys, application tokens and model keys have different purposes; see [configuration](guided-configuration.md). 401/403 is not proof of absence. Do not retry with another Provider’s key. Cloud management-key creation/renewal retains separate confirmation.

## Templates and source

Use `abx template list` for the public catalog, `abx template init ./project --from SOURCE` for source and `abx deploy ./project --name APP` for deployment. Initialize a missing project explicitly. A future manifest can be copied, but deployment still requires a supported specification; see [startup semantics](template-workflows.md). For GitHub limits use hidden input with `abx config set github_token`. A pinned Git commit does not change when the catalog cache is refreshed.

## Model generation

Only template init with `--prompt` or `--adopt` needs a model. Configure a usable model endpoint with llm_api_key, llm_base_url and llm_model through `abx config set`. `--model ID` overrides one generation. Inspect retained generated source after a failure; generation does not deploy an application. Noninteractive adoption needs explicit `--yes`; use `--dry-run` to inspect its file scope first.

## Builds and networking

Dockerfile builds need Docker, an accessible daemon and the correct context; run `docker info` first. Check package sources, DNS, HTTPS, CA, proxy and MTU inside the build container. A successful host request does not prove container connectivity. Do not disable TLS or change package pins to hide a network failure. The image repository needs write permission and the runtime needs pull access.

Preparation deadlines use deploy `--build-timeout` or template build `--timeout`. More waiting does not guarantee remote cancellation; inspect state after a timeout. `--verbose` provides local diagnostics, but application/build scripts may print private data.

## Deployment failure and cleanup

```bash
abx status APP
abx recover APP
abx delete APP --yes
```

Recover observes saved ownership without replaying creation or publication. Distinguish confirmed absence from authentication/network failures, and retain local records when cleanup is uncertain. Separately prepared builds use `template build --clean BUILD_FILE --yes`; remove their consumers first. Handle manually retained images as reported. Delete only this run’s resources rather than substituting an account-wide cleanup.

## Commands and files

`abx sandbox exec APP -- COMMAND` runs a process; `abx sandbox command run APP NAME` invokes a deployed application function. For a missing function, inspect `abx sandbox command list APP`. Check actual file paths, runtime users and permissions; not every container file belongs to its service user. A managed application exposes a business HTTP API and is not a single Sandbox handle.

## Installation

For PATH, download or npm errors, check the [installation guide](binary-installation.md), architecture and actual published artifact. Historical error logs do not establish current npm or binary availability.

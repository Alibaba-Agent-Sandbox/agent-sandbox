# Launch an explicit template workflow

`template launch` resolves a source directory, validates its spec v4 manifest, and plans the selected workflow against the provider's exact operations, input kinds, startup modes and calling-client protocol support. An application HTTP workflow does not require `code.execute` or a platform interpreter. See [template workflows](template-workflows.md) for the contract and security rules.

```sh
abx --provider opensandbox template launch ./python-hello --workflow application --build-profile portable
```

The example selects `build_profiles.portable` explicitly. The original Dockerfile stays unchanged. Interactive runs request build/create consent; use `--yes` for an authorized noninteractive run. Source builds need the selected provider's credentials and native build prerequisites, such as Docker, a writable image repository and registry authentication for OpenSandbox. The OpenSandbox server must be reachable and able to pull the resulting image. Provider maturity remains independent from workflow support and verification.

Use `--alias NAME` for the build correlation name, `--timeout SECONDS` for preparation (default 600, maximum 3600) and `--sandbox-timeout SECONDS` for sandbox lifetime (default 300). `--workflow ID` selects an explicitly declared path. `--build-profile ID` selects a declared root Dockerfile and context; no base image, USER, COPY or entrypoint is silently rewritten. A Dockerfile with an unresolved platform placeholder fails before preparation.

Image workflows require an immutable image reference; managed workflows require their backend reference and matching provider. Neither input is treated as source. External application service workflows use an explicit URL through `--service-url`, with their own application token supplied separately from platform credentials.

The source snapshot and provider code are checked before preparation/create. `startup: exec` runs the manifest's explicit start command; `startup: entrypoint` uses the selected provider's native startup behavior. A declared `ready_cmd` requires `exec.run` and executes before success. Application protocol discovery uses the exact sandbox/port endpoint, retaining gateway path prefixes and query parameters without reusing envd transport or retrying anonymously.

A successful JSON result identifies the workflow, returned reference, sandbox, source digest, execution plan and resource journal. Newly created sandboxes are retained until deletion or timeout. On startup failure the launcher deletes only its owned sandbox and reports whether deletion was confirmed. Images and registered templates can remain retained or require manual cleanup. A timeout can leave an uncertain remote result: reconcile the journal's correlation identity before retrying.

The new workflow implementation must pass its repository and real-provider gates before release. A source checkout can be built with `npm ci && npm run build` and invoked using `node dist/bin/abx.js`; an older published CLI does not acquire this contract from a catalog update alone. Standard template commands retain their pinned standard-client contract.

All third-party Provider integrations remain Beta. Workflow evidence does not certify their complete native protocol surface; formal native acceptance is a separate gate.

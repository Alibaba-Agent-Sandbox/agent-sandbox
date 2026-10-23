# Template workflows

Project templates use `spec_version: 4` and `workflow_contract_version: 1`. Each manifest declares `provides`, `workflows` and one `default_workflow`. A service installed in an image is separate from the provider adapter operations and the calling client's protocol support. An application workflow that calls the template's HTTP server does not require a platform interpreter.

`abx template launch SOURCE --workflow application` checks the chosen workflow before building or creating resources. Run with `--yes` to authorize the billable build/create steps in noninteractive use. The provider must explicitly implement that input kind, startup mode and each required operation. `ready_cmd`, when declared, requires `exec.run`. Managed references must name their owning provider; OCI image inputs require an immutable `@sha256:` reference. An external service URL belongs to the explicit server-client path.

For a manifest with `build_profiles.portable: {dockerfile: Dockerfile.portable, context: '.'}`, select it with `--build-profile portable`. The original Dockerfile stays unchanged. The selected Dockerfile must name a usable base image; unresolved platform placeholders fail before resources are created. The CLI snapshots the eligible source files and selected build profile, and checks the frozen source before preparing it. Secret environment files are excluded. Symlink sources are rejected.

The selected adapter supplies the application endpoint for the exact sandbox and port. Requests retain proxy prefixes and signed query parameters, keep application and gateway credentials separate, and refuse redirects and anonymous retry. Application commands use this HTTP transport independently from shell or envd connectivity.

Interpreter calls use exact operation identifiers. `code.execute` creates and deletes a temporary context; `code.default-context.execute` explicitly selects persistent default state. Named context operations require their own declarations. An interpreter 404 remains an interpreter error. It never executes the request in a shell.

Build, publication, template registration and sandbox creation record intent before submitting requests. A failed or timed-out request can leave an uncertain outcome: inspect the reported resource journal and reconcile its correlation key before retrying. Cleanup only targets resources owned by this launch. Retained or manually removable images and templates are recorded separately from confirmed sandbox deletion.

The directory's static compatibility result is distinct from live environment readiness and independently verified evidence. Historical receipts do not certify a new source, provider or consumer revision. Provider maturity such as Beta is independent from workflow implementation.

The bundled Express adapter currently supports managed inputs in the project workflow launcher. Its separate native build commands do not establish the new source-preparation journal and identity contract; source workflows are rejected before those commands are entered. This describes this project adapter, not whether the platform can build images.

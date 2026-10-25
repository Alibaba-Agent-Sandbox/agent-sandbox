# Migrate from E2B CLI on Alibaba Express

The standard command path targets Alibaba's documented `@e2b/cli@2.20.0`, with its protocol client fixed at `e2b@2.50.0` (below the documented 2.51.0 create/connect incompatibility). [Alibaba compatibility](https://help.aliyun.com/zh/agent-sandbox/e2b-compatibility-explanation) defines service boundaries. This is a CLI implementation detail, not a Node SDK release.

Install the current official release using the [installation guide](binary-installation.md). Keep your existing `E2B_API_KEY`, `E2B_API_URL` and `E2B_DOMAIN`; replace the executable prefix `e2b` with `abx`. Project/home configuration also works. Authentication uses the configured Alibaba API key; E2B browser login and Team administration are not required.

Standard command output options follow each command's help, such as `--format json` where supported. Native root switches such as `--json` / `--quiet` do not select a different lifecycle implementation; unsupported combinations fail explicitly. Check the standard command's `--help` for supported options.

```bash
abx sandbox create code-interpreter-v1 --detach
abx sandbox list --format json
abx sandbox exec --cwd /tmp <sandbox-id> sh -c 'printf hello; exit 7'
abx sandbox connect <sandbox-id>
abx sandbox kill <sandbox-id>
abx template list --format json
```

The positional create argument is a template. Without `--detach`, create opens a real PTY. With default lifecycle options it requests a one-second TTL after terminal exit; Alibaba may round this to its platform minimum (the verification account returned about 60 seconds). Reclamation is asynchronous; explicit `--timeout`/lifecycle options retain the reference version’s lifetime semantics. Connect opens a real PTY and leaves the existing sandbox alive on exit. Terminal state, stdin, resize, signals and remote exit codes follow the pinned implementation. Exec options come before the sandbox ID; arguments after it belong to the remote command. Lists retain state/metadata filters, pagination limits and output format. Kill supports IDs and `--all`. Use each command's `--help` for the fixed option set.

Natural language uses `abx create --prompt "a Python data science environment"`; it no longer occupies the template positional argument. `--provider alicloud-express` keeps standard routing. Other installed providers and project-specific commands (MCP, config, provider, files, named server commands, template build/deploy) retain the project extension interfaces.

Python imports and behavior are described in the [Python migration guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/migrate-from-e2b.md). There is no legacy compatibility switch. Keep third-party wrapper import/executable changes in your own integration adapter.

Pause/resume depends on runtime/allowlist. Snapshot creation/restoration/deletion requires MicroVM and an enabled account, with Alibaba retention/name/occupancy rules. Template listing is an Alibaba extension. Image-based template builds depend on Alibaba permissions/capabilities. Metrics/logs availability is not guaranteed: the official pages conflict, so service errors are preserved. Volume, Team and API-key/access-token management, and the MCP gateway are outside the supported migration path. CLI help inherited from pinned sources is not a claim that an unsupported cloud operation is enabled. OSS/VPC extensions remain distinct.

The bundled standard command source is a maintained MIT source port, not a runtime dependency or external executable invocation. `vendor/e2b-cli/package-lock.json` fixes build inputs; `npm ci --prefix vendor/e2b-cli && npm run vendor:e2b` reproduces it. Licenses and source manifest accompany the port. The npm and standalone builds both embed it. Contract tests and real-cloud evidence are recorded in `.agents/`.

`abx --licenses` displays the licenses and notices retained with the embedded standard implementation, including from a standalone executable. This does not establish a complete dependency/SBOM audit of the entire executable or dependencies already bundled upstream.

`abx template from-image <image> --name <name>` preserves Alibaba image-template creation as a project extension. `template create` uses the pinned E2B Dockerfile-build semantics.


`template init` retains the pinned E2B local scaffold behavior. Python sync/async scaffolds import `agent_sandbox`; TypeScript output retains the upstream package because Node SDK migration is out of scope. Template assets are embedded in the standalone executable. The project template.yaml/server scaffold moves to `template scaffold`: use `--prompt` for natural language or `--adopt` for an existing project.

On the verified python-hello template, the backend advertises stdin-close support but returns HTTP 404/unimplemented for EOF/closeStdin. A real empty-pipe probe preserved stdout and exited 1 with **both** the pinned upstream CLI and abx. This is an existing backend incompatibility, preserved during migration. Invoke commands without a stdin pipe when none is needed; EOF-dependent workflows need a backend/template that implements that API. Sending stdin to a process that reads a fixed line is separately verified in the Python SDK.

Real conditional probes on the tested python-hello function returned `pauseSession is not enabled for this function` and `sandbox runtime does not support snapshot`. The APIs are implemented, but success needs an enabled function and an appropriate MicroVM runtime/account. Generic runtime documentation does not enable an existing function. See the companion SDK verification record in its PR.

### Source installation and artifact notices

Use the current official CLI release from the [installation guide](binary-installation.md) and the matched public Python client/server release described in the README. Python template READMEs use that same exact runtime pin. A source checkout is needed only for development or an explicitly chosen source installation.

`abx --licenses` includes the full upstream prebundle identity inventory and retained
notices. Maintainers refresh and verify them using [the pinned-source workflow](../../../vendor/e2b-cli/README.md).

### Generated project instructions

Built-in Express `template scaffold` READMEs use `template deploy . && create NAME --detach` with an explicit Express provider. Run in a terminal to complete missing configuration; configure values before using `-y` in automation. A failed deploy stops creation. Use the printed ID for named commands and explicit kill. Other providers receive their own help entry rather than Express deployment instructions. AI recovery uses `create --prompt "DESCRIPTION"`; an existing Express template uses `create TEMPLATE --detach`.

Native Express template list/info use the Alibaba FCSandbox API and AccessKey credentials. Use `abx --native template list --region REGION` for native management or `abx template list --format json` for standard listing with the Sandbox API key. The removed `--official-api`/`--legacy-api` selectors are not required. Release artifact verification exercises this current contract before publication.

Maintainer release recovery preserves immutable versions: an existing npm version is reused only after its integrity matches the exact tested candidate. Public install readback retries with fresh online metadata for at most ten minutes before failing; it never overwrites a published version.

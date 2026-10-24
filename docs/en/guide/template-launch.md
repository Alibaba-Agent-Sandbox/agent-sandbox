# Launch a template

The default OpenSandbox recipe and optional provider source-placeholder metadata require CLI 0.4.15 or later.

Configure the [provider](providers.md), then launch a Registry source template:

```sh
abx --provider opensandbox template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello --yes
```

The CLI builds the image, creates a sandbox, starts the application and checks that its API is reachable. Use the returned sandbox ID for later commands. OpenSandbox needs a reachable server, Docker, a writable image repository and Docker registry authentication; the server must be able to pull that image. For Express, use `--provider alicloud-express` and configure its platform and ACR credentials.

Official source templates use the existing native base recipe. OpenSandbox resolves its base to `fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49`; `ABX_BASE_IMAGE_REGION` and `ABX_BASE_IMAGE_TAG` override those build inputs. These are image-source settings, independent of the OpenSandbox server location. Docker builds the exact server SDK commit already pinned in the selected Dockerfile and supplies its wheel to the existing install step. No separate Python SDK checkout or host Python build tools are required. The CLI prepares a temporary copy and keeps application instructions and the final `USER` unchanged.

Options:

- `--timeout SECONDS`: build/preparation limit, default 600 and maximum 3600.
- `--sandbox-timeout SECONDS`: instance lifetime, default 300.
- `--alias NAME`: name used to correlate build resources.
- `--workflow ID`: choose another declared workflow.
- `--build-profile ID`: choose an explicitly declared Dockerfile, for example `portable`. The CLI never silently switches profiles.

Omit `--yes` to confirm the billable build/create interactively. A local source directory works in place of the Registry reference. Custom base images must be explicit; unknown placeholders are reported before building. Custom multi-stage recipes must supply any wheel their Dockerfile copies.

A successful launch keeps the sandbox running until deletion or expiry. On failure, the CLI attempts to delete the sandbox it created. Retained images and platform templates are listed in the resource journal printed by the command. If a remote request times out, inspect that journal before retrying because the resource may already exist.

HTTP template APIs, shell execution, PTY sessions and persistent interpreters are separate functions. A template HTTP API does not require a platform interpreter. See [template workflows](template-workflows.md) for manifest and protocol details.

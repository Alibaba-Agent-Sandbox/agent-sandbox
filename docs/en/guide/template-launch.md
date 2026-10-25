# Launch a template

Spec v5 templates require CLI 0.5.0. Upgrade the CLI and template catalog together.

Configure the [provider](providers.md), then launch a Registry source template:

```sh
abx --provider opensandbox template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello --yes
```

The CLI prepares the template, creates one sandbox, runs its startup command and checks every declared service. Its output includes the sandbox ID and all service URLs. Business commands remain available for later calls; launch does not execute them. Use the returned sandbox ID for later commands. OpenSandbox needs a reachable server, Docker, a writable image repository and Docker registry authentication; the server must be able to pull that image. For Express, use `--provider alicloud-express` and configure its platform and ACR credentials.

Official source templates use the existing native base recipe. OpenSandbox resolves its base to `fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49`; `ABX_BASE_IMAGE_REGION` and `ABX_BASE_IMAGE_TAG` override those build inputs. These are image-source settings, independent of the OpenSandbox server location. Docker builds the exact server SDK commit already pinned in the selected Dockerfile and supplies its wheel to the existing install step. No separate Python SDK checkout or host Python build tools are required. The CLI prepares a temporary copy and keeps application instructions and the final `USER` unchanged.

For authenticated templates, set `ABX_SERVER_TOKEN` to the application service token before launching. OpenSandbox server-proxy connections require CLI 0.4.16 or later. The CLI preserves Bearer authentication and also sends the same explicit application token as `X-Access-Token` when that header is not already used by the gateway; gateway credentials are never replaced.

Options:

- `--timeout SECONDS`: build/preparation limit, default 600 and maximum 3600.
- `--sandbox-timeout SECONDS`: instance lifetime, default 300.
- `--alias NAME`: name used to correlate build resources.
- `--build-profile ID`: choose an explicitly declared Dockerfile, for example `portable`. The CLI never silently switches profiles.

Omit `--yes` to confirm the billable build/create interactively. A local source directory works in place of the Registry reference. Custom base images must be explicit; unknown placeholders are reported before building. Custom multi-stage recipes must supply any wheel their Dockerfile copies.

A successful launch keeps the sandbox running until deletion or expiry. On failure, the CLI attempts to delete the sandbox it created. Retained images and platform templates are listed in the resource journal printed by the command. If a remote request times out, inspect that journal before retrying because the resource may already exist.

HTTP template APIs, shell execution, PTY sessions and persistent interpreters are separate functions. A template HTTP API does not require a platform interpreter. See [template startup](template-workflows.md) for manifest and protocol details.

## Application request deadlines

CLI 0.4.17 applies `ABX_HTTP_TIMEOUT` to application discovery, health, command listing and command calls. For example, set `ABX_HTTP_TIMEOUT=330` before running a long application command. This is the wait for each HTTP request; it does not change a template build deadline or cancel work already executing remotely. See [configuration](../reference/configuration.md).

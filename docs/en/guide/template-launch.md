# Launch a template

Use CLI 0.5.7 or newer with the current spec v5 templates. Upgrade the CLI and template catalog together.

CLI 0.5.6 includes native entries from the public catalog. Use `abx --provider alicloud-express template launch base --yes` to launch the built-in Express template. Source templates and provider-managed templates share this command; managed templates have no source directory to install.

The standalone executable includes the built-in Express provider and needs no adjacent provider files. Its launch receipt identifies the executable bytes; npm installations and external plugins identify their installed provider trees. This identity is checked again before creating resources.

Configure the [provider](providers.md), then launch a Registry source template:

```sh
abx --provider opensandbox template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello --yes
```

The CLI prepares the template, creates one sandbox, runs its startup command, waits for `ready_cmd` when declared, and resolves every declared service endpoint. Agent Sandbox Server v2 services also receive health and protocol discovery checks; other protocols are not automatically probed. Its output includes the sandbox ID and all service URLs. Business commands remain available for later calls; launch does not execute them. Use the returned sandbox ID for later commands. OpenSandbox needs a reachable server, Docker, a writable image repository and Docker registry authentication; the server must be able to pull that image. For Express, use `--provider alicloud-express` and configure its platform and ACR credentials.

Official source templates use the existing native base recipe. OpenSandbox resolves its base to `fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49`; `ABX_BASE_IMAGE_REGION` and `ABX_BASE_IMAGE_TAG` override those build inputs. These are image-source settings, independent of the OpenSandbox server location. The selected Dockerfile installs its declared public server release. An explicit local SDK source can build and inject a development wheel; normal builds require no separate Python SDK checkout or host Python build tools. The CLI prepares a temporary copy and keeps application instructions and the final `USER` unchanged.

Run `abx config init` to configure credentials, then find and launch a template in the same session. Running `abx template launch` without a name also opens the catalog picker. For authenticated templates, missing `ABX_SERVER_TOKEN` opens the shared configuration prompt before preparation: enter your own token, or choose to save configuration and press Enter to generate one. Initialization generates and saves it automatically. Later `abx run` calls reuse it. With `--yes`, provide configuration in advance. OpenSandbox server-proxy connections require CLI 0.4.16 or later. The CLI preserves Bearer authentication and also sends the same explicit application token as `X-Access-Token` when that header is not already used by the gateway; gateway credentials are never replaced.

Options:

- `--timeout SECONDS`: build/preparation limit, default 600 and maximum 3600.
- `--sandbox-timeout SECONDS`: instance lifetime, default 300.
- `--alias NAME`: name used to correlate build resources.
- `--build-profile ID`: choose an explicitly declared Dockerfile, for example `portable`. The CLI never silently switches profiles.

Omit `--yes` to confirm the billable build/create interactively. A local source directory works in place of the Registry reference. Custom base images must be explicit; unknown placeholders are reported before building. Custom multi-stage recipes must supply any wheel their Dockerfile copies.

A successful launch keeps the sandbox running until deletion or expiry. On failure, the CLI attempts to delete the sandbox it created. Retained images and platform templates are listed in the resource journal printed by the command. If a remote request times out, inspect that journal before retrying because the resource may already exist.

For native Express template info, a confirmed official missing-template response returns existing error `E2001` with exit status `4`. Network, authorization and server failures are not absence confirmation.

HTTP template APIs, shell execution, PTY sessions and persistent interpreters are separate functions. A template HTTP API does not require a platform interpreter. See [template startup](template-workflows.md) for manifest and protocol details.

## Application request deadlines

CLI 0.4.17 applies `ABX_HTTP_TIMEOUT` to application discovery, health, command listing and command calls. For example, set `ABX_HTTP_TIMEOUT=330` before running a long application command. This is the wait for each HTTP request; it does not change a template build deadline or cancel work already executing remotely. See [configuration](../reference/configuration.md).

## Source build failures

CLI 0.5.7 preserves Docker build (`E7020`), registry authentication (`E7022`), registry push (`E7021`) and platform template preparation (`E7010`/`E7011`) failures instead of replacing them with a configuration error. Docker failures report a controlled diagnosis for network timeouts, TLS trust, dependency resolution, disk space or Dockerfile parsing. Network evidence takes priority when pip also prints “No matching distribution found” after failed index requests. Raw tool output is omitted from the final error because it may contain credentials.

Check connectivity **inside the Docker build network**, including package-index HTTPS, DNS, proxy, CA trust and MTU. A successful host request does not verify container access. Match Docker network MTU to the actual host network when needed; do not disable TLS verification or change dependency pins to hide a network failure. Inspect the printed resource journal before retrying. `--verbose` streams the build output for an intentional retry; review that output locally because build instructions may print private values. The CLI never automatically replays a failed build/push/register operation.

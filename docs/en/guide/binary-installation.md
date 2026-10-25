# Binary Installation

`abx` is distributed as a **precompiled standalone binary** — a single
executable that bundles the Node.js runtime, the Agent Sandbox CLI, and all
of its dependencies. **No Node.js installation is required.**

Binaries are attached to each GitHub Release
([releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases)):

| Platform | File |
|----------|------|
| Linux (x64) | `abx-{version}-linux-x64` |
| Linux (arm64) | `abx-{version}-linux-arm64` |
| macOS (Apple Silicon) | `abx-{version}-darwin-arm64` |
| macOS (Intel) | `abx-{version}-darwin-x64` |
| Windows (x64) | `abx-{version}-windows-x64.exe` |

Each file has a sibling `.sha256` (SHA-256, `sha256sum` / `shasum -a 256` text).
Release **v0.5.2** includes all five `abx-*` platform binaries and matching SHA-256 files. Older v0.2.0 used `ebx-*`, which this installer does not consume. [Source installation](#install-from-source) remains available.

The official website mirrors the complete stable release: all five binaries, the npm archive and SHA-256 sidecars. It validates release sizes and payload hashes before deployment. The [mirror manifest](https://www.agent-sandbox.cn/releases/latest.json) identifies the version currently available; a newly published GitHub release becomes the website default after the mirror is deployed.

---

## Install

The commands below select v0.5.2 when a version is specified. The default installer follows the current website mirror manifest; check `abx --version` after installation. [Release verification](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.agents/evidence/verify/2026-10-25-cli-052-release.md) records the published artifacts and fresh npm package acceptance.

### macOS and Linux

```bash
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
```

The script is POSIX `sh`. It detects the OS and CPU, including a Rosetta shell on Apple Silicon (it installs native `darwin-arm64`) and `aarch64` Linux (`linux-arm64`). The website entry supplies the fully mirrored version and website asset base, so default installation does not query GitHub or download from GitHub. It downloads the binary and the `.sha256`, checks the digest with `sha256sum` or `shasum`, and installs without `sudo`.

The binary download shows curl’s progress bar and percentage on terminal stderr, including with `curl | sh`. Redirected stderr stays quiet; HTTP failures and checksum verification remain visible. If the server omits the total size, curl shows transfer activity without a percentage.

The destination is `/usr/local/bin` when that directory is writable, otherwise `$HOME/.local/bin`. If the directory is not on `PATH`, the script prints the exact `export PATH=...` line to add. It then runs `abx --version`.

```bash
# optional
curl -fsSL https://www.agent-sandbox.cn/install.sh | ABX_VERSION=0.5.2 sh
curl -fsSL https://www.agent-sandbox.cn/install.sh | ABX_INSTALL_DIR="$HOME/bin" sh
```

`ABX_VERSION` accepts `0.5.2` or `v0.5.2`. The function retains the current mirrored release only; an explicit older version keeps the original GitHub download default. `ABX_DOWNLOAD_BASE` overrides the asset prefix, whose layout is `<base>/v<version>/<asset>`. Setting an alternate `ABX_REPO`, `ABX_GITHUB_API` or `ABX_LATEST_URL` retains upstream discovery behavior. A custom download base alone still uses the website-pinned version; set `ABX_VERSION` as well to choose another release. An unsupported OS or CPU exits with an error that names the supported platforms. On Windows, use the PowerShell installer.

The upstream GitHub installer remains available when direct GitHub downloads are preferred:

```bash
curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | sh
```

That upstream entry resolves the latest release through the GitHub API, falling back to the `releases/latest` redirect. The website source/delivery hashes and defaults are recorded in [installer provenance](https://www.agent-sandbox.cn/install.sh.source.json).

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
```

Windows x64 only. The PowerShell script remains hosted on GitHub and downloads from GitHub; the website does not expose an `install.ps1` entry. The binary and checksum are also available for manual download from the website mirror. The script checks the architecture, downloads `abx-<version>-windows-x64.exe` and its `.sha256`, verifies the digest with `Get-FileHash -Algorithm SHA256`, copies the binary to `%LOCALAPPDATA%\Programs\abx\abx.exe`, and adds that directory to the user `PATH`. Open a new terminal if the current one was started before the install. It then runs `abx --version`.

The Windows script supports `ABX_VERSION` and `ABX_INSTALL_DIR`; its default version is the latest GitHub Release.

## Manual download

1. Check the version and filenames in the [website mirror manifest](https://www.agent-sandbox.cn/releases/latest.json).
2. Download the matching asset and `.sha256` under `https://www.agent-sandbox.cn/releases/download/v<version>/`. For example, macOS Apple Silicon v0.5.2:

   ```bash
   curl -fSLO https://www.agent-sandbox.cn/releases/download/v0.5.2/abx-0.5.2-darwin-arm64
   curl -fSLO https://www.agent-sandbox.cn/releases/download/v0.5.2/abx-0.5.2-darwin-arm64.sha256
   ```

3. For other releases, use [GitHub Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases). Pick `abx-*` assets and matching checksums.
4. Check the digest, mark it executable on macOS/Linux, and place it on your `PATH`:

```bash
# macOS
shasum -a 256 -c abx-0.5.2-darwin-arm64.sha256

# Linux
sha256sum -c abx-0.5.2-linux-x64.sha256

chmod +x ./abx-0.5.2-darwin-arm64
mkdir -p ~/.local/bin && mv ./abx-0.5.2-darwin-arm64 ~/.local/bin/abx
```

Windows:

```powershell
Get-FileHash abx-0.5.2-windows-x64.exe -Algorithm SHA256
# Compare the hash with the first field of the .sha256 file.

$installDir = "$env:LOCALAPPDATA\Programs\abx"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Move-Item abx-0.5.2-windows-x64.exe "$installDir\abx.exe"
```

`certutil -hashfile abx-0.5.2-windows-x64.exe SHA256` prints the same digest.

## npm

For a published version, Node.js20+:

```bash
npm view @agent-sandbox/cli version --registry=https://registry.npmjs.org
npm install -g @agent-sandbox/cli --registry=https://registry.npmjs.org
abx --version
```

The public index must resolve first; HTTP404 means publication is incomplete. A CI pass, draft release, or local pack is not an npm upload. If global installation needs elevated permissions, install with `--prefix "$HOME/.local"` and put `$HOME/.local/bin` on PATH instead. Use the binary/source installation path while publication is pending.

## Install from source

Use Node.js 20 or newer. Build and install the current checkout directly:

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
git rev-parse HEAD
npm ci
npm run build
npm install --global --prefix "$HOME/.local" .
export PATH="$HOME/.local/bin:$PATH"
abx --version
```

This installs the compiled checkout directly without depending on a versioned tarball filename.

## Verify the installation

```bash
abx --version
# abx, version 0.5.2
```

> **macOS Gatekeeper:** the release binaries are ad-hoc signed, not notarized. A browser download can be quarantined. If the first launch is blocked:
>
> ```bash
> xattr -d com.apple.quarantine ~/.local/bin/abx
> ```
>
> `install.sh` removes that attribute when `xattr` is present. You can also right-click the binary in Finder and choose **Open** once.

## Binary vs. npm install

| | Standalone binary | `npm install -g @agent-sandbox/cli` |
|---|---|---|
| Status | Website mirror for the current release; GitHub also provides the assets | Check the public npm index in the npm section above |
| Node.js required | No | Yes (20+) |
| Install method | Website `install.sh`, GitHub `install.ps1`, or manual mirrored/Release assets | npm, after the package is published |
| Startup time | Single pre-bundled executable | Loads the compiled modules from `node_modules` |
| Update | Re-run the installer | `npm update -g @agent-sandbox/cli` (after publish) |
| Python SDK (`import agent_sandbox`) | Not included | Not included ([Python source installation](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/install-python.md), see [the `python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk)) |
| Optional extensions (`alicloud`, `mcp`, ...) | Not needed — built in | Not needed — built in |

## Troubleshooting: abx: command not found

1. **The install directory is not on `PATH`.** `install.sh` installs to `/usr/local/bin` or `$HOME/.local/bin` and, when that directory is missing from `PATH`, prints a line like:

   ```bash
   export PATH="$HOME/.local/bin:$PATH"
   ```

   Add the printed line to `~/.profile` (and `~/.bashrc` or `~/.zshrc` if that is the file your terminal reads). Open a new terminal. Check with `command -v abx` and `echo "$PATH"`. On Windows, `install.ps1` appends `%LOCALAPPDATA%\Programs\abx` to the user `PATH`; a terminal that was already open keeps the old value.

2. **The mirror package is a different program.** `npm install -g @agent-sandbox/cli` against a mirror such as npmmirror can install `@agent-sandbox/cli@0.2.2`. That package's bin is `agent-sandbox`, not `abx`, so the shell still reports `abx: command not found`. Uninstall it:

   ```bash
   npm uninstall -g @agent-sandbox/cli
   npm ls -g --depth=0
   command -v agent-sandbox   # leftover binary from 0.2.2, if any
   ```

   Remove a leftover `agent-sandbox` shim from npm's global bin directory if `command -v` still finds it after uninstall. Check the official npm index in the npm section above; the binary installer and [source installation](#install-from-source) remain available.

3. **The selected older release has no `abx-*` asset.** v0.2.0's files are named `ebx-*`. `install.sh` stops with HTTP 404 and does not leave a partial binary. Install from source, or set `ABX_VERSION` to a release that publishes `abx-*` files.

## GitHub download failures

If GitHub downloads fail with curl error 92 or HTTP 000, use the website macOS/Linux command above; its default version, binary and checksum are all served from the website. Remove stale `ABX_REPO`, `ABX_GITHUB_API`, `ABX_LATEST_URL` or `ABX_DOWNLOAD_BASE` overrides if you intend to use that default. Explicit older versions and the Windows PowerShell entry still need GitHub unless you provide a different download base.

## Notes

- The binary bundles the CLI and its runtime dependencies, including the Alibaba Cloud template API client and the MCP servers (STDIO and Streamable HTTP).
- Express management and official template operations load their embedded Alibaba Cloud SDK only when invoked. Standalone binaries do not need a separate SDK installation or a `node_modules` directory. npm installations use the package's declared runtime dependencies installed by npm. A successful `--version` alone does not validate an SDK-backed operation; release verification also runs a read-only management request from an isolated installation.
- `abx --licenses` includes the official SDK dependency graph's shipped license/README notices and original package license declarations. Maintainers regenerate this attribution with `node scripts/alicloud-sdk-notices.mjs` after dependency changes; `--check` verifies it. This is additional attribution, not a full CLI SBOM.
- The binary is only the `abx` CLI. The Python SDK is a separate package: [Python source installation](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/install-python.md) ([`python-sdk`](https://github.com/alibaba-agent-sandbox/python-sdk)).

## Build the binary yourself

For npm artifact validation after `npm run build`, `make dist-check` verifies that
the package contains `dist/bin/abx.js`. It accepts both older npm array reports and
npm 12's package-name keyed reports; a missing entry point still fails the gate.

From a checkout, with Node.js 20 or newer (official builds; distro builds that strip the Node SEA fuse cannot be used):

```bash
npm ci
npm run build:binary
```

The version tag runs [the five-platform binary workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.github/workflows/release-binary.yml) and uploads checksummed assets to a draft Release. Publish the draft only after every platform succeeds. Publishing runs [the npm workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.github/workflows/release.yml), which installs the exact tarball before upload and verifies a public-registry install afterward. For recovery, run the current npm workflow from `main` using workflow_dispatch with `release_tag` set to the existing version tag (for example `v0.5.2`). It explicitly checks out `refs/tags/<release_tag>` and rejects mismatching package versions or recovery workflows run from feature branches. This repairs the publisher without moving the immutable source tag. Both install and publish use `./dist-pack/*.tgz` so npm interprets the argument as a local tarball.

## Next Steps

- [Getting Started](getting-started.md) — Install, configure, first sandbox
- [CLI Tutorial](cli-tutorial.md) — Full CLI lifecycle operations
- [Authentication](authentication.md) — API Key / AK-SK configuration
- [Troubleshooting](troubleshooting.md) — Common issues and solutions

For read-only credential troubleshooting, dispatch the same workflow with `release_tag=v0.4.6` and `diagnostics_only=true`. The publication job is skipped. The diagnostic job uses the same `npm` environment and `NPM_API_TOKEN`, reports only whether identity and target-scope checks succeed, and suppresses account names, package lists and raw registry errors. `npm whoami` establishes authentication; it does not establish write permission. An absent package-access entry is inconclusive for a package's first publication. Check the token's package/scope write selection, the npm account's ownership or organization/team permissions, and unattended 2FA requirements in npm settings. An E404 from publish alone cannot distinguish these causes. Refreshing a secret requires a new run. Keep the source tag unchanged and verify a clean public-registry installation before reporting npm delivery complete.

Npm provenance requires `package.json`'s `repository.url` to match the publishing repository **including capitalization**. Keep `git+https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git` in new releases. Recovery of an older tag validates that its URL identifies the same repository (ignoring capitalization), then corrects capitalization before dependency installation, testing and packaging. A different repository is rejected. The source tag is not moved; this is an explicit package-metadata transformation. The resulting npm tarball has its own checksum and is installed and verified before that exact file is published with provenance. Do not reuse an older Release tarball or claim its bytes are identical. CI logs record both the checked-out source commit and the publishing workflow commit. Registry publication and a clean registry installation remain the delivery gates.

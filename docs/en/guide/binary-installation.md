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
Release **v0.4.0** includes all five `abx-*` platform binaries and matching SHA-256 files. Older v0.2.0 used `ebx-*`, which this installer does not consume. [Source installation](#install-from-source) remains available.

The site can host the same scripts on its own domain later (for example `https://www.agent-sandbox.cn/install.sh` and `https://www.agent-sandbox.cn/install.ps1`). The command stays one line; only the URL changes.

---

## Install

The public default-latest installer was verified against v0.4.0, including SHA-256, version, standard/native help, complete notices and eight locally initiated real Express checks with no owned resources remaining. Later `[Unreleased]` changes require their own matching release.

### macOS and Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | sh
```

The script is POSIX `sh`. It detects the OS and CPU, including a Rosetta shell on Apple Silicon (it installs native `darwin-arm64`) and `aarch64` Linux (`linux-arm64`). It resolves the latest release from the GitHub API and, if that request fails, from the `releases/latest` redirect. It downloads the binary and the `.sha256`, checks the digest with `sha256sum` or `shasum`, and installs without `sudo`.

The destination is `/usr/local/bin` when that directory is writable, otherwise `$HOME/.local/bin`. If the directory is not on `PATH`, the script prints the exact `export PATH=...` line to add. It then runs `abx --version`.

```bash
# optional
curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | ABX_VERSION=0.4.0 sh
curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | ABX_INSTALL_DIR="$HOME/bin" sh
```

`ABX_VERSION` accepts `0.3.0` or `v0.3.0`. An unsupported OS or CPU exits with an error that names the supported platforms. On Windows, use the PowerShell installer.

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
```

Windows x64 only. The script checks the architecture, downloads `abx-<version>-windows-x64.exe` and its `.sha256`, verifies the digest with `Get-FileHash -Algorithm SHA256`, copies the binary to `%LOCALAPPDATA%\Programs\abx\abx.exe`, and adds that directory to the user `PATH`. Open a new terminal if the current one was started before the install. It then runs `abx --version`.

`ABX_VERSION` and `ABX_INSTALL_DIR` work the same way as in `install.sh`.

## Manual download

1. Open the [GitHub Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases) page.
2. Pick the release (usually the latest) whose assets are named `abx-*`.
3. Download the asset for your platform from the table above, and the matching `.sha256`.
4. Check the digest, mark it executable on macOS/Linux, and place it on your `PATH`:

```bash
# macOS
shasum -a 256 -c abx-0.3.0-darwin-arm64.sha256

# Linux
sha256sum -c abx-0.3.0-linux-x64.sha256

chmod +x ./abx-0.3.0-darwin-arm64
mkdir -p ~/.local/bin && mv ./abx-0.3.0-darwin-arm64 ~/.local/bin/abx
```

Windows:

```powershell
Get-FileHash abx-0.3.0-windows-x64.exe -Algorithm SHA256
# Compare the hash with the first field of the .sha256 file.

$installDir = "$env:LOCALAPPDATA\Programs\abx"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Move-Item abx-0.3.0-windows-x64.exe "$installDir\abx.exe"
```

`certutil -hashfile abx-0.3.0-windows-x64.exe SHA256` prints the same digest.

## npm

For a published version, Node.js20+:

```bash
npm view @agent-sandbox/cli version --registry=https://registry.npmjs.org
npm install -g @agent-sandbox/cli --registry=https://registry.npmjs.org
abx --version
```

The public index must resolve first; HTTP404 means publication is incomplete. A CI pass, draft release, or local pack is not an npm upload. If global installation needs elevated permissions, install with `--prefix "$HOME/.local"` and put `$HOME/.local/bin` on PATH instead. Use the binary/source installation path while publication is pending.

## Install from source

Node.js 20 or newer. Verified 2026-10-15 on Linux x64 with Node.js 22.14.0: `npm pack` wrote `agent-sandbox-cli-0.3.0.tgz`, and installing that tarball with `npm install -g` then running `abx --version` printed `abx, version 0.3.0`.

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
git rev-parse HEAD
npm ci
npm run build
npm pack
npm install -g --prefix "$HOME/.local" ./agent-sandbox-cli-0.4.0.tgz
export PATH="$HOME/.local/bin:$PATH"
abx --version
```

`npm pack` names the file `agent-sandbox-cli-<version>.tgz` (the current tree is `agent-sandbox-cli-0.4.0.tgz`).

## Verify the installation

```bash
abx --version
# abx, version 0.3.0
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
| Status | Install script above; needs an `abx-*` GitHub Release (v0.4.0 assets available) | Check the public npm index in the npm section above |
| Node.js required | No | Yes (20+) |
| Install method | `install.sh` / `install.ps1`, or one file from Releases | npm, after the package is published |
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

## Notes

- The binary bundles the CLI and its runtime dependencies, including the Alibaba Cloud template API client and the MCP servers (STDIO and Streamable HTTP).
- Express management and official template operations load their embedded Alibaba Cloud SDK only when invoked. Standalone binaries do not need a separate SDK installation or a `node_modules` directory. npm installations use the package's declared runtime dependencies installed by npm. A successful `--version` alone does not validate an SDK-backed operation; release verification also runs a read-only management request from an isolated installation.
- `abx --licenses` includes the official SDK dependency graph's shipped license/README notices and original package license declarations. Maintainers regenerate this attribution with `node scripts/alicloud-sdk-notices.mjs` after dependency changes; `--check` verifies it. This is additional attribution, not a full CLI SBOM.
- The binary is only the `abx` CLI. The Python SDK is a separate package: [Python source installation](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/install-python.md) ([`python-sdk`](https://github.com/alibaba-agent-sandbox/python-sdk)).

## Build the binary yourself

From a checkout, with Node.js 20 or newer (official builds; distro builds that strip the Node SEA fuse cannot be used):

```bash
npm ci
npm run build:binary
```

The version tag runs [the five-platform binary workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.github/workflows/release-binary.yml) and uploads checksummed assets to a draft Release. Publish the draft only after every platform succeeds. Publishing runs [the npm workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.github/workflows/release.yml), which installs the exact tarball before upload and verifies a public-registry install afterward. For recovery, run the current npm workflow from `main` using workflow_dispatch with `release_tag` set to the existing version tag (for example `v0.4.0`). It explicitly checks out `refs/tags/<release_tag>` and rejects mismatching package versions or recovery workflows run from feature branches. This repairs the publisher without moving the immutable source tag. Both install and publish use `./dist-pack/*.tgz` so npm interprets the argument as a local tarball.

## Next Steps

- [Getting Started](getting-started.md) — Install, configure, first sandbox
- [CLI Tutorial](cli-tutorial.md) — Full CLI lifecycle operations
- [Authentication](authentication.md) — API Key / AK-SK configuration
- [Troubleshooting](troubleshooting.md) — Common issues and solutions

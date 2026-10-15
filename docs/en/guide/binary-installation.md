# Binary Installation

`abx` is also distributed as a **precompiled standalone binary** — a single
executable that bundles the Node.js runtime, the Agent Sandbox CLI, and all
of its dependencies. **No Node.js installation is required.**

Binaries are published for every release on
[GitHub Releases](https://github.com/alibaba-agent-sandbox/agent-sandbox/releases):

| Platform | File |
|----------|------|
| Linux (x64) | `abx-{version}-linux-x64` |
| Linux (arm64) | `abx-{version}-linux-arm64` |
| macOS (Apple Silicon) | `abx-{version}-darwin-arm64` |
| macOS (Intel) | `abx-{version}-darwin-x64` |
| Windows (x64) | `abx-{version}-windows-x64.exe` |

---

## Quick Install

### macOS / Linux (curl)

```bash
# Set the version you want to install
VERSION=0.3.0

# Detect the platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')   # darwin or linux
ARCH=$(uname -m); case "$ARCH" in
  x86_64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
esac

# Download somewhere the current user can write, then install onto PATH.
curl -fsSL -o "$HOME/abx" \
  "https://github.com/alibaba-agent-sandbox/agent-sandbox/releases/download/v${VERSION}/abx-${VERSION}-${OS}-${ARCH}"
chmod +x "$HOME/abx"
sudo mv "$HOME/abx" /usr/local/bin/abx
```

> Writing straight to `/usr/local/bin` fails without permission (`curl: (56)
> Failure writing output to destination`). The download goes to `$HOME`
> first; `sudo mv` is what places it on the default `PATH`.

### Windows (PowerShell)

```powershell
$VERSION = "0.3.0"
$asset = "abx-$VERSION-windows-x64.exe"

# Download the release asset
Invoke-WebRequest `
  -Uri "https://github.com/alibaba-agent-sandbox/agent-sandbox/releases/download/v$VERSION/$asset" `
  -OutFile $asset

# Move it to a directory on your PATH (create it first if needed)
$installDir = "$env:LOCALAPPDATA\Programs\abx"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Move-Item $asset "$installDir\abx.exe"
```

> If `$installDir` is not on your `PATH` yet, add it via
> *Settings → System → About → Advanced system settings → Environment
> Variables*, then reopen the terminal.

## Manual Download

1. Open the [GitHub Releases](https://github.com/alibaba-agent-sandbox/agent-sandbox/releases) page.
2. Pick the release you want (usually the latest).
3. Download the asset matching your platform from the table above.
4. Make it executable (macOS/Linux only) and place it on your `PATH`:

```bash
chmod +x ./abx-0.3.0-darwin-arm64
mkdir -p ~/.local/bin && mv ./abx-0.3.0-darwin-arm64 ~/.local/bin/abx
```

## Verify the SHA256 Checksum

Every release asset ships with a `*.sha256` checksum file. After
downloading, verify the binary's integrity:

```bash
# macOS
shasum -a 256 -c abx-0.3.0-darwin-arm64.sha256

# Linux
sha256sum -c abx-0.3.0-linux-x64.sha256
```

Windows (`certutil`):

```powershell
# Compare the printed digest against the content of the .sha256 file
certutil -hashfile abx-0.3.0-windows-x64.exe SHA256

# Or with PowerShell:
Get-FileHash abx-0.3.0-windows-x64.exe -Algorithm SHA256
```

## Verify the Installation

```bash
abx --version
# abx, version 0.3.0
```

> **macOS Gatekeeper note:** the binaries are not code-signed, so the first
> launch may be blocked by Gatekeeper. If that happens, remove the
> quarantine attribute before running:
>
> ```bash
> sudo xattr -d com.apple.quarantine /usr/local/bin/abx
> ```
>
> Alternatively, right-click the binary in Finder and choose **Open** once.

## Binary vs. npm install

| | Standalone binary | `npm install -g @agent-sandbox/cli` |
|---|---|---|
| Node.js required | No | Yes (20+) |
| Install method | Download one file | npm / any Node.js package manager |
| Startup time | Single pre-bundled executable | Loads the compiled modules from `node_modules` |
| Update | Re-download from Releases | `npm update -g @agent-sandbox/cli` |
| Python SDK (`import agent_sandbox`) | Not included | Not included (`pip install agent-sandbox-client`, see [the `python-sdk` repository](https://github.com/alibaba-agent-sandbox/python-sdk)) |
| Optional extensions (`alicloud`, `mcp`, ...) | Not needed — built in | Not needed — built in |

## Notes & Limitations

- The binary bundles the full CLI **plus** all of its runtime dependencies,
  including the Alibaba Cloud template API client and the MCP servers (STDIO
  and Streamable HTTP). There are no optional extras to install separately.
  If you prefer to manage the CLI through a package manager, install it via
  npm instead:

  ```bash
  npm install -g @agent-sandbox/cli
  ```

- The binary only provides the `abx` CLI. To use the Python SDK
  (`from agent_sandbox.api.sandbox import Sandbox`), install the Python
  package with pip (`pip install agent-sandbox-client`).
  `pip install agent-sandbox` installs an unrelated project.

---

## Build the binary yourself

From a checkout, with Node.js 20 or newer:

```bash
npm ci
npm run build:binary
```

The command writes `dist/binary/abx-<version>-<os>-<arch>` for the machine it runs on. On Windows the file name ends in `.exe`. A release builds that matrix on GitHub Actions (Linux x64, Linux arm64, macOS Apple Silicon, macOS Intel, Windows x64) and attaches the files, plus a `.sha256` for each, to the GitHub Release.

## Next Steps

- [Getting Started](getting-started.md) — Install, configure, first sandbox
- [CLI Tutorial](cli-tutorial.md) — Full CLI lifecycle operations
- [Authentication](authentication.md) — API Key / AK-SK configuration
- [Troubleshooting](troubleshooting.md) — Common issues and solutions

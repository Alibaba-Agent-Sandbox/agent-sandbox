#!/bin/sh
# Install the abx CLI binary for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | sh
#
# Environment:
#   ABX_VERSION        release to install (default: latest GitHub Release; a leading v is optional)
#   ABX_INSTALL_DIR    destination directory (default: /usr/local/bin when writable, else $HOME/.local/bin)
#   ABX_REPO           GitHub owner/name (default: Alibaba-Agent-Sandbox/agent-sandbox)
#   ABX_GITHUB_API     API origin used to resolve the latest release (default: https://api.github.com)
#   ABX_LATEST_URL     fallback URL whose redirect ends in /releases/tag/<tag>
#   ABX_DOWNLOAD_BASE  download prefix, without a trailing slash
#                      (default: https://github.com/<repo>/releases/download)
set -eu

die() {
  printf 'error: %s\n' "$1" >&2
  shift
  for line in "$@"; do
    printf '%s\n' "$line" >&2
  done
  exit 1
}

need_curl() {
  if ! command -v curl >/dev/null 2>&1; then
    die "curl is required to download abx."
  fi
}

detect_platform() {
  uname_s=$(uname -s)
  case "$uname_s" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      die "This installer is for macOS and Linux. On Windows, run install.ps1 in PowerShell:" \
        "irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex"
      ;;
    *)
      die "unsupported operating system '${uname_s}'." \
        "Supported platforms: macOS (darwin-arm64, darwin-x64), Linux (linux-arm64, linux-x64), Windows (windows-x64 via install.ps1)."
      ;;
  esac

  machine=$(uname -m)
  case "$machine" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *)
      die "unsupported architecture '${machine}' on ${os}." \
        "Supported architectures: x64 and arm64. Windows x64 uses install.ps1."
      ;;
  esac

  # A Rosetta shell reports x86_64. Install the native arm64 binary on Apple Silicon.
  if [ "$os" = "darwin" ] && [ "$arch" = "x64" ] && command -v sysctl >/dev/null 2>&1; then
    translated=$(sysctl -n sysctl.proc_translated 2>/dev/null || true)
    if [ "$translated" = "1" ]; then
      arch=arm64
      printf '%s\n' "Rosetta: this shell is x64 on Apple Silicon. Installing the native darwin-arm64 binary."
    fi
  fi
}

validate_version() {
  case "$version" in
    ""|.*|-*|*..*|*[!0-9A-Za-z._+-]*)
      die "invalid version '${version}'. Set ABX_VERSION to a release such as 0.3.0."
      ;;
  esac
}

resolve_version() {
  if [ -n "${ABX_VERSION:-}" ]; then
    version=${ABX_VERSION#v}
    validate_version
    return
  fi

  api=${ABX_GITHUB_API:-https://api.github.com}
  api=${api%/}
  latest_url=${ABX_LATEST_URL:-https://github.com/${repo}/releases/latest}
  body="${tmp}/release.json"
  tag=""
  if curl -fsSL --retry 3 --retry-delay 1 --retry-connrefused \
      -A "abx-installer" \
      -H "Accept: application/vnd.github+json" \
      "${api}/repos/${repo}/releases/latest" -o "$body"; then
    tag=$(awk -F '"' '/"tag_name"/ { for (i = 1; i <= NF; i++) if ($i == "tag_name") { print $(i + 2); exit } }' "$body" || true)
  fi

  if [ -z "$tag" ]; then
    printf '%s\n' "GitHub API did not return a release. Falling back to ${latest_url}" >&2
    final=$(curl -fsSL -o /dev/null -A "abx-installer" -w '%{url_effective}' "$latest_url" || true)
    tag=$(printf '%s\n' "$final" | sed -n 's|.*/releases/tag/\([^/?#]*\).*|\1|p' | head -n 1)
  fi

  if [ -z "$tag" ]; then
    die "could not determine the latest release. Set ABX_VERSION and run the installer again."
  fi
  version=${tag#v}
  validate_version
}

choose_install_dir() {
  if [ -n "${ABX_INSTALL_DIR:-}" ]; then
    install_dir=$ABX_INSTALL_DIR
    return
  fi
  if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    install_dir=/usr/local/bin
    return
  fi
  if [ -z "${HOME:-}" ]; then
    die "HOME is not set. Set ABX_INSTALL_DIR to a writable directory."
  fi
  install_dir="${HOME}/.local/bin"
}

http_get() {
  # http_get URL DEST [progress] -> sets http_status. stdin is a pipe in curl | sh.
  # The binary goes to DEST; only curl's HTTP status is captured on stdout.
  if [ "${3:-}" = "progress" ] && [ -t 2 ]; then
    set -- "$1" "$2" --progress-bar
  else
    set -- "$1" "$2" --silent
  fi
  http_status=$(curl "$3" --show-error -L --retry 3 --retry-delay 1 --retry-connrefused \
    -A "abx-installer" \
    -o "$2" -w '%{http_code}' "$1") || http_status=000
}

download_asset() {
  asset="abx-${version}-${os}-${arch}"
  dl_base=${ABX_DOWNLOAD_BASE:-https://github.com/${repo}/releases/download}
  dl_base=${dl_base%/}
  url="${dl_base}/v${version}/${asset}"
  sum_url="${url}.sha256"

  printf '%s\n' "Downloading ${url}"
  http_get "$url" "${tmp}/bin" progress
  if [ "$http_status" != "200" ]; then
    if [ "$http_status" = "404" ]; then
      extra="Release v${version} has no ${asset} asset. This installer downloads abx-<version>-<os>-<arch> and a .sha256 file."
      if [ "$version" = "0.2.0" ]; then
        extra="Release v0.2.0 published binaries named ebx-* (stale). This installer downloads abx-* only. Select a newer release with abx-* assets, or install from source."
      fi
      die "release asset not found (HTTP 404): ${url}" "$extra"
    fi
    die "download failed (HTTP ${http_status}): ${url}"
  fi
  if [ ! -s "${tmp}/bin" ]; then
    die "downloaded file is empty: ${url}"
  fi

  http_get "$sum_url" "${tmp}/sum"
  if [ "$http_status" != "200" ] || [ ! -s "${tmp}/sum" ]; then
    die "checksum download failed (HTTP ${http_status}): ${sum_url}"
  fi
}

verify_checksum() {
  expected=$(awk 'NF { print $1; exit }' "${tmp}/sum" | tr -d '\r' | tr 'ABCDEF' 'abcdef')
  case "$expected" in
    *[!0-9a-f]*|"")
      die "checksum file is malformed: ${sum_url}"
      ;;
  esac
  if [ "${#expected}" -ne 64 ]; then
    die "checksum file is malformed: ${sum_url}"
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "${tmp}/bin" | awk '{ print $1 }')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "${tmp}/bin" | awk '{ print $1 }')
  else
    die "sha256sum or shasum is required to verify the download."
  fi
  actual=$(printf '%s' "$actual" | tr 'ABCDEF' 'abcdef')
  if [ "$actual" != "$expected" ]; then
    die "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"
  fi
  printf '%s\n' "Checksum verified."
}

install_binary() {
  mkdir -p "$install_dir" || die "cannot create ${install_dir}"
  stage="${install_dir}/.abx.install.$$"
  if ! cp "${tmp}/bin" "$stage"; then
    rm -f "$stage"
    die "cannot write ${stage}"
  fi
  if ! chmod 755 "$stage"; then
    rm -f "$stage"
    die "cannot mark ${stage} executable"
  fi
  if ! mv -f "$stage" "${install_dir}/abx"; then
    rm -f "$stage"
    die "cannot install ${install_dir}/abx"
  fi
  if [ "$os" = "darwin" ] && command -v xattr >/dev/null 2>&1; then
    xattr -d com.apple.quarantine "${install_dir}/abx" 2>/dev/null || true
  fi
}

warn_path() {
  case ":${PATH}:" in
    *":${install_dir}:"*) ;;
    *)
      printf '%s\n' "warning: ${install_dir} is not on PATH." >&2
      printf '%s\n' "Add this line to your shell profile (~/.profile, ~/.bashrc, or ~/.zshrc), then open a new terminal:" >&2
      printf '%s\n' "export PATH=\"${install_dir}:\$PATH\"" >&2
      ;;
  esac
}

main() {
  need_curl
  detect_platform
  repo=${ABX_REPO:-Alibaba-Agent-Sandbox/agent-sandbox}
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  resolve_version
  choose_install_dir
  printf '%s\n' "Installing abx ${version} (${os}-${arch}) to ${install_dir}"
  download_asset
  verify_checksum
  install_binary
  printf '%s\n' "Installed ${install_dir}/abx"
  warn_path
  printf '%s\n' "abx --version"
  "${install_dir}/abx" --version
}

main

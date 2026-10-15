# Install the abx CLI binary on Windows (x64).
#
#   irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
#
# Environment:
#   ABX_VERSION        release to install (default: latest GitHub Release; a leading v is optional)
#   ABX_INSTALL_DIR    destination directory (default: $env:LOCALAPPDATA\Programs\abx)
#   ABX_REPO           GitHub owner/name (default: Alibaba-Agent-Sandbox/agent-sandbox)
#   ABX_GITHUB_API     API origin used to resolve the latest release (default: https://api.github.com)
#   ABX_LATEST_URL     fallback URL whose redirect ends in /releases/tag/<tag>
#   ABX_DOWNLOAD_BASE  download prefix, without a trailing slash
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
}

function Die([string]$Message) {
  throw "error: $Message"
}

function Normalize-Version([string]$Raw) {
  if ([string]::IsNullOrWhiteSpace($Raw)) {
    Die "invalid version. Set ABX_VERSION to a release such as 0.3.0."
  }
  $version = $Raw.Trim()
  if ($version.StartsWith("v") -or $version.StartsWith("V")) {
    $version = $version.Substring(1)
  }
  if ($version -notmatch '^[0-9A-Za-z][0-9A-Za-z._+-]*$' -or $version.Contains("..")) {
    Die "invalid version '$Raw'. Set ABX_VERSION to a release such as 0.3.0."
  }
  return $version
}

function Save-Url([string]$Url, [string]$Dest) {
  $request = [System.Net.HttpWebRequest]::Create($Url)
  $request.UserAgent = "abx-installer"
  $request.AllowAutoRedirect = $true
  $request.MaximumAutomaticRedirections = 5
  try {
    $response = $request.GetResponse()
  } catch [System.Net.WebException] {
    $errResponse = $_.Exception.Response
    if ($null -ne $errResponse) {
      $code = [int]$errResponse.StatusCode
      $errResponse.Close()
      return $code
    }
    return 0
  }
  try {
    $stream = $response.GetResponseStream()
    $out = [System.IO.File]::Open($Dest, [System.IO.FileMode]::Create)
    try {
      $stream.CopyTo($out)
    } finally {
      $out.Close()
    }
    return [int]$response.StatusCode
  } finally {
    $response.Close()
  }
}

$pa = $env:PROCESSOR_ARCHITECTURE
$paWow = $env:PROCESSOR_ARCHITEW6432
if ($pa -eq "AMD64" -or $paWow -eq "AMD64") {
  $arch = "x64"
} else {
  Die "unsupported architecture '$pa'. This installer supports Windows x64 (windows-x64) only."
}

$repo = if ($env:ABX_REPO) { $env:ABX_REPO } else { "Alibaba-Agent-Sandbox/agent-sandbox" }
$api = if ($env:ABX_GITHUB_API) { $env:ABX_GITHUB_API.TrimEnd("/") } else { "https://api.github.com" }
$latestUrl = if ($env:ABX_LATEST_URL) { $env:ABX_LATEST_URL } else { "https://github.com/$repo/releases/latest" }

if ($env:ABX_VERSION) {
  $version = Normalize-Version $env:ABX_VERSION
} else {
  $tag = $null
  try {
    $headers = @{
      "User-Agent" = "abx-installer"
      "Accept" = "application/vnd.github+json"
    }
    $release = Invoke-RestMethod -Headers $headers -Uri "$api/repos/$repo/releases/latest"
    if ($release.tag_name) { $tag = [string]$release.tag_name }
  } catch {
    $tag = $null
  }
  if ([string]::IsNullOrWhiteSpace($tag)) {
    Write-Warning "GitHub API did not return a release. Falling back to $latestUrl"
    $request = [System.Net.HttpWebRequest]::Create($latestUrl)
    $request.AllowAutoRedirect = $true
    $request.MaximumAutomaticRedirections = 5
    $request.UserAgent = "abx-installer"
    $request.Method = "GET"
    $response = $request.GetResponse()
    try {
      $finalUri = $response.ResponseUri.AbsoluteUri
    } finally {
      $response.Close()
    }
    if ($finalUri -match '/releases/tag/([^/?#]+)') {
      $tag = $Matches[1]
    }
  }
  if ([string]::IsNullOrWhiteSpace($tag)) {
    Die "could not determine the latest release. Set ABX_VERSION and run the installer again."
  }
  $version = Normalize-Version $tag
}

if ($env:ABX_INSTALL_DIR) {
  $installDir = $env:ABX_INSTALL_DIR
} else {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    Die "LOCALAPPDATA is not set. Set ABX_INSTALL_DIR to a writable directory."
  }
  $installDir = Join-Path $env:LOCALAPPDATA "Programs\abx"
}

$asset = "abx-$version-windows-$arch.exe"
$dlBase = if ($env:ABX_DOWNLOAD_BASE) { $env:ABX_DOWNLOAD_BASE.TrimEnd("/") } else { "https://github.com/$repo/releases/download" }
$url = "$dlBase/v$version/$asset"
$sumUrl = "$url.sha256"

Write-Output "Installing abx $version (windows-$arch) to $installDir"
Write-Output "Downloading $url"

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("abx-install-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$binPath = Join-Path $tmp $asset
$sumPath = Join-Path $tmp ($asset + ".sha256")

try {
  $status = Save-Url $url $binPath
  if ($status -ne 200 -or -not (Test-Path $binPath) -or (Get-Item $binPath).Length -eq 0) {
    if ($status -eq 404) {
      $extra = "Release v$version has no $asset asset. This installer downloads abx-<version>-windows-x64.exe and a .sha256 file."
      if ($version -eq "0.2.0") {
        $extra = "Release v0.2.0 published binaries named ebx-* (stale). This installer downloads abx-* only. There is no v0.3.0 GitHub Release yet; install from source until one is published."
      }
      Die "release asset not found (HTTP 404): $url. $extra"
    }
    Die "download failed (HTTP $status): $url"
  }

  $sumStatus = Save-Url $sumUrl $sumPath
  if ($sumStatus -ne 200 -or -not (Test-Path $sumPath)) {
    Die "checksum download failed (HTTP $sumStatus): $sumUrl"
  }

  $sumRaw = Get-Content -Raw -Path $sumPath
  if ($sumRaw -match '([A-Fa-f0-9]{64})') {
    $expected = $Matches[1].ToLowerInvariant()
  } else {
    Die "checksum file is malformed: $sumUrl"
  }
  $actual = (Get-FileHash -Algorithm SHA256 -Path $binPath).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Die "checksum mismatch for ${asset}: expected $expected, got $actual"
  }
  Write-Output "Checksum verified."

  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  $dest = Join-Path $installDir "abx.exe"
  Copy-Item -Force -Path $binPath -Destination $dest

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $needle = $installDir.TrimEnd("\")
  $present = $false
  if ($userPath) {
    foreach ($entry in ($userPath -split ";")) {
      if ($entry.TrimEnd("\") -ieq $needle) {
        $present = $true
        break
      }
    }
  }
  if (-not $present) {
    if ([string]::IsNullOrEmpty($userPath)) {
      $updated = $installDir
    } else {
      $updated = $userPath.TrimEnd(";") + ";" + $installDir
    }
    [Environment]::SetEnvironmentVariable("Path", $updated, "User")
    Write-Output "Added $installDir to the user PATH. Open a new terminal to pick it up."
  }
  if ($env:Path -notlike ("*" + $needle + "*")) {
    $env:Path = $installDir + ";" + $env:Path
  }

  Write-Output "Installed $dest"
  Write-Output "abx --version"
  & $dest --version
  if ($LASTEXITCODE -ne 0) {
    Die "abx --version failed with exit code $LASTEXITCODE"
  }
} finally {
  if (Test-Path $tmp) {
    Remove-Item -Recurse -Force $tmp
  }
}

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync, accessSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { TERMINAL_DRIVER } from "../../scripts/terminal-driver.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const INSTALL_SH = join(ROOT, "install.sh");
const REPO = "Alibaba-Agent-Sandbox/agent-sandbox";
const VERSION = "9.9.9";

function fakeBinary(label) {
  return Buffer.from(
    "#!/bin/sh\n" +
      'if [ "$1" = "--version" ]; then\n' +
      `  echo "abx, version ${VERSION} ${label}"\n` +
      "  exit 0\n" +
      "fi\n" +
      "exit 0\n",
    "utf8",
  );
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * @param {object} options
 * @param {Buffer} options.binary
 * @param {string} [options.checksum]
 * @param {number} [options.apiStatus]
 * @param {boolean} [options.fallbackOnly]
 */
async function startRelease(options) {
  const binary = options.binary;
  const checksum = options.checksum ?? sha256(binary);
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    const path = url.pathname;

    if (path === `/repos/${REPO}/releases/latest`) {
      if (options.apiStatus && options.apiStatus !== 200) {
        res.writeHead(options.apiStatus, { "content-type": "text/plain" });
        res.end("unavailable");
        return;
      }
      if (options.fallbackOnly) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("unavailable");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ tag_name: `v${VERSION}`, name: `v${VERSION}` }));
      return;
    }

    if (path === "/releases/latest") {
      res.writeHead(302, { location: `/releases/tag/v${VERSION}` });
      res.end();
      return;
    }

    if (path === `/releases/tag/v${VERSION}`) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("release");
      return;
    }

    const downloadPrefix = `/repos/${REPO}/releases/download/v${VERSION}/`;
    if (path.startsWith(downloadPrefix)) {
      const name = path.slice(downloadPrefix.length);
      if (name.endsWith(".sha256")) {
        const asset = name.slice(0, -".sha256".length);
        const body = options.checksumFor?.(asset) ?? `${checksum}  ${asset}\n`;
        if (body == null) {
          res.writeHead(404);
          res.end("missing checksum");
          return;
        }
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(body);
        return;
      }
      const body = options.binaryFor?.(name) ?? (name === options.asset ? binary : null);
      if (!body) {
        res.writeHead(404);
        res.end("missing asset");
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": body.length });
      if (options.slow) {
        res.write(body.subarray(0, Math.floor(body.length / 2)));
        setTimeout(() => res.end(body.subarray(Math.floor(body.length / 2))), 1200);
      } else res.end(body);
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
  const port = await listen(server);
  return {
    requests,
    base: `http://127.0.0.1:${port}`,
    close: () => close(server),
  };
}

function runInstaller(base, extraEnv, extraPath, terminal = false) {
  const env = { ...process.env };
  delete env.ABX_VERSION;
  delete env.ABX_INSTALL_DIR;
  env.ABX_REPO = REPO;
  env.ABX_GITHUB_API = base;
  env.ABX_DOWNLOAD_BASE = `${base}/repos/${REPO}/releases/download`;
  env.ABX_LATEST_URL = `${base}/releases/latest`;
  if (extraPath) env.PATH = `${extraPath}:${env.PATH}`;
  Object.assign(env, extraEnv);
  // spawn (not spawnSync): the fake release server runs on this event loop.
  return new Promise((resolve) => {
    const child = terminal
      ? spawn("python3", ["-c", TERMINAL_DRIVER, JSON.stringify({ argv: ["sh"], script: INSTALL_SH })], { env })
      : spawn("sh", [INSTALL_SH], { env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 20000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve(terminal && status === 0 ? JSON.parse(stdout) : { status, stdout, stderr });
    });
  });
}

function writeFakeBin(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

test("shellcheck install.sh", () => {
  const which = spawnSync("sh", ["-c", "command -v shellcheck"], { encoding: "utf8" });
  assert.equal(which.status, 0, "shellcheck is required");
  const result = spawnSync("shellcheck", ["-s", "sh", INSTALL_SH], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("installs the current platform from the latest release and verifies the checksum", async () => {
  const platform = currentAsset();
  const binary = fakeBinary(platform);
  const home = mkdtempSync(join(tmpdir(), "abx-home-"));
  const installDir = join(home, "bin");
  const release = await startRelease({ binary, asset: platform });
  try {
    const result = await runInstaller(release.base, {
      HOME: home,
      ABX_INSTALL_DIR: installDir,
      PATH: "/usr/bin:/bin",
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, new RegExp(`abx, version ${VERSION} ${platform}`));
    assert.match(result.stdout, /^abx --version$/m);
    assert.match(result.stderr, /warning: .* is not on PATH/);
    assert.match(result.stderr, new RegExp(`export PATH="${installDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\$PATH"`));
    assert.equal(readFileSync(join(installDir, "abx"), "utf8"), binary.toString("utf8"));
    assert.ok(release.requests.some((p) => p.endsWith(`/releases/latest`) && p.includes("/repos/")));
  } finally {
    await release.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("checksum mismatch does not install", async () => {
  const platform = currentAsset();
  const binary = fakeBinary(platform);
  const home = mkdtempSync(join(tmpdir(), "abx-home-"));
  const installDir = join(home, "bin");
  mkdirSync(installDir, { recursive: true });
  const wrong = "0".repeat(64);
  const release = await startRelease({ binary, asset: platform, checksum: wrong });
  try {
    const result = await runInstaller(release.base, { HOME: home, ABX_INSTALL_DIR: installDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(result.stderr, /checksum mismatch/);
    assert.equal(existsSync(join(installDir, "abx")), false);
  } finally {
    await release.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("falls back to the releases/latest redirect when the API fails", async () => {
  const platform = currentAsset();
  const binary = fakeBinary("fallback");
  const home = mkdtempSync(join(tmpdir(), "abx-home-"));
  const installDir = join(home, "bin");
  const release = await startRelease({ binary, asset: platform, fallbackOnly: true });
  try {
    const result = await runInstaller(release.base, { HOME: home, ABX_INSTALL_DIR: installDir });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(result.stderr, /Falling back/);
    assert.match(output, /abx, version 9\.9\.9 fallback/);
    assert.ok(release.requests.includes("/releases/latest"));
  } finally {
    await release.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("Rosetta on Apple Silicon selects darwin-arm64", async () => {
  const asset = `abx-${VERSION}-darwin-arm64`;
  const binary = fakeBinary("darwin-arm64");
  const home = mkdtempSync(join(tmpdir(), "abx-home-"));
  const installDir = join(home, "bin");
  const fake = mkdtempSync(join(tmpdir(), "abx-fakebin-"));
  writeFakeBin(
    fake,
    "uname",
    "#!/bin/sh\ncase \"$1\" in -s) echo Darwin ;; -m) echo x86_64 ;; *) echo Darwin ;; esac\n",
  );
  writeFakeBin(
    fake,
    "sysctl",
    "#!/bin/sh\nif [ \"$1\" = \"-n\" ] && [ \"$2\" = \"sysctl.proc_translated\" ]; then echo 1; exit 0; fi\nexit 1\n",
  );
  const release = await startRelease({ binary, asset });
  try {
    const result = await runInstaller(
      release.base,
      { HOME: home, ABX_INSTALL_DIR: installDir },
      fake,
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(result.stdout, /Rosetta/);
    assert.match(output, /darwin-arm64/);
    assert.ok(release.requests.some((p) => p.endsWith(`/${asset}`)));
  } finally {
    await release.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(fake, { recursive: true, force: true });
  }
});

test("aarch64 Linux selects linux-arm64", async () => {
  const asset = `abx-${VERSION}-linux-arm64`;
  const binary = fakeBinary("linux-arm64");
  const home = mkdtempSync(join(tmpdir(), "abx-home-"));
  const installDir = join(home, "bin");
  const fake = mkdtempSync(join(tmpdir(), "abx-fakebin-"));
  writeFakeBin(
    fake,
    "uname",
    "#!/bin/sh\ncase \"$1\" in -s) echo Linux ;; -m) echo aarch64 ;; *) echo Linux ;; esac\n",
  );
  const release = await startRelease({ binary, asset });
  try {
    const result = await runInstaller(
      release.base,
      { HOME: home, ABX_INSTALL_DIR: installDir },
      fake,
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /linux-arm64/);
    assert.ok(release.requests.some((p) => p.endsWith(`/${asset}`)));
    assert.equal(existsSync(join(installDir, "abx")), true);
  } finally {
    await release.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(fake, { recursive: true, force: true });
  }
});

test("refuses an unsupported operating system", async () => {
  const home = mkdtempSync(join(tmpdir(), "abx-home-"));
  const fake = mkdtempSync(join(tmpdir(), "abx-fakebin-"));
  writeFakeBin(fake, "uname", "#!/bin/sh\ncase \"$1\" in -s) echo FreeBSD ;; -m) echo amd64 ;; *) echo FreeBSD ;; esac\n");
  const release = await startRelease({ binary: fakeBinary("unused"), asset: "unused" });
  try {
    const result = await runInstaller(release.base, { HOME: home }, fake);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(result.stderr, /unsupported operating system 'FreeBSD'/);
    assert.equal(
      release.requests.some((p) => p.includes("/releases/")),
      false,
    );
  } finally {
    await release.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(fake, { recursive: true, force: true });
  }
});

test("default directory is $HOME/.local/bin when /usr/local/bin is not writable", async () => {
  let writable = false;
  try {
    accessSync("/usr/local/bin", constants.W_OK);
    writable = true;
  } catch {
    // /usr/local/bin is not writable; the installer must use $HOME/.local/bin.
  }
  if (writable) {
    return;
  }
  const platform = currentAsset();
  const binary = fakeBinary(platform);
  const home = mkdtempSync(join(tmpdir(), "abx-home-"));
  const release = await startRelease({ binary, asset: platform });
  try {
    const result = await runInstaller(release.base, { HOME: home, PATH: `${home}/.local/bin:/usr/bin:/bin` });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.equal(existsSync(join(home, ".local", "bin", "abx")), true);
    assert.doesNotMatch(result.stderr, /not on PATH/);
  } finally {
    await release.close();
    rmSync(home, { recursive: true, force: true });
  }
});

function currentAsset() {
  const unameS = spawnSync("uname", ["-s"], { encoding: "utf8" }).stdout.trim();
  const unameM = spawnSync("uname", ["-m"], { encoding: "utf8" }).stdout.trim();
  const os = unameS === "Darwin" ? "darwin" : unameS === "Linux" ? "linux" : null;
  const arch = unameM === "x86_64" || unameM === "amd64" ? "x64" : unameM === "aarch64" || unameM === "arm64" ? "arm64" : null;
  assert.ok(os && arch, `unsupported test host ${unameS} ${unameM}`);
  return `abx-${VERSION}-${os}-${arch}`;
}

const pythonPty = spawnSync("python3", ["-c", "import pty, fcntl, termios"], { encoding: "utf8" });
test("shows real curl percentage on terminal stderr with piped script stdin", { skip: pythonPty.status !== 0 }, async () => {
  const platform = currentAsset();
  const binary = Buffer.concat([fakeBinary(platform), Buffer.from("# padding\n".repeat(8192))]);
  const home = mkdtempSync(join(tmpdir(), "abx-progress-"));
  const installDir = join(home, "bin");
  const release = await startRelease({ binary, asset: platform, slow: true });
  try {
    const result = await runInstaller(release.base, { HOME: home, ABX_INSTALL_DIR: installDir, ABX_VERSION: VERSION }, undefined, true);
    assert.equal(result.status, 0, JSON.stringify(result));
    assert.equal(result.timed_out, false);
    assert.match(result.stderr, /50\.0%/);
    assert.match(result.stderr, /100\.0%/);
    assert.doesNotMatch(result.stdout, /\d+\.\d%/);
    assert.match(result.stdout, /Checksum verified/);
    assert.equal(readFileSync(join(installDir, "abx"), "utf8"), binary.toString("utf8"));
  } finally {
    await release.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("keeps real curl progress out of redirected output", async () => {
  const platform = currentAsset();
  const home = mkdtempSync(join(tmpdir(), "abx-quiet-progress-"));
  const release = await startRelease({ binary: fakeBinary(platform), asset: platform, slow: true });
  try {
    const result = await runInstaller(release.base, { HOME: home, ABX_INSTALL_DIR: join(home, "bin"), ABX_VERSION: VERSION });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stdout + result.stderr, /\d+\.\d%|\r|\u001b/);
  } finally {
    await release.close();
    rmSync(home, { recursive: true, force: true });
  }
});

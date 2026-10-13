#!/usr/bin/env node
/**
 * Build a standalone `abx` binary (esbuild bundle + Node.js single executable).
 *
 * Produces a single-file executable that embeds the Node.js runtime and the
 * whole CLI (every lazily-imported subcommand and all runtime dependencies)
 * as one esbuild bundle injected into a copy of the `node` binary via the
 * Node.js Single Executable Applications (SEA) mechanism.
 *
 * Output naming convention:
 *
 *     abx-{version}-{platform}-{arch}[.exe]
 *
 * where `platform` is one of `linux` / `darwin` / `windows` and `arch` is one
 * of `x64` / `arm64`. Both are detected from the running Node.js, so the
 * produced binary always matches the Node.js that built it (e.g. an x64 Node
 * on macOS produces a darwin-x64 binary).
 *
 * Usage:
 *
 *     npm ci
 *     node scripts/build_binary.mjs
 *
 * Prerequisites: `npm ci` (installs esbuild and postject) and an official
 * Node.js >= 20 build with SEA support (https://nodejs.org); distro builds that
 * strip the SEA fuse cannot be used.
 *
 * Notes on SEA specifics:
 *
 * - Sources are bundled with esbuild (`format: esm`, which keeps top-level await).
 *   `import.meta.url` is rewritten to the file URL of the executable, and the
 *   package version is assigned to `globalThis.__ABX_VERSION` because the
 *   executable has no `package.json` beside it.
 * - On macOS the copied `node` binary has its signature removed before the
 *   blob is injected and is re-signed ad hoc afterwards.
 *
 * After the build, a smoke test runs `abx --version` against the produced
 * binary and the SHA256 digest is printed for verification.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(REPO_ROOT, "dist", "binary");
const BUILD_DIR = join(REPO_ROOT, "build", "sea");
const ENTRY_POINT = join(REPO_ROOT, "src", "bin", "abx.ts");
const BUNDLE_PATH = join(BUILD_DIR, "abx.cjs");
const SEA_CONFIG_PATH = join(BUILD_DIR, "sea-config.json");
const BLOB_PATH = join(BUILD_DIR, "abx.blob");

// Fixed sentinel documented by Node.js; postject flips it when the blob is injected.
const SEA_SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const SEA_RESOURCE_NAME = "NODE_SEA_BLOB";
const SEA_MACHO_SEGMENT = "NODE_SEA";

const SMOKE_TIMEOUT_MS = 120_000;

const ARCH_MAP = {
  x64: "x64",
  x86_64: "x64",
  amd64: "x64",
  arm64: "arm64",
  aarch64: "arm64",
};

/** Return the normalized platform name (linux / darwin / windows). */
export function detectPlatform() {
  const system = process.platform === "win32" ? "windows" : process.platform;
  if (!["linux", "darwin", "windows"].includes(system)) {
    throw new Error(`unsupported platform: '${system}'`);
  }
  return system;
}

/** Return the normalized architecture name (x64 / arm64). */
export function detectArch() {
  const machine = process.arch.toLowerCase();
  const arch = ARCH_MAP[machine];
  if (arch === undefined) {
    throw new Error(`unsupported architecture: '${machine}'`);
  }
  return arch;
}

/** Return the package version from `package.json`. */
export function getVersion() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  return pkg.version;
}

function run(cmd, args, options = {}) {
  console.log(`$ ${[cmd, ...args].join(" ")}`);
  const result = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: "inherit", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`command failed with exit code ${result.status}: ${cmd}`);
  }
}

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    throw new Error("required module 'esbuild' is not installed. Run: npm ci");
  }
}

async function loadPostject() {
  try {
    const mod = await import("postject");
    return mod.inject ?? mod.default?.inject;
  } catch {
    throw new Error("required module 'postject' is not installed. Run: npm ci");
  }
}

/** Bundle the CLI into one CommonJS file suitable as the SEA main script. */
async function bundleCli(esbuild, version) {
  if (!existsSync(ENTRY_POINT)) {
    throw new Error(`entry point not found: ${ENTRY_POINT}`);
  }
  mkdirSync(BUILD_DIR, { recursive: true });
  console.log(`$ esbuild ${ENTRY_POINT} --bundle --platform=node --format=cjs --outfile=${BUNDLE_PATH}`);
  await esbuild.build({
    entryPoints: [ENTRY_POINT],
    outfile: BUNDLE_PATH,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
    // Point import.meta.url at the executable. The SEA bundle is not a file the CLI can read beside.
    define: { "import.meta.url": "__abx_import_meta_url" },
    banner: {
      js: [
        // Runs before any bundled require, including node:http, matching src/bin/abx.ts.
        "const __abxEmitWarning = process.emitWarning;",
        "process.emitWarning = function(warning, ...rest) {",
        "  if (typeof warning === 'string' && warning.startsWith(\"The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR'\")) return;",
        "  return __abxEmitWarning.call(process, warning, ...rest);",
        "};",
        'const __abx_import_meta_url = require("node:url").pathToFileURL(process.execPath).href;',
        `globalThis.__ABX_VERSION = ${JSON.stringify(version)};`,
      ].join("\n"),
    },
  });
  const bundled = readFileSync(BUNDLE_PATH, "utf8");
  if (bundled.startsWith("#!")) {
    writeFileSync(BUNDLE_PATH, bundled.slice(bundled.indexOf("\n") + 1));
  }
}

/** Generate the SEA preparation blob with `node --experimental-sea-config`. */
function generateBlob() {
  const config = {
    main: BUNDLE_PATH,
    output: BLOB_PATH,
    disableExperimentalSEAWarning: true,
  };
  writeFileSync(SEA_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  run(process.execPath, ["--experimental-sea-config", SEA_CONFIG_PATH]);
  if (!existsSync(BLOB_PATH)) {
    throw new Error(`Node.js did not produce the SEA blob ${BLOB_PATH}`);
  }
}

/** Copy the running `node` binary to `target` and inject the SEA blob into it. */
async function injectBlob(inject, target, system) {
  copyFileSync(process.execPath, target);
  chmodSync(target, 0o755);

  if (system === "darwin") {
    // The copied binary carries Apple's signature, which the injection invalidates.
    run("codesign", ["--remove-signature", target]);
  }

  console.log(`$ postject ${target} ${SEA_RESOURCE_NAME} ${BLOB_PATH} --sentinel-fuse ${SEA_SENTINEL_FUSE}`);
  await inject(target, SEA_RESOURCE_NAME, readFileSync(BLOB_PATH), {
    sentinelFuse: SEA_SENTINEL_FUSE,
    ...(system === "darwin" ? { machoSegmentName: SEA_MACHO_SEGMENT } : {}),
  });

  if (system === "darwin") {
    run("codesign", ["--sign", "-", target]);
  }
}

function runVersion(binary) {
  return spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: SMOKE_TIMEOUT_MS,
  });
}

/** Run `abx --version` against the produced binary. */
function smokeTest(binary, version) {
  console.log(`\nsmoke test: ${binary} --version`);
  let result = runVersion(binary);
  if (result.status !== 0) {
    // Transient launch failures have been observed on macOS: a freshly built
    // ad-hoc signed binary may be SIGKILLed on its very first launch while
    // Gatekeeper evaluates the new signature. Real defects reproduce
    // consistently, so a single retry does not mask them.
    console.log(`  first attempt failed (exit code ${result.status}); retrying once...`);
    result = runVersion(binary);
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  console.log(`  exit code: ${result.status}`);
  console.log(`  output:    ${output}`);
  if (result.status !== 0) {
    throw new Error(`smoke test failed with exit code ${result.status}`);
  }
  if (!output.includes(version)) {
    throw new Error(`smoke test output does not contain version '${version}'`);
  }
}

/** Build, rename, and smoke-test the standalone abx binary. */
async function main() {
  const system = detectPlatform();
  const arch = detectArch();
  const version = getVersion();

  const exeSuffix = system === "windows" ? ".exe" : "";
  const finalPath = join(DIST_DIR, `abx-${version}-${system}-${arch}${exeSuffix}`);

  console.log(`Building abx ${version} for ${system}-${arch}`);
  console.log(`Output: ${finalPath}\n`);

  const esbuild = await loadEsbuild();
  const inject = await loadPostject();

  // Clean the work directory ourselves so every build starts from scratch;
  // it also keeps the build self-contained and removable via `make clean`.
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });

  await bundleCli(esbuild, version);
  generateBlob();

  const builtPath = join(DIST_DIR, `abx${exeSuffix}`);
  await injectBlob(inject, builtPath, system);
  if (!existsSync(builtPath) || !statSync(builtPath).isFile()) {
    throw new Error(`SEA injection did not produce ${builtPath}`);
  }

  rmSync(finalPath, { force: true });
  renameSync(builtPath, finalPath);

  smokeTest(finalPath, version);

  const sizeMb = statSync(finalPath).size / (1024 * 1024);
  const digest = createHash("sha256").update(readFileSync(finalPath)).digest("hex");
  console.log(`\nBuild succeeded: ${finalPath} (${sizeMb.toFixed(1)} MB)`);
  console.log(`SHA256: ${digest}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

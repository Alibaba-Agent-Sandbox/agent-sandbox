#!/usr/bin/env node
/**
 * Differential test of the `abx mcp` command group: the original Python CLI (`$ORACLE_VENV/bin/abx`) versus the Node
 * CLI (`src/bin/abx.ts`), same argv / env / files, isolated HOME and cwd per run, local stub servers only (no
 * credentials, no network).
 *
 *   ORACLE_VENV=/path/to/venv-for-original-abx node parity/diff/mcp_cmds.mjs [--only <substring>] [--verbose]
 *
 * Compared per case: exit code, stdout, stderr (after normalising temp dirs, pids, ports, tokens and the Python-only
 * `command`/`args` launcher of installed IDE configs) and every file the command wrote (the deploy artifact is
 * compared byte for byte). The long-running parts (`start` over STDIO/HTTP, `--background`, `stop`) are driven
 * through real processes and compared on the same observable surface (banner, uvicorn-style lines, state file,
 * exit status after SIGTERM/SIGINT).
 *
 * Exit code 0 = identical, 1 = differences, 2 = oracle missing.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const verbose = process.argv.includes("--verbose");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "abx"))) {
  console.error("ORACLE_VENV must point to a venv with the original agent-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

const TSX_LOADER = import.meta.resolve("tsx");
const NODE_ENTRY = join(CLI_ROOT, "src", "bin", "abx.ts");
const CONFIG_CMD_PRESENT = existsSync(join(CLI_ROOT, "src", "cli", "commands", "config_cmd.ts"));

/** Launch spec of each implementation. */
const IMPLS = {
  python: { cmd: join(ORACLE_VENV, "bin", "abx"), args: [] },
  node: { cmd: process.execPath, args: ["--import", TSX_LOADER, NODE_ENTRY] },
};

// ---------------------------------------------------------------------------------------------------------------------
// Sandbox directories and process helpers
// ---------------------------------------------------------------------------------------------------------------------

const BASE_ENV_KEYS = ["PATH", "LANG", "LC_ALL", "TMPDIR"];

function makeWorld() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "abx-mcpdiff-")));
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  const run = join(root, "run");
  for (const d of [home, cwd, run]) mkdirSync(d, { recursive: true });
  return { root, home, cwd, run };
}

function baseEnv(world, extra = {}) {
  const env = {};
  for (const k of BASE_ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.HOME = world.home;
  env.USERPROFILE = world.home;
  env.ABX_NO_KEYCHAIN = "1";
  env.ABX_MCP_RUNTIME_DIR = world.run;
  env.PYTHONUNBUFFERED = "1";
  env.NO_COLOR = "1";
  env.TMPDIR = join(world.root, "tmp");
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  return env;
}

function spawnImpl(impl, argv, world, env, opts = {}) {
  const { cmd, args } = IMPLS[impl];
  return spawn(cmd, [...args, ...argv], { cwd: opts.cwd ?? world.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
}

function collect(proc) {
  const out = { stdout: "", stderr: "" };
  proc.stdout.setEncoding("utf8").on("data", (c) => (out.stdout += c));
  proc.stderr.setEncoding("utf8").on("data", (c) => (out.stderr += c));
  const done = new Promise((resolveDone) => {
    proc.once("close", (code, signal) => resolveDone({ code, signal }));
  });
  return { out, done };
}

async function runToEnd(impl, argv, world, env, { stdin = "", timeoutMs = 30000 } = {}) {
  const proc = spawnImpl(impl, argv, world, env);
  const { out, done } = collect(proc);
  const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
  if (Array.isArray(stdin)) {
    // [chunk, regexToAwaitOnStdout] steps: a client that waits for each answer before sending the next message.
    for (const [chunk, awaited] of stdin) {
      proc.stdin.write(chunk);
      if (awaited) await waitFor(() => awaited.test(out.stdout), 25000);
    }
    proc.stdin.end();
  } else {
    proc.stdin.end(stdin);
  }
  const { code, signal } = await done;
  clearTimeout(timer);
  return { code: signal ? `signal:${signal}` : code, stdout: out.stdout, stderr: out.stderr };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, timeoutMs = 15000, stepMs = 50) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await pred();
    if (v) return v;
    await sleep(stepMs);
  }
  return null;
}

function freePort() {
  return new Promise((resolveP) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolveP(port));
    });
  });
}

function walkFiles(dir, base = dir, acc = {}) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, base, acc);
    else acc[relative(base, p)] = readFileSync(p, "utf8");
  }
  return acc;
}

// ---------------------------------------------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------------------------------------------

const CONFIG_WARNING = /^⚠ Warning: Failed to load shortcuts from config:[^\n]*\n(?: {2}[^\n]*\n)*/m;

function makeNormalizer(world, extra = []) {
  return (text) => {
    let t = String(text);
    if (!CONFIG_CMD_PRESENT) t = t.replace(CONFIG_WARNING, "");
    t = t.split(world.root).join("<T>");
    for (const [re, rep] of extra) t = t.replace(re, rep);
    t = t.replace(/abx-mcp-deploy-[a-z0-9_]{6,8}\b/g, "abx-mcp-deploy-XXXX");
    t = t.replace(/\[\d+\]/g, "[PID]");
    return t;
  };
}

/** IDE config files embed the launcher (`command`/`args`), which is intentionally implementation specific. */
function normalizeIdeConfig(text) {
  return text.replace(/("command": )"[^"\n]*",(\s*)"args": \[[^\]]*?"mcp",\s*"start"\s*\]/g, '$1"<LAUNCHER>",$2"args": "<LAUNCHER-ARGS> mcp start"');
}

// ---------------------------------------------------------------------------------------------------------------------
// Static cases (run to completion)
// ---------------------------------------------------------------------------------------------------------------------

const VALID_OTHER = JSON.stringify({ mcpServers: { "other-server": { command: "other" } }, unrelated: [1, 2, { a: null }] });

const STATIC_CASES = [];
const add = (name, spec) => STATIC_CASES.push({ name, ...spec });

// --- install ---------------------------------------------------------------------------------------------------------
for (const target of ["cursor", "claude", "vscode"]) {
  const file = { cursor: ".cursor/mcp.json", claude: ".config/claude/claude_desktop_config.json", vscode: ".vscode/mcp.json" }[target];
  const base = target === "vscode" ? "cwd" : "home";
  const ide = { target, file, base };
  add(`install ${target}: no key`, { argv: ["mcp", "install", "--target", target], ide });
  add(`install ${target}: key from env`, { argv: ["mcp", "install", "--target", target], env: { E2B_API_KEY: "key-123" }, ide });
  add(`install ${target}: SANDBOX_API_KEY fallback`, { argv: ["mcp", "install", "--target", target], env: { SANDBOX_API_KEY: "sk-9" }, ide });
  add(`install ${target}: url+region env`, {
    argv: ["mcp", "install", "--target", target],
    env: { E2B_API_KEY: "k", E2B_API_URL: "http://127.0.0.1:1", SANDBOX_REGION: "cn-beijing" },
    ide,
  });
  add(`install ${target}: SANDBOX_API_BASE_URL`, {
    argv: ["mcp", "install", "--target", target],
    env: { SANDBOX_API_BASE_URL: "http://example.invalid" },
    ide,
  });
  add(`install ${target}: merge existing`, { argv: ["mcp", "install", "--target", target], env: { E2B_API_KEY: "k" }, files: { [`${base}/${file}`]: VALID_OTHER }, ide });
  add(`install ${target}: replaces stale entry`, {
    argv: ["mcp", "install", "--target", target],
    env: { E2B_API_KEY: "new" },
    files: { [`${base}/${file}`]: JSON.stringify({ [target === "vscode" ? "servers" : "mcpServers"]: { "agent-sandbox": { command: "old" }, z: 1 }, a: "é" }) },
    ide,
  });
  add(`install ${target}: jsonc refused`, { argv: ["mcp", "install", "--target", target], files: { [`${base}/${file}`]: '{ // c\n "a": 1,\n}\n' }, ide });
  add(`install ${target}: trailing comma`, { argv: ["mcp", "install", "--target", target], files: { [`${base}/${file}`]: '{"a": 1,}' }, ide });
  add(`install ${target}: empty file`, { argv: ["mcp", "install", "--target", target], files: { [`${base}/${file}`]: "" }, ide });
  add(`install ${target}: array refused`, { argv: ["mcp", "install", "--target", target], files: { [`${base}/${file}`]: "[1,2]" }, ide });
  add(`install ${target}: string refused`, { argv: ["mcp", "install", "--target", target], files: { [`${base}/${file}`]: '"x"' }, ide });
  add(`install ${target}: null refused`, { argv: ["mcp", "install", "--target", target], files: { [`${base}/${file}`]: "null" }, ide });
  add(`install ${target}: servers not a dict`, {
    argv: ["mcp", "install", "--target", target],
    files: { [`${base}/${file}`]: JSON.stringify({ mcpServers: ["x"], servers: 5 }) },
    ide,
  });
  add(`install ${target}: NaN literal`, { argv: ["mcp", "install", "--target", target], files: { [`${base}/${file}`]: '{"a": NaN, "b": Infinity}' }, ide });
  add(`install ${target}: unicode`, {
    argv: ["mcp", "install", "--target", target],
    files: { [`${base}/${file}`]: '{"名前": "値", "e": "\\u00e9\\ud83d\\ude00", "x": 1e5, "y": 1.5, "z": -0}' },
    ide,
  });
  add(`install ${target}: BOM`, { argv: ["mcp", "install", "--target", target], files: { [`${base}/${file}`]: '\ufeff{"a": 1}' }, ide });
  add(`install ${target}: deep nesting + big int`, {
    argv: ["mcp", "install", "--target", target],
    files: { [`${base}/${file}`]: '{"a": {"b": [1, [2, {"c": []}], {}]}, "big": 12345678901234567890}' },
    ide,
  });
  add(`install ${target}: --json`, { argv: ["--json", "mcp", "install", "--target", target], env: { E2B_API_KEY: "k" }, ide });
  add(`install ${target}: --quiet`, { argv: ["--quiet", "mcp", "install", "--target", target], env: { E2B_API_KEY: "k" }, ide });
  add(`install ${target}: --no-color`, { argv: ["--no-color", "mcp", "install", "--target", target], ide });
}
add("install: no target", { argv: ["mcp", "install"] });
add("install: bad target", { argv: ["mcp", "install", "--target", "emacs"] });
add("install: target case", { argv: ["mcp", "install", "--target", "CURSOR"] });
add("install: unknown option", { argv: ["mcp", "install", "--target", "cursor", "--bogus"] });
add("install: extra arg", { argv: ["mcp", "install", "--target", "cursor", "extra"] });
add("install: config path is a directory", {
  argv: ["mcp", "install", "--target", "cursor"],
  dirs: ["home/.cursor/mcp.json"],
});
add("install: parent is a file", {
  argv: ["mcp", "install", "--target", "cursor"],
  files: { "home/.cursor": "not a dir" },
});
add("install: unreadable config", {
  argv: ["mcp", "install", "--target", "cursor"],
  files: { "home/.cursor/mcp.json": "{}" },
  chmod: { "home/.cursor/mcp.json": 0o000 },
});
add("install: read-only dir", {
  argv: ["mcp", "install", "--target", "cursor"],
  dirs: ["home/.cursor"],
  chmod: { "home/.cursor": 0o500 },
});
add("install: invalid utf-8", {
  argv: ["mcp", "install", "--target", "cursor"],
  binFiles: { "home/.cursor/mcp.json": Buffer.from([0x7b, 0xff, 0xfe, 0x7d]) },
});
add("install: key from ./.env", { argv: ["mcp", "install", "--target", "cursor"], files: { "cwd/.env": "E2B_API_KEY=dotenv-key\n" }, ide: { target: "cursor", file: ".cursor/mcp.json", base: "home" } });
add("install: key from ~/.abx/.env", { argv: ["mcp", "install", "--target", "cursor"], files: { "home/.abx/.env": "SANDBOX_API_KEY=home-key\n" }, ide: { target: "cursor", file: ".cursor/mcp.json", base: "home" } });
add("install: key from config.toml", { argv: ["mcp", "install", "--target", "cursor"], files: { "home/.abx/config.toml": '[transport]\napi_key = "toml-key"\n' }, ide: { target: "cursor", file: ".cursor/mcp.json", base: "home" } });
add("install: blank env key falls through", {
  argv: ["mcp", "install", "--target", "cursor"],
  env: { E2B_API_KEY: "  ", SANDBOX_API_KEY: "second" },
  ide: { target: "cursor", file: ".cursor/mcp.json", base: "home" },
});
add("install: region flag rejected", { argv: ["mcp", "install", "--target", "cursor", "--region", "cn-shanghai"] });

// --- status ----------------------------------------------------------------------------------------------------------
const STATUS_FILES = {
  all: {
    "home/.cursor/mcp.json": JSON.stringify({ mcpServers: { "agent-sandbox": { command: "x" } } }),
    "home/.config/claude/claude_desktop_config.json": JSON.stringify({ mcpServers: { "agent-sandbox": {} } }),
    "cwd/.vscode/mcp.json": JSON.stringify({ servers: { "agent-sandbox": {} } }),
  },
  listish: {
    "home/.cursor/mcp.json": JSON.stringify({ mcpServers: ["agent-sandbox"] }),
    "home/.config/claude/claude_desktop_config.json": JSON.stringify({ mcpServers: "xx-agent-sandbox-yy" }),
    "cwd/.vscode/mcp.json": JSON.stringify({ servers: 5 }),
  },
  weird: {
    "home/.cursor/mcp.json": "[]",
    "home/.config/claude/claude_desktop_config.json": "{bad json",
    "cwd/.vscode/mcp.json": JSON.stringify({ mcpServers: { "agent-sandbox": {} } }),
  },
  nulls: {
    "home/.cursor/mcp.json": JSON.stringify({ mcpServers: null }),
    "home/.config/claude/claude_desktop_config.json": JSON.stringify({ mcpServers: {} }),
    "cwd/.vscode/mcp.json": JSON.stringify({ servers: { "other": 1 } }),
  },
  emptyfile: { "home/.cursor/mcp.json": "", "cwd/.vscode/mcp.json": "{}" },
};
add("status: nothing installed", { argv: ["mcp", "status"] });
add("status: nothing installed --json", { argv: ["--json", "mcp", "status"] });
add("status: nothing installed --quiet", { argv: ["--quiet", "mcp", "status"] });
add("status: key via env", { argv: ["mcp", "status"], env: { E2B_API_KEY: "k" } });
add("status: key via env --json", { argv: ["--json", "mcp", "status"], env: { SANDBOX_API_KEY: "k" } });
for (const [n, files] of Object.entries(STATUS_FILES)) {
  add(`status: ${n}`, { argv: ["mcp", "status"], files });
  add(`status: ${n} --json`, { argv: ["--json", "mcp", "status"], files });
}
add("status: stale state file", { argv: ["--json", "mcp", "status"], files: { "run/mcp-server.json": JSON.stringify({ pid: 999999999, mode: "http" }) } });
add("status: running state file (this test runner pid)", { argv: ["--json", "mcp", "status"], files: { "run/mcp-server.json": JSON.stringify({ pid: "@@PID@@", mode: "stdio" }) } });
add("status: --region rejected", { argv: ["mcp", "status", "--region", "x"] });

// --- stop ------------------------------------------------------------------------------------------------------------
add("stop: nothing running", { argv: ["mcp", "stop"] });
add("stop: nothing running --quiet", { argv: ["--quiet", "mcp", "stop"] });
for (const [n, content] of Object.entries({
  stale: JSON.stringify({ pid: 999999999, mode: "http" }),
  "no pid": JSON.stringify({ mode: "http" }),
  "string pid": JSON.stringify({ pid: "12", mode: "http" }),
  "zero pid": JSON.stringify({ pid: 0 }),
  "negative pid": JSON.stringify({ pid: -5 }),
  array: "[1]",
  garbage: "not json",
  empty: "",
})) {
  add(`stop: ${n} state file`, { argv: ["mcp", "stop"], files: { "run/mcp-server.json": content }, post: ["run/mcp-server.json"] });
}

// --- start validation ------------------------------------------------------------------------------------------------
add("start: non-loopback needs token", { argv: ["mcp", "start", "--http", "--host", "0.0.0.0", "--auth-token", ""] });
add("start: non-loopback whitespace token", { argv: ["mcp", "start", "--http", "--host", "0.0.0.0", "--auth-token", "  "] });
add("start: non-loopback env token empty", { argv: ["mcp", "start", "--http", "--host", "10.0.0.1"], env: { ABX_MCP_AUTH_TOKEN: "" } });
add("start: non-loopback background", { argv: ["mcp", "start", "--background", "--host", "0.0.0.0"] });
add("start: bad port", { argv: ["mcp", "start", "--http", "--port", "abc"] });
add("start: unknown option", { argv: ["mcp", "start", "--bogus"] });
add("start: region rejected", { argv: ["mcp", "start", "--region", "cn-shanghai"] });
add("start: refuses live server (stdio)", { argv: ["mcp", "start", "--api-key", "k"], files: { "run/mcp-server.json": JSON.stringify({ pid: "@@PID@@", mode: "stdio" }) } });
add("start: refuses live server (http)", { argv: ["mcp", "start", "--http", "--port", "1"], files: { "run/mcp-server.json": JSON.stringify({ pid: "@@PID@@", mode: "http" }) } });
add("start: refuses live server (no mode)", { argv: ["mcp", "start"], files: { "run/mcp-server.json": JSON.stringify({ pid: "@@PID@@" }) } });
add("start: refuses live server (weird mode)", { argv: ["mcp", "start"], files: { "run/mcp-server.json": JSON.stringify({ pid: "@@PID@@", mode: ["a", 1, null] }) } });
add("start: stale state is replaced (stdio, EOF)", {
  argv: ["mcp", "start", "--api-key", "k"],
  files: { "run/mcp-server.json": JSON.stringify({ pid: 999999999, mode: "http" }) },
  post: ["run/mcp-server.json"],
});

// --- deploy ----------------------------------------------------------------------------------------------------------
const TOKEN = "fixed-token-value-0123456789";
const tokenFile = { "cwd/token.txt": `${TOKEN}\n` };
const D = (name, argv, extra = {}) =>
  add(`deploy: ${name}`, { argv: ["mcp", "deploy", "--output-dir", extra.outdirOverride ?? "out", ...argv], deploy: true, ...extra });
D("token file", ["--auth-token-file", "token.txt"], { files: tokenFile, env: { E2B_API_KEY: "k1" } });
D("token file, whitespace", ["--auth-token-file", "token.txt"], { files: { "cwd/token.txt": "\n\t  tok-with-ws \r\n\n" }, env: { E2B_API_KEY: "k1" } });
D("token file, empty", ["--auth-token-file", "token.txt"], { files: { "cwd/token.txt": "  \n" } });
D("token file, missing", ["--auth-token-file", "nope.txt"]);
D("token file, directory", ["--auth-token-file", "."]);
D("token file, unicode", ["--auth-token-file", "token.txt"], { files: { "cwd/token.txt": "tök€n-日本\n" } });
D("token file, short", ["--auth-token-file", "token.txt"], { files: { "cwd/token.txt": "short\n" } });
D("token file, exactly 8", ["--auth-token-file", "token.txt"], { files: { "cwd/token.txt": "12345678\n" } });
D("token file, 9 chars", ["--auth-token-file", "token.txt"], { files: { "cwd/token.txt": "123456789\n" } });
D("token file wins over --generate-token", ["--auth-token-file", "token.txt", "--generate-token"], { files: tokenFile });
D("env token", ["--api-key", "k"], { env: { ABX_MCP_AUTH_TOKEN: `  ${TOKEN}  ` } });
D("env token blank", ["--api-key", "k"], { env: { ABX_MCP_AUTH_TOKEN: "   " } });
D("no token", []);
D("no token, no key", []);
D("generate token", ["--generate-token"], { env: { E2B_API_KEY: "key" }, generated: true });
D("generate token --json", ["--generate-token"], { env: { E2B_API_KEY: "key" }, generated: true, json: true });
D("generate token --quiet", ["--generate-token"], { env: { E2B_API_KEY: "key" }, generated: true, quiet: true });
D("generate token, no key (warning)", ["--generate-token"], { generated: true });
D("explicit api key", ["--generate-token", "--api-key", "cli-key"], { generated: true });
D("api key from E2B_API_KEY env (click envvar)", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "envkey" } });
D("api key from SANDBOX_API_KEY", ["--generate-token"], { generated: true, env: { SANDBOX_API_KEY: "sk" } });
D("api key from ./.env", ["--generate-token"], { generated: true, files: { "cwd/.env": "E2B_API_KEY=dotenvkey\n" } });
D("api key from config.toml", ["--generate-token"], { generated: true, files: { "home/.abx/config.toml": '[transport]\napi_key = "tomlkey"\n' } });
D("api key with yaml-special chars", ["--generate-token", "--api-key", "a: b #c 'd' \"e\""], { generated: true });
D("api key with leading dash and colon", ["--generate-token", "--api-key=-abc: def"], { generated: true });
D("api key looks numeric", ["--generate-token", "--api-key", "12345"], { generated: true });
D("api key looks boolean", ["--generate-token", "--api-key", "yes"], { generated: true });
D("api key empty string", ["--generate-token", "--api-key", ""], { generated: true });
D("api key very long with spaces", ["--generate-token", "--api-key", "word ".repeat(40).trim()], { generated: true });
D("api key unicode", ["--generate-token", "--api-key", "kéy-日本-😀"], { generated: true });
D("api key multi-line", ["--generate-token", "--api-key", "line1\nline2"], { generated: true });
D("custom name/template/memory/timeout", ["--generate-token", "--name", "my-fn: #1", "--template", "py-3.11", "--memory", "2048", "--timeout", "30"], { generated: true, env: { E2B_API_KEY: "k" } });
D("template looks like number", ["--generate-token", "--template", "1.0"], { generated: true, env: { E2B_API_KEY: "k" } });
D("template empty", ["--generate-token", "--template", ""], { generated: true, env: { E2B_API_KEY: "k" } });
D("name unicode", ["--generate-token", "--name", "函数-é"], { generated: true, env: { E2B_API_KEY: "k" } });
D("name null-ish", ["--generate-token", "--name", "null"], { generated: true, env: { E2B_API_KEY: "k" } });
D("name tilde", ["--generate-token", "--name", "~"], { generated: true, env: { E2B_API_KEY: "k" } });
D("memory zero/negative", ["--generate-token", "--memory", "-1", "--timeout", "0"], { generated: true, env: { E2B_API_KEY: "k" } });
D("memory not int", ["--generate-token", "--memory", "lots"]);
D("timeout not int", ["--generate-token", "--timeout", "1.5"]);
// Known gap (KNOWN-GAPS): `--memory 123456789012345678901234567890` is an arbitrary-precision int in Python.
D("session affinity on", ["--generate-token", "--enable-session-affinity"], { generated: true, env: { E2B_API_KEY: "k" } });
D("session affinity off", ["--generate-token", "--no-session-affinity"], { generated: true, env: { E2B_API_KEY: "k" } });
D("session affinity last wins", ["--generate-token", "--no-session-affinity", "--enable-session-affinity"], { generated: true, env: { E2B_API_KEY: "k" } });
D("custom domain", ["--generate-token", "--custom-domain", "mcp.example.com"], { generated: true, env: { E2B_API_KEY: "k" } });
D("custom domain empty", ["--generate-token", "--custom-domain", ""], { generated: true, env: { E2B_API_KEY: "k" } });
D("region flag", ["--generate-token", "--region", "cn-shanghai"], { generated: true, env: { E2B_API_KEY: "k" } });
D("region short flag", ["--generate-token", "-r", "cn-beijing"], { generated: true, env: { E2B_API_KEY: "k" } });
D("region env", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "k", SANDBOX_REGION: "cn-shenzhen" } });
D("region from config.toml", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "k" }, files: { "home/.abx/config.toml": '[transport]\nregion = "cn-beijing"\n' } });
D("region flag beats env", ["--generate-token", "--region", "cn-shanghai"], { generated: true, env: { E2B_API_KEY: "k", SANDBOX_REGION: "cn-shenzhen" } });
D("region from ./.env", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "k" }, files: { "cwd/.env": "SANDBOX_REGION=cn-qingdao\n" } });
D("api url env", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "k", E2B_API_URL: "http://127.0.0.1:9" } });
D("api url fallback env", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "k", SANDBOX_API_BASE_URL: "http://x.invalid" } });
D("api url both env (E2B wins)", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "k", E2B_API_URL: "http://a", SANDBOX_API_BASE_URL: "http://b" } });
D("all options", ["--auth-token-file", "token.txt", "--name", "n", "--template", "t", "--memory", "128", "--timeout", "5", "--no-session-affinity", "--custom-domain", "d.example", "--region", "r1", "--api-key", "ak"], {
  files: tokenFile,
  env: { E2B_API_URL: "http://u" },
});
D("output dir already has files", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "k" }, files: { "cwd/out/zzz.txt": "x", "cwd/out/App.py": "x", "cwd/out/app.py": "old", "cwd/out/_a": "1" }, dirs: ["cwd/out/sub"] });
D("output dir is a file", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "k" }, files: { "cwd/out": "i am a file" } });
D("output dir nested", ["--generate-token"], { generated: true, env: { E2B_API_KEY: "k" }, outdirOverride: "a/b/c" });
D("unknown option", ["--bogus"]);
D("help mentions", ["--help"]);
add("deploy: relative ./out/", { argv: ["mcp", "deploy", "--output-dir", "./out/", "--auth-token-file", "token.txt", "--api-key", "k"], deploy: true, files: tokenFile });
add("deploy: path with dup slashes", { argv: ["mcp", "deploy", "--output-dir", "x//y/./z", "--auth-token-file", "token.txt", "--api-key", "k"], deploy: true, outdirOverride: "x/y/z", files: tokenFile });
add("deploy: absolute output dir", { argv: ["mcp", "deploy", "--output-dir", "@@ROOT@@/abs-out", "--auth-token-file", "token.txt", "--api-key", "k"], deploy: true, outdirOverride: "../abs-out", files: tokenFile });
add("deploy: no output dir (temp dir)", { argv: ["mcp", "deploy", "--auth-token-file", "token.txt", "--api-key", "k"], deploy: true, tempOut: true, files: tokenFile });
add("deploy: no output dir, generated token", { argv: ["mcp", "deploy", "--generate-token", "--api-key", "k"], deploy: true, tempOut: true, generated: true });
add("deploy: output dir empty string", { argv: ["mcp", "deploy", "--output-dir", "", "--auth-token-file", "token.txt", "--api-key", "k"], deploy: true, tempOut: true, files: tokenFile });
add("deploy: unwritable output dir", { argv: ["mcp", "deploy", "--output-dir", "ro/out", "--auth-token-file", "token.txt", "--api-key", "k"], deploy: true, dirs: ["cwd/ro"], chmod: { "cwd/ro": 0o500 }, files: tokenFile });
add("deploy: --help", { argv: ["mcp", "deploy", "--help"] });
add("deploy: -h", { argv: ["mcp", "deploy", "-h"] });
add("mcp: --help", { argv: ["mcp", "--help"] });
add("mcp: no args", { argv: ["mcp"] });
add("mcp: unknown subcommand", { argv: ["mcp", "frobnicate"] });
add("mcp: unknown subcommand typo", { argv: ["mcp", "statu"] });
add("mcp: install --help", { argv: ["mcp", "install", "--help"] });
add("mcp: start --help", { argv: ["mcp", "start", "--help"] });
add("mcp: stop --help", { argv: ["mcp", "stop", "--help"] });
add("mcp: status --help", { argv: ["mcp", "status", "--help"] });
add("mcp: stop extra arg", { argv: ["mcp", "stop", "now"] });
add("mcp: -v verbose status", {
  argv: ["--verbose", "mcp", "status"], files: { "home/.abx/config.toml": "[transport]\nregion = \"cn-hangzhou\"\n" } });

// ---------------------------------------------------------------------------------------------------------------------
// Case execution
// ---------------------------------------------------------------------------------------------------------------------

import { chmodSync } from "node:fs";

async function runStaticCase(impl, c) {
  const world = makeWorld();
  let sleeper = null;
  try {
    const pidHolder = { pid: null };
    const needsLivePid = JSON.stringify(c.files ?? {}).includes("@@PID@@");
    if (needsLivePid) {
      sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
      pidHolder.pid = sleeper.pid;
    }
    const subst = (s) => s.replace(/"@@PID@@"/g, String(pidHolder.pid)).replace(/@@ROOT@@/g, world.root);
    for (const d of c.dirs ?? []) mkdirSync(join(world.root, d), { recursive: true });
    for (const [rel, content] of Object.entries(c.files ?? {})) {
      const p = join(world.root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, subst(content));
    }
    for (const [rel, buf] of Object.entries(c.binFiles ?? {})) {
      const p = join(world.root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, buf);
    }
    for (const [rel, mode] of Object.entries(c.chmod ?? {})) chmodSync(join(world.root, rel), mode);
    const env = baseEnv(world, c.env ?? {});
    const argv = c.argv.map(subst);
    const res = await runToEnd(impl, argv, world, env);

    for (const [rel] of Object.entries(c.chmod ?? {})) chmodSync(join(world.root, rel), 0o755);

    let generatedToken = null;
    const outRel = c.outdirOverride ?? "out";
    const outDir = c.tempOut ? null : resolve(world.cwd, outRel);
    const written = {};
    if (c.ide) {
      const p = join(world.root, c.ide.base, c.ide.file);
      if (existsSync(p) && statSync(p).isFile()) written[`${c.ide.base}/${c.ide.file}`] = normalizeIdeConfig(readFileSync(p, "utf8"));
    }
    if (c.deploy) {
      let dir = outDir;
      if (c.tempOut) {
        const m = /written to (\S+)/.exec(res.stdout);
        dir = m ? m[1] : null;
      }
      if (dir && existsSync(dir) && statSync(dir).isDirectory()) {
        const files = walkFiles(dir);
        for (const [name, content] of Object.entries(files)) written[`artifact/${name}`] = content;
        const m = /ABX_MCP_AUTH_TOKEN: (\S+)/.exec(files["config.yaml"] ?? "");
        if (c.generated && m) generatedToken = m[1].replace(/^['"]|['"]$/g, "");
        if (c.tempOut && dir.startsWith(world.root)) rmSync(dir, { recursive: true, force: true });
      }
    }
    for (const rel of c.post ?? []) {
      const p = join(world.root, rel);
      written[rel] = existsSync(p) ? readFileSync(p, "utf8") : "<absent>";
    }
    const extra = [];
    if (needsLivePid) extra.push([new RegExp(String(pidHolder.pid), "g"), "<LIVEPID>"]);
    if (generatedToken) {
      extra.push([new RegExp(generatedToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<TOKEN>"]);
      extra.push([new RegExp(generatedToken.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.\\.\\.", "g"), "<TOKEN8>..."]);
    }
    const norm = makeNormalizer(world, extra);
    for (const k of Object.keys(written)) written[k] = norm(written[k]);
    return { code: res.code, stdout: norm(res.stdout), stderr: norm(res.stderr), files: written };
  } finally {
    if (sleeper) sleeper.kill("SIGKILL");
    try {
      for (const d of ["home/.cursor", "cwd/ro"]) chmodSync(join(world.root, d), 0o755);
    } catch {
      /* ignore */
    }
    rmSync(world.root, { recursive: true, force: true });
  }
}

function showDiff(name, a, b) {
  const lines = [`\n=== DIFF: ${name}`];
  for (const key of ["code", "stdout", "stderr"]) {
    if (a[key] !== b[key]) {
      lines.push(`--- ${key} (python)`, String(a[key]), `+++ ${key} (node)`, String(b[key]));
    }
  }
  const names = new Set([...Object.keys(a.files ?? {}), ...Object.keys(b.files ?? {})]);
  for (const n of names) {
    if ((a.files ?? {})[n] !== (b.files ?? {})[n]) {
      lines.push(`--- file ${n} (python)`, String((a.files ?? {})[n]), `+++ file ${n} (node)`, String((b.files ?? {})[n]));
    }
  }
  return lines.join("\n");
}

function same(a, b) {
  return a.code === b.code && a.stdout === b.stdout && a.stderr === b.stderr && JSON.stringify(a.files ?? {}) === JSON.stringify(b.files ?? {});
}

let failures = 0;
let total = 0;

const knownByName = new Map(STATIC_CASES.filter((c) => c.known).map((c) => [c.name, c.known]));

function report(name, a, b) {
  total++;
  if (!same(a, b) && knownByName.has(name)) {
    console.log(`known ${name}: ${knownByName.get(name)}`);
    return;
  }
  if (same(a, b)) {
    if (verbose) console.log(`ok   ${name}`);
  } else {
    failures++;
    console.log(showDiff(name, a, b));
  }
}

const selected = (name) => !only || name.includes(only);

for (const c of STATIC_CASES) {
  if (!selected(c.name)) continue;
  const py = await runStaticCase("python", c);
  const nd = await runStaticCase("node", c);
  report(c.name, py, nd);
}

// ---------------------------------------------------------------------------------------------------------------------
// Process-level cases
// ---------------------------------------------------------------------------------------------------------------------

import { createServer } from "node:http";

async function stubPlatform(handler) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => handler(req, res, Buffer.concat(chunks).toString("utf8")));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function jsonrpcSession(impl, name, fn) {
  if (!selected(name)) return;
  const results = {};
  for (const which of ["python", "node"]) {
    const world = makeWorld();
    const stub = await stubPlatform((req, res, body) => {
      stub.requests.push(`${req.method} ${req.url} ${body}`);
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"message":"unavailable"}');
    });
    stub.requests = [];
    try {
      results[which] = await fn(which, world, stub);
      results[which].files = {};
      const norm = makeNormalizer(world, [[new RegExp(String(stub.port), "g"), "<PORT>"]]);
      results[which].stdout = norm(results[which].stdout);
      results[which].stderr = norm(results[which].stderr);
      results[which].files.requests = norm(stub.requests.join("\n"));
      for (const [k, v] of Object.entries(results[which].extra ?? {})) results[which].files[k] = norm(v);
    } finally {
      await stub.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  }
  report(name, results.python, results.node);
}

const RPC = (id, method, params) => JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

// STDIO: initialize, tools/list, a failing tool call (against the stub), then EOF.
const stdioScript = [
  RPC(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "d", version: "0" } }),
  RPC(2, "tools/list", {}),
  RPC(3, "tools/call", { name: "run_code", arguments: { code: "print(1)" } }),
  RPC(4, "ping", {}),
  RPC(5, "nope", {}),
];
// A burst containing a malformed line is answered in a different order by uvicorn-less asyncio (parse error first)
// than by the Node reader; clients that wait for answers see no difference. Reported as a gap of agent/mcp.ts.
const stdioSteps = [[stdioScript.join(""), /"id": 3,/], ["not json\n", /Parse error/]];

for (const [label, extraArgs, extraEnv] of [
  ["default template", [], {}],
  ["--template python-hello --domain d.example", ["--template", "python-hello", "--domain", "d.example"], {}],
  ["--quiet", [], { __quiet: true }],
  ["env key", [], { E2B_API_KEY: "envkey" }],
]) {
  await jsonrpcSession(null, `start stdio over stdin script (${label})`, async (which, world, stub) => {
    const { __quiet, ...env } = extraEnv;
    const argv = [...(__quiet ? ["--quiet"] : []), "mcp", "start", ...(env.E2B_API_KEY ? [] : ["--api-key", "stdio-secret-key"]), "--api-url", `http://127.0.0.1:${stub.port}`, ...extraArgs];
    const res = await runToEnd(which, argv, world, baseEnv(world, env), { stdin: stdioSteps });
    const state = existsSync(join(world.run, "mcp-server.json")) ? "state file left behind" : "state file removed";
    // The failing tool call logs `ERROR: Tool run_code failed: <exc>` plus a traceback (agent/tools, not this
    // module): the exception text and the traceback frames legitimately differ, so the log tail is cut off.
    return { ...res, stderr: res.stderr.replace(/^ERROR: Tool [\s\S]*$/m, "ERROR: Tool <failure log elided>\n"), extra: { state } };
  });
}

// STDIO: signal handling (the process waits on stdin; SIGTERM from `abx mcp stop`, SIGINT from Ctrl-C).
for (const signal of ["SIGTERM", "SIGINT"]) {
  await jsonrpcSession(null, `start stdio killed by ${signal}`, async (which, world, stub) => {
    const env = baseEnv(world, {});
    const proc = spawnImpl(which, ["mcp", "start", "--api-key", "k", "--api-url", `http://127.0.0.1:${stub.port}`], world, env);
    const { out, done } = collect(proc);
    const stateFile = join(world.run, "mcp-server.json");
    const upfront = await waitFor(() => existsSync(stateFile) && /Waiting for JSON-RPC/.test(out.stderr), 20000);
    if (!upfront) proc.kill("SIGKILL");
    const stateDuring = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
    proc.kill(signal);
    const timer = setTimeout(() => proc.kill("SIGKILL"), 10000);
    const { code, signal: sig } = await done;
    clearTimeout(timer);
    return {
      code: sig ? `signal:${sig}` : code,
      stdout: out.stdout,
      stderr: out.stderr,
      extra: { stateDuring: JSON.stringify({ ...stateDuring, pid: typeof stateDuring?.pid }), stateAfter: existsSync(stateFile) ? "left behind" : "removed" },
    };
  });
}

// `abx mcp stop` against a live STDIO server.
await jsonrpcSession(null, "start stdio + mcp stop + mcp status", async (which, world, stub) => {
  const env = baseEnv(world, {});
  const proc = spawnImpl(which, ["mcp", "start", "--api-key", "k", "--api-url", `http://127.0.0.1:${stub.port}`], world, env);
  const { out, done } = collect(proc);
  await waitFor(() => /Waiting for JSON-RPC/.test(out.stderr), 20000);
  const status = await runToEnd(which, ["--json", "mcp", "status"], world, env);
  const stop = await runToEnd(which, ["mcp", "stop"], world, env);
  const { code, signal } = await done;
  const stop2 = await runToEnd(which, ["mcp", "stop"], world, env);
  const statusAfter = await runToEnd(which, ["--json", "mcp", "status"], world, env);
  const norm = (s) => s.replace(/\(pid \d+,/g, "(pid N,").replace(/"mcp_running": (true|false)/g, '"mcp_running": $1');
  return {
    code: `${signal ? "signal:" + signal : code}|stop:${stop.code}|stop2:${stop2.code}`,
    stdout: [status.stdout, stop.stdout, stop2.stdout, statusAfter.stdout].map(norm).join("\n--\n") + out.stdout,
    stderr: [stop.stderr, stop2.stderr, out.stderr].map(norm).join("\n--\n"),
  };
});

// A second `start` while one is running is refused and must not disturb the first.
await jsonrpcSession(null, "second start refused while first runs", async (which, world, stub) => {
  const env = baseEnv(world, {});
  const first = spawnImpl(which, ["mcp", "start", "--api-key", "k", "--api-url", `http://127.0.0.1:${stub.port}`], world, env);
  const f = collect(first);
  await waitFor(() => /Waiting for JSON-RPC/.test(f.out.stderr), 20000);
  const second = await runToEnd(which, ["mcp", "start", "--http", "--port", "1"], world, env);
  const stateStill = existsSync(join(world.run, "mcp-server.json"));
  first.kill("SIGTERM");
  await f.done;
  return {
    code: `second:${second.code}`,
    stdout: second.stdout,
    stderr: second.stderr.replace(/pid \d+/g, "pid N"),
    extra: { stateStill: String(stateStill) },
  };
});

// HTTP foreground: banner, /health, auth, shutdown by SIGTERM / SIGINT.
function httpGet(port, path, headers = {}, method = "GET", body = null) {
  return new Promise((resolveR) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolveR({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", (e) => resolveR({ status: "error", body: String(e.code) }));
    if (body) req.write(body);
    req.end();
  });
}

const normHttpErr = (s) =>
  s
    .replace(new RegExp(CONFIG_WARNING.source, "gm"), "")
    .replace(/\d+\.\d+\.\d+\.\d+:\d+ - "/g, "<CLIENT> - \"")
    .replace(/Started server process \[\d+\]/g, "Started server process [PID]")
    .replace(/Finished server process \[\d+\]/g, "Finished server process [PID]");

for (const [label, args, env, signal] of [
  ["no auth, SIGTERM", [], {}, "SIGTERM"],
  ["no auth, SIGINT", [], {}, "SIGINT"],
  ["auth token flag, SIGTERM", ["--auth-token", "sekret"], {}, "SIGTERM"],
  ["auth token env, SIGTERM", [], { ABX_MCP_AUTH_TOKEN: "envsekret" }, "SIGTERM"],
  ["quiet, SIGTERM", ["--quiet-root"], {}, "SIGTERM"],
]) {
  await jsonrpcSession(null, `start http foreground (${label})`, async (which, world, stub) => {
    const port = await freePort();
    const quiet = args.includes("--quiet-root");
    const cleanArgs = args.filter((a) => a !== "--quiet-root");
    const argv = [...(quiet ? ["--quiet"] : []), "mcp", "start", "--http", "--port", String(port), "--api-key", "k", "--api-url", `http://127.0.0.1:${stub.port}`, "--template", "tpl", ...cleanArgs];
    const proc = spawnImpl(which, argv, world, baseEnv(world, env));
    const { out, done } = collect(proc);
    const up = await waitFor(async () => (await httpGet(port, "/health")).status === 200, 20000);
    const probes = [];
    if (up) {
      probes.push(["health", await httpGet(port, "/health")]);
      probes.push(["mcp GET", await httpGet(port, "/mcp")]);
      probes.push(["mcp POST noauth", await httpGet(port, "/mcp", { "content-type": "application/json" }, "POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }))]);
      const tok = args.includes("--auth-token") ? "sekret" : env.ABX_MCP_AUTH_TOKEN;
      if (tok) {
        probes.push(["mcp POST auth", await httpGet(port, "/mcp", { "content-type": "application/json", authorization: `Bearer ${tok}` }, "POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }))]);
      }
      probes.push(["unknown", await httpGet(port, "/nope")]);
    }
    const stateFile = join(world.run, "mcp-server.json");
    const stateDuring = existsSync(stateFile) ? readFileSync(stateFile, "utf8") : "<absent>";
    proc.kill(signal);
    const timer = setTimeout(() => proc.kill("SIGKILL"), 10000);
    const { code, signal: sig } = await done;
    clearTimeout(timer);
    const norm = (s) => normHttpErr(s).replace(new RegExp(String(port), "g"), "<HPORT>");
    return {
      code: sig ? `signal:${sig}` : code,
      stdout: norm(out.stdout),
      stderr: norm(out.stderr),
      extra: {
        probes: JSON.stringify(probes.map(([n, r]) => [n, r.status, r.body.replace(/mcp-session-id[^,]*/gi, "")])),
        stateDuring: norm(stateDuring.replace(/"pid": \d+/, '"pid": N')),
        stateAfter: existsSync(stateFile) ? "left behind" : "removed",
      },
    };
  });
}

// HTTP: port already in use.
await jsonrpcSession(null, "start http: port in use", async (which, world, stub) => {
  const port = await freePort();
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(port, "127.0.0.1", r));
  try {
    const res = await runToEnd(which, ["mcp", "start", "--http", "--port", String(port), "--api-key", "k"], world, baseEnv(world, {}), { timeoutMs: 20000 });
    const norm = (s) => normHttpErr(s).replace(new RegExp(String(port), "g"), "<HPORT>");
    return { ...res, stderr: norm(res.stderr), extra: { stateAfter: existsSync(join(world.run, "mcp-server.json")) ? "left behind" : "removed" } };
  } finally {
    blocker.close();
  }
});

// HTTP: bad host.
await jsonrpcSession(null, "start http: unresolvable host", async (which, world) => {
  const res = await runToEnd(which, ["mcp", "start", "--http", "--host", "nonexistent.invalid", "--auth-token", "t", "--port", "9"], world, baseEnv(world, {}), { timeoutMs: 20000 });
  return { ...res, stderr: normHttpErr(res.stderr), extra: { stateAfter: existsSync(join(world.run, "mcp-server.json")) ? "left behind" : "removed" } };
});

// Background HTTP server: start -> status -> health -> stop.
for (const [label, extraArgs, env] of [
  ["no token", [], {}],
  ["token + key via env", [], { ABX_MCP_AUTH_TOKEN: "bg-token", E2B_API_KEY: "bgkey" }],
  ["domain + url args", ["--domain", "d.example"], {}],
]) {
  await jsonrpcSession(null, `start --background (${label})`, async (which, world, stub) => {
    const port = await freePort();
    const e = baseEnv(world, env);
    const start = await runToEnd(which, ["mcp", "start", "--background", "--port", String(port), "--api-url", `http://127.0.0.1:${stub.port}`, ...extraArgs], world, e, { timeoutMs: 40000 });
    const stateFile = join(world.run, "mcp-server.json");
    const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
    const health = await httpGet(port, "/health");
    const status = await runToEnd(which, ["--json", "mcp", "status"], world, e);
    const second = await runToEnd(which, ["mcp", "start", "--background", "--port", String(port)], world, e, { timeoutMs: 20000 });
    const stop = await runToEnd(which, ["mcp", "stop"], world, e);
    const down = await waitFor(async () => (await httpGet(port, "/health")).status === "error", 5000);
    const log = existsSync(join(world.run, "mcp-server.log")) ? readFileSync(join(world.run, "mcp-server.log"), "utf8") : "<no log>";
    const norm = (s) => normHttpErr(s).replace(new RegExp(String(port), "g"), "<HPORT>").replace(/pid:\s+\d+/g, "pid:      N").replace(/\(pid \d+,/g, "(pid N,").replace(/pid \d+/g, "pid N");
    return {
      code: `start:${start.code}|second:${second.code}|stop:${stop.code}`,
      stdout: [start.stdout, status.stdout, second.stdout, stop.stdout].map(norm).join("\n--\n"),
      stderr: [start.stderr, second.stderr, stop.stderr].map(norm).join("\n--\n"),
      extra: {
        health: `${health.status} ${health.body}`,
        state: norm(JSON.stringify({ ...state, pid: typeof state?.pid, log: String(state?.log).replace(world.root, "<T>") })),
        down: String(Boolean(down)),
        stateAfter: existsSync(stateFile) ? "left behind" : "removed",
        log: norm(log).split("\n").filter((l) => !/^(INFO|WARNING|ERROR):/.test(l)).join("\n"),
        logInfo: norm(log).split("\n").filter((l) => /^INFO:/.test(l)).join("\n"),
      },
    };
  });
}

// Background server that dies immediately (port taken): the log tail is reported.
await jsonrpcSession(null, "start --background: child exits early", async (which, world) => {
  const port = await freePort();
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(port, "127.0.0.1", r));
  try {
    const res = await runToEnd(which, ["mcp", "start", "--background", "--port", String(port)], world, baseEnv(world, {}), { timeoutMs: 40000 });
    const norm = (s) => normHttpErr(s).replace(new RegExp(String(port), "g"), "<HPORT>");
    // Claiming the pid file and dying on the bind error are a few milliseconds apart, so which of the two the
    // 0.1 s readiness poll sees first is a race in Python as well: compare the outcome class and the child's log.
    const logFile = join(world.run, "mcp-server.log");
    await new Promise((r) => setTimeout(r, 1500));
    const log = existsSync(logFile) ? norm(readFileSync(logFile, "utf8")) : "<no log>";
    const raced = res.stderr.includes("exited before it was ready") || res.stderr.includes("running in the background");
    return {
      code: raced ? "exited-or-ready" : res.code,
      stdout: res.stdout,
      stderr: raced ? "" : res.stderr,
      extra: { log: log.split("\n").filter((l) => !/^(INFO|WARNING):/.test(l)).join("\n").replace(new RegExp(CONFIG_WARNING.source, "gm"), ""), stateAfter: existsSync(join(world.run, "mcp-server.json")) ? "left behind" : "removed" },
    };
  } finally {
    blocker.close();
  }
});

console.log(`\n${total} cases, ${failures} differing`);
process.exit(failures ? 1 : 0);

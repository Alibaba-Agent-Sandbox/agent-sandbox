#!/usr/bin/env node
/**
 * Differential test of the `ebx config` command group (get / set / delete / list / init, shortcuts, credential
 * storage): the original Python CLI (`$ORACLE_VENV/bin/ebx`) versus the Node CLI (`src/bin/ebx.ts`).
 *
 *   ORACLE_VENV=/path/to/venv-for-original-ebx node parity/diff/config_cmds.mjs [--only <substring>] [--verbose] [--jobs N]
 *
 * Every case runs one or more argv steps in a fresh isolated HOME / cwd with a scrubbed environment (no real
 * credentials, EBX_NO_KEYCHAIN=1, no network). Compared per step: exit code, stdout and stderr (temp dir
 * normalised); after the steps: `~/.ebx/config.toml`, `~/.ebx/.env` (bytes and file mode), `./.env`, and every
 * extra file the case lists in `post`. Interactive wizard cases are driven through a Python `pty` harness (skipped
 * when python3/pty is unavailable) so both implementations see a real terminal.
 *
 * Exit code 0 = identical, 1 = differences, 2 = oracle missing.
 */

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const verbose = process.argv.includes("--verbose");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const jobsIdx = process.argv.indexOf("--jobs");
const JOBS = jobsIdx >= 0 ? Number(process.argv[jobsIdx + 1]) : 6;

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "ebx"))) {
  console.error("ORACLE_VENV must point to a venv with the original easy-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

const TSX_LOADER = import.meta.resolve("tsx");
const NODE_ENTRY = join(CLI_ROOT, "src", "bin", "ebx.ts");
const IMPLS = {
  python: { cmd: join(ORACLE_VENV, "bin", "ebx"), args: [] },
  node: { cmd: process.execPath, args: ["--import", TSX_LOADER, NODE_ENTRY] },
};
const HAVE_PTY = process.platform !== "win32" && spawnSync("python3", ["-c", "import pty"]).status === 0;

const BASE_ENV_KEYS = ["PATH", "LANG", "LC_ALL"];

function makeWorld() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ebx-cfgdiff-")));
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  for (const d of [home, cwd, join(root, "tmp")]) mkdirSync(d, { recursive: true });
  return { root, home, cwd };
}

function baseEnv(world, extra = {}) {
  const env = {};
  for (const k of BASE_ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
  Object.assign(env, { HOME: world.home, USERPROFILE: world.home, EBX_NO_KEYCHAIN: "1", PYTHONUNBUFFERED: "1", NO_COLOR: "1", TMPDIR: join(world.root, "tmp") });
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  return env;
}

function runPlain(impl, argv, world, env, stdin) {
  return new Promise((resolveRun) => {
    const { cmd, args } = IMPLS[impl];
    const proc = spawn(cmd, [...args, ...argv], { cwd: world.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8").on("data", (c) => (stdout += c));
    proc.stderr.setEncoding("utf8").on("data", (c) => (stderr += c));
    proc.stdin.on("error", () => {});
    proc.stdin.end(stdin ?? "");
    const timer = setTimeout(() => proc.kill("SIGKILL"), 40000);
    proc.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code: signal ? `signal:${signal}` : code, stdout, stderr });
    });
  });
}

const PTY_DRIVER = `
import os, pty, select, sys, json, time
spec = json.loads(sys.argv[1])
argv = spec["argv"]
inputs = spec["inputs"]
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(argv[0], argv, os.environ)
out = b""
queue = list(inputs)
deadline = time.time() + 40
last = time.time()
fresh = False
while True:
    if time.time() > deadline:
        os.kill(pid, 9); break
    r, _, _ = select.select([fd], [], [], 0.25)
    if r:
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        out += data
        last = time.time()
        fresh = True
    elif queue and fresh and time.time() - last > 0.3 and (queue[0].startswith("\\x00") or out.endswith(b": ")):
        chunk = queue.pop(0).lstrip("\\x00")
        os.write(fd, chunk.encode("utf-8"))
        last = time.time()
        fresh = False
_, status = os.waitpid(pid, 0)
code = os.waitstatus_to_exitcode(status)
sys.stdout.write(json.dumps({"code": code, "out": out.decode("utf-8", "replace")}))
`;

function runPty(impl, argv, world, env, inputs) {
  return new Promise((resolveRun) => {
    const { cmd, args } = IMPLS[impl];
    const spec = JSON.stringify({ argv: [cmd, ...args, ...argv], inputs });
    const proc = spawn("python3", ["-c", PTY_DRIVER, spec], { cwd: world.cwd, env: { ...env, TERM: "dumb" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8").on("data", (c) => (stdout += c));
    proc.stderr.setEncoding("utf8").on("data", (c) => (stderr += c));
    proc.once("close", () => {
      try {
        const r = JSON.parse(stdout);
        resolveRun({ code: r.code, stdout: r.out.replace(/\r\n/g, "\n"), stderr: "" });
      } catch {
        resolveRun({ code: "pty-harness-failed", stdout, stderr });
      }
    });
  });
}

function readIfFile(p, mode = false) {
  if (!existsSync(p)) return "<absent>";
  const st = statSync(p);
  if (!st.isFile()) return "<not a file>";
  const body = readFileSync(p).toString("latin1");
  return mode ? `[mode ${(st.mode & 0o777).toString(8)}]\n${body}` : body;
}

async function runCase(impl, c) {
  const world = makeWorld();
  try {
    for (const d of c.dirs ?? []) mkdirSync(join(world.root, d), { recursive: true });
    for (const [rel, target] of Object.entries(c.symlinks ?? {})) {
      mkdirSync(dirname(join(world.root, rel)), { recursive: true });
      symlinkSync(target.startsWith("/") ? target : join(world.root, target), join(world.root, rel));
    }
    for (const [rel, content] of Object.entries(c.files ?? {})) {
      const p = join(world.root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    for (const [rel, buf] of Object.entries(c.binFiles ?? {})) {
      const p = join(world.root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, buf);
    }
    for (const [rel, mode] of Object.entries(c.chmod ?? {})) chmodSync(join(world.root, rel), mode);
    const steps = c.steps ?? [{ argv: c.argv, stdin: c.stdin, env: c.env, pty: c.pty }];
    const results = [];
    for (const s of steps) {
      const env = baseEnv(world, { ...(c.env ?? {}), ...(s.env ?? {}) });
      const res = s.pty ? await runPty(impl, s.argv, world, env, s.pty) : await runPlain(impl, s.argv, world, env, s.stdin);
      results.push(res);
    }
    for (const [rel] of Object.entries(c.chmod ?? {})) {
      try {
        chmodSync(join(world.root, rel), 0o755);
      } catch {
        /* removed by the command */
      }
    }
    const files = {
      ".ebx/config.toml": readIfFile(join(world.home, ".ebx", "config.toml")),
      ".ebx/.env": readIfFile(join(world.home, ".ebx", ".env"), true),
      "cwd/.env": readIfFile(join(world.cwd, ".env")),
    };
    for (const rel of c.post ?? []) files[rel] = readIfFile(join(world.root, rel));
    const norm = (t) => String(t).split(world.root).join("<T>");
    for (const k of Object.keys(files)) files[k] = norm(files[k]);
    return {
      steps: results.map((r) => ({ code: r.code, stdout: norm(r.stdout), stderr: norm(r.stderr) })),
      files,
    };
  } finally {
    try {
      chmodSync(join(world.home, ".ebx"), 0o755);
    } catch {
      /* ignore */
    }
    rmSync(world.root, { recursive: true, force: true });
  }
}

function showDiff(name, a, b) {
  const lines = [`\n=== DIFF: ${name}`];
  const n = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < n; i++) {
    for (const key of ["code", "stdout", "stderr"]) {
      const x = a.steps[i]?.[key];
      const y = b.steps[i]?.[key];
      if (x !== y) lines.push(`--- step ${i} ${key} (python)`, JSON.stringify(x), `+++ step ${i} ${key} (node)`, JSON.stringify(y));
    }
  }
  for (const f of new Set([...Object.keys(a.files), ...Object.keys(b.files)])) {
    if (a.files[f] !== b.files[f]) lines.push(`--- file ${f} (python)`, JSON.stringify(a.files[f]), `+++ file ${f} (node)`, JSON.stringify(b.files[f]));
  }
  return lines.join("\n");
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------------------------------

const CASES = [];
const add = (name, spec) => CASES.push({ name, ...spec });
const cfg = (...argv) => ({ argv: ["config", ...argv] });

const ALL_KEYS = [
  "sandbox_api_key", "access_key_id", "access_key_secret", "acr_namespace", "api_url", "region", "http_timeout", "http2",
  "max_retries", "domain", "llm_api_key", "llm_model", "llm_base_url", "github_token",
];

// --- help ------------------------------------------------------------------------------------------------------------
for (const sub of [[], ["get"], ["set"], ["delete"], ["list"], ["init"]]) {
  add(`help: config ${sub.join(" ")} --help`, cfg(...sub, "--help"));
  add(`help: config ${sub.join(" ")} -h`, cfg(...sub, "-h"));
}
add("help: bare config", cfg());
add("help: unknown subcommand", cfg("bogus"));
add("help: get no key", cfg("get"));
add("help: get two keys", cfg("get", "a", "b"));
add("help: set no key", cfg("set"));
add("help: set three args", cfg("set", "a", "b", "c"));
add("help: list extra arg", cfg("list", "x"));
add("help: init unknown option", cfg("init", "--bogus"));
add("help: delete no key", cfg("delete"));
add("help: json config --help", { argv: ["--json", "config", "--help"] });

// --- get -------------------------------------------------------------------------------------------------------------
for (const k of ALL_KEYS) {
  add(`get ${k}: empty`, cfg("get", k));
  add(`get ${k}: json`, { argv: ["--json", "config", "get", k] });
  add(`get ${k}: quiet`, { argv: ["--quiet", "config", "get", k] });
}
add("get api_key alias", cfg("get", "api_key"));
add("get removed key", cfg("get", "qwen_code_api_key"));
add("get removed key base url", cfg("get", "qwen_code_base_url"));
add("get removed key model", cfg("get", "qwen_code_model"));
add("get unknown key", cfg("get", "bogus"));
add("get unknown key close", cfg("get", "regon"));
add("get unknown key json", { argv: ["--json", "config", "get", "bogus"] });
add("get empty key", cfg("get", ""));
add("get upper key", cfg("get", "REGION"));
add("get shortcuts: no config", cfg("get", "shortcuts"));
add("get shortcuts.list: no config", cfg("get", "shortcuts.list"));
add("get shortcuts.unknown", cfg("get", "shortcuts.nope"));
add("get shortcuts. empty alias", cfg("get", "shortcuts."));
add("get shortcuts json", { argv: ["--json", "config", "get", "shortcuts"] });
add("get shortcuts.x json", { argv: ["--json", "config", "get", "shortcuts.list"] });

const TOML_FULL = `[transport]
region = "cn-shanghai"
http_timeout = 12.5
http2 = false
max_retries = 7
api_url = "https://example.invalid/api"
domain = "d.example"
llm_api_key = "legacy-secret-1234"
qwen_code_base_url = "https://legacy.example/v1"
qwen_code_model = "legacy-model"

[shortcuts]
ps = "sandbox process list"
ls = "sandbox list"
`;
add("get region from toml", { ...cfg("get", "region"), files: { "home/.ebx/config.toml": TOML_FULL } });
for (const k of ["http_timeout", "http2", "max_retries", "api_url", "domain", "llm_api_key", "llm_base_url", "llm_model"]) {
  add(`get ${k} from toml`, { ...cfg("get", k), files: { "home/.ebx/config.toml": TOML_FULL } });
  add(`get ${k} from toml json`, { argv: ["--json", "config", "get", k], files: { "home/.ebx/config.toml": TOML_FULL } });
}
add("get shortcuts from toml", { ...cfg("get", "shortcuts"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("get shortcuts from toml json", { argv: ["--json", "config", "get", "shortcuts"], files: { "home/.ebx/config.toml": TOML_FULL } });
add("get shortcuts.ps", { ...cfg("get", "shortcuts.ps"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("get shortcuts.ps json", { argv: ["--json", "config", "get", "shortcuts.ps"], files: { "home/.ebx/config.toml": TOML_FULL } });
add("get shortcuts.nope w/ config", { ...cfg("get", "shortcuts.nope"), files: { "home/.ebx/config.toml": TOML_FULL } });

const ENV_FILE = `E2B_API_KEY=e2b-secret-abcdef\nALICLOUD_ACCESS_KEY_ID=LTAIexample1234\nALICLOUD_ACCESS_KEY_SECRET=aksecret-1234567\nACR_NAMESPACE=my-ns\nEBX_LLM_API_KEY=sk-llm-0123456789\nGITHUB_TOKEN=ghp_abcdefghij1234\n`;
for (const k of ["sandbox_api_key", "api_key", "access_key_id", "access_key_secret", "acr_namespace", "llm_api_key", "github_token"]) {
  add(`get ${k} from ~/.ebx/.env`, { ...cfg("get", k), files: { "home/.ebx/.env": ENV_FILE } });
  add(`get ${k} from ~/.ebx/.env json`, { argv: ["--json", "config", "get", k], files: { "home/.ebx/.env": ENV_FILE } });
}
add("get sandbox_api_key from ./.env", { ...cfg("get", "sandbox_api_key"), files: { "cwd/.env": "E2B_API_KEY=cwd-secret-abcdef\n" } });
add("get ./.env beats ~/.ebx/.env", { ...cfg("get", "sandbox_api_key"), files: { "cwd/.env": "E2B_API_KEY=cwd-secret-abcdef\n", "home/.ebx/.env": ENV_FILE } });
add("get ./.env quoted + export", { ...cfg("get", "region"), files: { "cwd/.env": "export SANDBOX_REGION='cn-beijing'\n" } });
add("get env wins over files", { ...cfg("get", "sandbox_api_key"), env: { E2B_API_KEY: "env-secret-abcdefgh" }, files: { "cwd/.env": "E2B_API_KEY=cwd\n", "home/.ebx/.env": ENV_FILE } });
add("get env SANDBOX_API_KEY fallback", { ...cfg("get", "sandbox_api_key"), env: { SANDBOX_API_KEY: "env-secret-abcdefgh" } });
add("get env E2B beats SANDBOX", { ...cfg("get", "sandbox_api_key"), env: { E2B_API_KEY: "aaaaaaaaaaaa", SANDBOX_API_KEY: "bbbbbbbbbbbb" } });
add("get env blank value ignored", { ...cfg("get", "sandbox_api_key"), env: { E2B_API_KEY: "   ", SANDBOX_API_KEY: "bbbbbbbbbbbb" } });
add("get env region", { ...cfg("get", "region"), env: { SANDBOX_REGION: "cn-env" } });
add("get env http_timeout", { ...cfg("get", "http_timeout"), env: { SANDBOX_HTTP_TIMEOUT: "99" } });
add("get env http_timeout bad", { ...cfg("get", "http_timeout"), env: { SANDBOX_HTTP_TIMEOUT: "abc" } });
add("get env api_url", { ...cfg("get", "api_url"), env: { E2B_API_URL: "http://env.example" } });
add("get env api_url fallback", { ...cfg("get", "api_url"), env: { SANDBOX_API_BASE_URL: "http://env2.example" } });
add("get env domain", { ...cfg("get", "domain"), env: { E2B_DOMAIN: "env.domain" } });
for (const [k, e] of [
  ["access_key_id", "AccessKey"], ["access_key_secret", "AccessSecret"], ["llm_api_key", "DASHSCOPE_API_KEY"], ["llm_api_key", "OPENAI_API_KEY"],
  ["llm_api_key", "BAILIAN_CODING_PLAN_API_KEY"], ["llm_api_key", "EBX_QWEN_CODE_API_KEY"], ["llm_base_url", "OPENAI_BASE_URL"],
  ["llm_model", "OPENAI_MODEL"], ["llm_model", "EBX_LLM_MODEL"], ["llm_base_url", "EBX_LLM_BASE_URL"], ["github_token", "GITHUB_TOKEN"],
  ["acr_namespace", "ACR_NAMESPACE"],
]) {
  add(`get ${k} env ${e}`, { ...cfg("get", k), env: { [e]: "env-value-0123456789" } });
}
add("get llm_api_key legacy env file", { ...cfg("get", "llm_api_key"), files: { "home/.ebx/.env": "EBX_QWEN_CODE_API_KEY=legacy-key-1234567\n" } });
add("get llm_api_key unified wins over legacy", { ...cfg("get", "llm_api_key"), files: { "home/.ebx/.env": "EBX_QWEN_CODE_API_KEY=legacy-key-1234567\nEBX_LLM_API_KEY=new-key-7654321\n" } });
add("get llm_api_key legacy toml", { ...cfg("get", "llm_api_key"), files: { "home/.ebx/config.toml": '[transport]\nllm_api_key = "toml-key-123456"\n' } });
add("get llm_api_key env-file beats legacy toml", { ...cfg("get", "llm_api_key"), files: { "home/.ebx/config.toml": '[transport]\nllm_api_key = "toml-key-123456"\n', "home/.ebx/.env": "EBX_LLM_API_KEY=file-key-7654321\n" } });
add("get llm_model unified beats legacy", { ...cfg("get", "llm_model"), files: { "home/.ebx/config.toml": '[transport]\nllm_model = "new"\nqwen_code_model = "old"\n' } });
add("get llm_base_url legacy only", { ...cfg("get", "llm_base_url"), files: { "home/.ebx/config.toml": '[transport]\nqwen_code_base_url = "http://old"\n' } });
add("get short secret masked", { ...cfg("get", "sandbox_api_key"), env: { E2B_API_KEY: "abc" } });
add("get 8-char secret masked", { ...cfg("get", "sandbox_api_key"), env: { E2B_API_KEY: "abcdefgh" } });
add("get 9-char secret masked", { ...cfg("get", "sandbox_api_key"), env: { E2B_API_KEY: "abcdefghi" } });
add("get unicode secret masked", { ...cfg("get", "sandbox_api_key"), env: { E2B_API_KEY: "ключ-секрет-абвгд" } });
add("get region toml non-string", { ...cfg("get", "region"), files: { "home/.ebx/config.toml": "[transport]\nregion = 5\n" } });
add("get region toml empty string", { ...cfg("get", "region"), files: { "home/.ebx/config.toml": '[transport]\nregion = ""\n' } });
add("get http2 toml string", { ...cfg("get", "http2"), files: { "home/.ebx/config.toml": '[transport]\nhttp2 = "false"\n' } });
add("get http_timeout toml int", { ...cfg("get", "http_timeout"), files: { "home/.ebx/config.toml": "[transport]\nhttp_timeout = 5\n" } });
add("get max_retries toml float", { ...cfg("get", "max_retries"), files: { "home/.ebx/config.toml": "[transport]\nmax_retries = 2.5\n" } });
add("get max_retries toml huge", { ...cfg("get", "max_retries"), files: { "home/.ebx/config.toml": "[transport]\nmax_retries = 123456789012345678901234567890\n" } });
add("get http_timeout toml inf", { ...cfg("get", "http_timeout"), files: { "home/.ebx/config.toml": "[transport]\nhttp_timeout = inf\n" } });
add("get http_timeout toml nan", { ...cfg("get", "http_timeout"), files: { "home/.ebx/config.toml": "[transport]\nhttp_timeout = nan\n" } });
add("get http_timeout toml 1e22", { ...cfg("get", "http_timeout"), files: { "home/.ebx/config.toml": "[transport]\nhttp_timeout = 1e22\n" } });
add("get http_timeout toml 1e-7", { ...cfg("get", "http_timeout"), files: { "home/.ebx/config.toml": "[transport]\nhttp_timeout = 1e-7\n" } });
add("get region top-level (not transport)", { ...cfg("get", "region"), files: { "home/.ebx/config.toml": 'region = "top"\n' } });

// corrupted / odd config files
const BAD_FILES = {
  "syntax error": "[transport\nregion = 1\n",
  "bad value": "[transport]\nregion = \n",
  "dup key": '[transport]\nregion = "a"\nregion = "b"\n',
  "dup table": "[transport]\n[transport]\n",
  "transport not table": 'transport = "x"\n',
  "shortcuts not table": 'shortcuts = "x"\n',
  "shortcuts non-string": "[shortcuts]\nps = 5\nok = \"sandbox list\"\n",
  "unterminated string": '[transport]\nregion = "abc\n',
  "bad escape": '[transport]\nregion = "a\\qb"\n',
  "bad date": "[transport]\nd = 2024-13-45\n",
  empty: "",
  "bom": '\ufeff[transport]\nregion = "bom"\n',
  "crlf": '[transport]\r\nregion = "crlf"\r\n',
  "unicode": '[transport]\nregion = "ünï☃"\n',
  "inline table": '[transport]\nregion = { a = 1 }\n',
  "array value": '[transport]\nregion = [1, 2]\n',
};
for (const [label, body] of Object.entries(BAD_FILES)) {
  add(`corrupt toml (${label}): get region`, { ...cfg("get", "region"), files: { "home/.ebx/config.toml": body } });
  add(`corrupt toml (${label}): list`, { ...cfg("list"), files: { "home/.ebx/config.toml": body } });
  add(`corrupt toml (${label}): set region`, { ...cfg("set", "region", "x"), files: { "home/.ebx/config.toml": body } });
  add(`corrupt toml (${label}): get shortcuts`, { ...cfg("get", "shortcuts"), files: { "home/.ebx/config.toml": body } });
}
add("invalid utf-8 config: get", { ...cfg("get", "region"), binFiles: { "home/.ebx/config.toml": Buffer.from([0x5b, 0xff, 0xfe, 0x5d]) } });
add("invalid utf-8 config: set", { ...cfg("set", "region", "x"), binFiles: { "home/.ebx/config.toml": Buffer.from([0x5b, 0xff, 0xfe, 0x5d]) }, post: ["home/.ebx/config.toml"] });
add("invalid utf-8 .env: get", { ...cfg("get", "sandbox_api_key"), binFiles: { "home/.ebx/.env": Buffer.from([0x45, 0x32, 0x42, 0x3d, 0xff, 0xfe, 0x0a]) } });
add("config.toml is a directory: get", { ...cfg("get", "region"), dirs: ["home/.ebx/config.toml"] });
add("config.toml is a directory: set", { ...cfg("set", "region", "x"), dirs: ["home/.ebx/config.toml"] });
add("config.toml is a directory: list", { ...cfg("list"), dirs: ["home/.ebx/config.toml"] });
add(".ebx is a file: set", { ...cfg("set", "region", "x"), files: { "home/.ebx": "x" } });
add(".ebx is a file: get", { ...cfg("get", "region"), files: { "home/.ebx": "x" } });
add(".ebx is a file: set secret", { ...cfg("set", "sandbox_api_key", "abcdefghijk"), files: { "home/.ebx": "x" } });
add(".ebx read-only: set region", { ...cfg("set", "region", "x"), dirs: ["home/.ebx"], chmod: { "home/.ebx": 0o500 } });
add(".ebx read-only: set secret", { ...cfg("set", "sandbox_api_key", "abcdefghijk"), dirs: ["home/.ebx"], chmod: { "home/.ebx": 0o500 } });
add("config.toml unreadable: get", { ...cfg("get", "region"), files: { "home/.ebx/config.toml": "[transport]\nregion='x'\n" }, chmod: { "home/.ebx/config.toml": 0o000 } });
add(".env unreadable: get", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": ENV_FILE }, chmod: { "home/.ebx/.env": 0o000 } });
add(".env unreadable: set", { ...cfg("set", "sandbox_api_key", "abcdefghijk"), files: { "home/.ebx/.env": ENV_FILE }, chmod: { "home/.ebx/.env": 0o000 } });

// --- set -------------------------------------------------------------------------------------------------------------
for (const [k, v] of [
  ["region", "cn-beijing"], ["api_url", "https://x.example/a b"], ["domain", "d.example"], ["llm_model", "m-1"], ["llm_base_url", "http://b.example/v1"],
  ["http_timeout", "60"], ["http_timeout", "1.5"], ["http_timeout", " 3 "], ["http_timeout", "1e3"], ["http_timeout", "inf"], ["http_timeout", "nan"],
  ["http_timeout", "-4"], ["http_timeout", "1_0"], ["http_timeout", "abc"], ["http_timeout", "0x10"], ["http_timeout", "١٢"],
  ["max_retries", "5"], ["max_retries", "-1"], ["max_retries", " 4 "], ["max_retries", "2.5"], ["max_retries", "abc"], ["max_retries", "1_000"], ["max_retries", "+7"],
  ["max_retries", "99999999999999999999999"], ["max_retries", "٣"],
  ["http2", "true"], ["http2", "FALSE"], ["http2", " Yes "], ["http2", "off"], ["http2", "1"], ["http2", "0"], ["http2", "on"], ["http2", "no"], ["http2", "maybe"], ["http2", "2"],
  ["region", 'a"b\\c'], ["region", "tab\there"], ["region", "new\nline"], ["region", "uni-é-☃-😀"], ["region", "ctl\u0001x"], ["region", "del\u007fx"],
  ["region", "  padded  "], ["region", "-leading-dash"], ["region", "\u2028sep"], ["region", "x".repeat(300)],
  ["sandbox_api_key", "abcdefghijk"], ["api_key", "abcdefghijk"], ["access_key_id", "LTAI1234"], ["access_key_secret", "secret1234567"],
  ["acr_namespace", "ns-1"], ["llm_api_key", "sk-1234567890"], ["github_token", "ghp_123456789"],
  ["sandbox_api_key", "with space inside"], ["sandbox_api_key", "quo\"te'd"], ["sandbox_api_key", "dollar$HOME"], ["sandbox_api_key", "hash#tag"],
  ["sandbox_api_key", "back\\slash"], ["sandbox_api_key", "multi\nline"], ["sandbox_api_key", "  padded-secret  "], ["sandbox_api_key", "ключ-ключ-ключ"],
  ["sandbox_api_key", "a"], ["sandbox_api_key", "12345678"], ["sandbox_api_key", "123456789"], ["sandbox_api_key", "=eq=="], ["sandbox_api_key", "x\ry"],
  ["acr_namespace", "ns with space"], ["acr_namespace", "ns#hash"],
]) {
  add(`set ${k} ${JSON.stringify(v)}`, { ...cfg("set", k, v), post: [] });
  add(`set ${k} ${JSON.stringify(v)} then list/get`, {
    steps: [{ argv: ["config", "set", k, v] }, { argv: ["config", "get", k] }, { argv: ["--json", "config", "list"] }],
  });
}
add("set removed key", cfg("set", "qwen_code_api_key", "x"));
add("set removed key model", cfg("set", "qwen_code_model", "x"));
add("set unknown key", cfg("set", "bogus", "x"));
add("set unknown key json", { argv: ["--json", "config", "set", "bogus", "x"] });
add("set REGION upper", cfg("set", "REGION", "x"));
add("set json", { argv: ["--json", "config", "set", "region", "cn-x"] });
add("set quiet", { argv: ["--quiet", "config", "set", "region", "cn-x"] });
add("set json secret", { argv: ["--json", "config", "set", "sandbox_api_key", "abcdefghijk"] });
add("set quiet secret", { argv: ["--quiet", "config", "set", "sandbox_api_key", "abcdefghijk"] });
add("set json invalid number", { argv: ["--json", "config", "set", "http_timeout", "abc"] });
add("set no-color", { argv: ["--no-color", "config", "set", "region", "x"] });
add("set value missing non-tty", cfg("set", "region"));
add("set secret value missing non-tty", cfg("set", "github_token"));
add("set shortcut missing value non-tty", cfg("set", "shortcuts.x"));
add("set value missing, stdin text", { ...cfg("set", "region"), stdin: "cn-stdin\n" });
add("set value missing json", { argv: ["--json", "config", "set", "region"] });
add("set unknown key missing value", cfg("set", "bogus"));
add("set preserves other transport keys", {
  ...cfg("set", "region", "cn-new"),
  files: { "home/.ebx/config.toml": TOML_FULL },
});
add("set http_timeout preserves other keys", { ...cfg("set", "http_timeout", "7"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set llm_model drops legacy qwen_code_model", { ...cfg("set", "llm_model", "newm"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set llm_base_url drops legacy", { ...cfg("set", "llm_base_url", "http://nb"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set llm_api_key migrates legacy toml + env", {
  ...cfg("set", "llm_api_key", "sk-newnewnew123"),
  files: { "home/.ebx/config.toml": TOML_FULL, "home/.ebx/.env": "EBX_QWEN_CODE_API_KEY=old-qwen-key-1\nOTHER=1\n" },
});
add("set sandbox_api_key preserves .env others", {
  ...cfg("set", "sandbox_api_key", "newkeynewkey"),
  files: { "home/.ebx/.env": "# comment\nOTHER=1\nE2B_API_KEY=old\n\nLAST=z" },
});
add("set sandbox_api_key appends to .env w/o trailing newline", {
  ...cfg("set", "access_key_id", "AKID"),
  files: { "home/.ebx/.env": "OTHER=1" },
});
add("set secret: .env with CRLF", { ...cfg("set", "access_key_id", "AKID"), files: { "home/.ebx/.env": "OTHER=1\r\nE2B_API_KEY=old\r\n" } });
add("set secret: .env existing mode 644 -> 600", { ...cfg("set", "access_key_id", "AKID"), files: { "home/.ebx/.env": "OTHER=1\n" } });
add("set secret: env var export prefix line", { ...cfg("set", "sandbox_api_key", "newkeynewkey"), files: { "home/.ebx/.env": "export E2B_API_KEY=old\n" } });
add("set secret: duplicate lines", { ...cfg("set", "sandbox_api_key", "newkeynewkey"), files: { "home/.ebx/.env": "E2B_API_KEY=a\nE2B_API_KEY=b\n" } });
add("set secret: spaced assign", { ...cfg("set", "sandbox_api_key", "newkeynewkey"), files: { "home/.ebx/.env": "E2B_API_KEY = a\n" } });
add("set secret: env var set (not printed)", { ...cfg("set", "sandbox_api_key", "newkeynewkey"), env: { E2B_API_KEY: "shell-secret-xyz" } });
add("set preserves shortcuts section", { ...cfg("set", "region", "r"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set toml with comments and shortcuts comments", {
  ...cfg("set", "region", "r2"),
  files: { "home/.ebx/config.toml": "# top comment\n[transport]\n# c\nregion = \"a\"\n\n[shortcuts]\n# note\nps = \"sandbox list\"\n" },
});
add("set toml unknown tables preserved", {
  ...cfg("set", "region", "r2"),
  files: { "home/.ebx/config.toml": '[other]\nx = 1\ny = [1, 2]\n[other.sub]\nz = "q"\n[transport]\nregion = "a"\nextra = 3\nflt = 1.0\nlist = ["a", "b"]\n' },
});
add("set toml keys with odd names preserved", {
  ...cfg("set", "region", "r2"),
  files: { "home/.ebx/config.toml": '[transport]\n"odd key" = 1\n"é" = "v"\n1234 = "num"\nregion = "a"\n' },
});
add("set toml datetime value preserved", {
  ...cfg("set", "region", "r2"),
  files: { "home/.ebx/config.toml": "[transport]\nwhen = 2024-01-02T03:04:05Z\nregion = \"a\"\n" },
});
add("set toml nested dict preserved", {
  ...cfg("set", "region", "r2"),
  files: { "home/.ebx/config.toml": '[transport]\nregion = "a"\n[transport.nested]\nk = "v"\n' },
});
add("set toml nan/inf preserved", { ...cfg("set", "region", "r2"), files: { "home/.ebx/config.toml": "[transport]\na = nan\nb = -inf\nc = 1e300\nregion = 'a'\n" } });
add("set toml big int preserved", { ...cfg("set", "region", "r2"), files: { "home/.ebx/config.toml": "[transport]\nbig = 123456789012345678901234567890\nregion = 'a'\n" } });
add("set toml string escapes preserved", { ...cfg("set", "region", "r2"), files: { "home/.ebx/config.toml": '[transport]\ns = "tab\\there \\u00e9 \\"q\\" \\\\"\nregion = "a"\n' } });
add("set toml array of tables preserved", { ...cfg("set", "region", "r2"), files: { "home/.ebx/config.toml": '[[items]]\nn = 1\n[[items]]\nn = 2\n[transport]\nregion = "a"\n' } });
add("set toml ctl chars in value", { ...cfg("set", "region", "r2"), files: { "home/.ebx/config.toml": "[transport]\nregion = \"a\"\nx = \"\\u0001\\u007f\"\n" } });
add("set toml http_timeout stored float format", {
  steps: [{ argv: ["config", "set", "http_timeout", "1e22"] }, { argv: ["config", "get", "http_timeout"] }],
});
add("set toml http_timeout 1e-7", { steps: [{ argv: ["config", "set", "http_timeout", "1e-7"] }, { argv: ["config", "get", "http_timeout"] }] });
add("set toml http_timeout 100000000000000000000", { steps: [{ argv: ["config", "set", "http_timeout", "100000000000000000000"] }, { argv: ["config", "get", "http_timeout"] }] });
add("set toml http_timeout -0", { steps: [{ argv: ["config", "set", "http_timeout", "-0"] }, { argv: ["config", "get", "http_timeout"] }] });
add("set toml http_timeout 0.1+0.2", { steps: [{ argv: ["config", "set", "http_timeout", "0.30000000000000004"] }, { argv: ["config", "get", "http_timeout"] }] });

// --- set empty (clear) -----------------------------------------------------------------------------------------------
for (const k of ALL_KEYS) {
  add(`set ${k} "" (nothing stored)`, cfg("set", k, ""));
  add(`set ${k} "" after set`, {
    steps: [{ argv: ["config", "set", k, k.startsWith("http") || k === "max_retries" ? "5" : "valuevalue1"] }, { argv: ["config", "set", k, ""] }, { argv: ["config", "get", k] }],
  });
  add(`set ${k} "  " (whitespace)`, { steps: [{ argv: ["config", "set", k, "  "] }] });
  add(`set ${k} "" with env override`, { ...cfg("set", k, ""), env: { E2B_API_KEY: "e", SANDBOX_REGION: "r", E2B_API_URL: "u", E2B_DOMAIN: "d", SANDBOX_HTTP_TIMEOUT: "9", ACR_NAMESPACE: "n", GITHUB_TOKEN: "g", EBX_LLM_API_KEY: "l", ALICLOUD_ACCESS_KEY_ID: "i", ALICLOUD_ACCESS_KEY_SECRET: "s", OPENAI_MODEL: "m", OPENAI_BASE_URL: "b" } });
  add(`set ${k} "" json`, { argv: ["--json", "config", "set", k, ""] });
}
add("set api_key alias clear", cfg("set", "api_key", ""));
add("set llm_api_key '' clears both locations", {
  ...cfg("set", "llm_api_key", ""),
  files: { "home/.ebx/config.toml": TOML_FULL, "home/.ebx/.env": "EBX_LLM_API_KEY=a\nEBX_QWEN_CODE_API_KEY=b\nKEEP=1\n" },
});
add("set llm_model '' clears legacy", { ...cfg("set", "llm_model", ""), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set llm_base_url '' clears legacy", { ...cfg("set", "llm_base_url", ""), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set region '' keeps others", { ...cfg("set", "region", ""), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set region '' leaves empty transport", { ...cfg("set", "region", ""), files: { "home/.ebx/config.toml": '[transport]\nregion = "x"\n' } });
add("set sandbox_api_key '' removes env file line", { ...cfg("set", "sandbox_api_key", ""), files: { "home/.ebx/.env": "E2B_API_KEY=abc\n" } });
add("set sandbox_api_key '' keeps others in env file", { ...cfg("set", "sandbox_api_key", ""), files: { "home/.ebx/.env": "A=1\nE2B_API_KEY=abc\nB=2\n" } });
add("set sandbox_api_key '' with env override named", { ...cfg("set", "sandbox_api_key", ""), env: { SANDBOX_API_KEY: "zzz" }, files: { "home/.ebx/.env": "E2B_API_KEY=abc\n" } });

// --- delete ----------------------------------------------------------------------------------------------------------
for (const k of [...ALL_KEYS, "api_key"]) {
  add(`delete ${k}: nothing stored`, cfg("delete", k));
  add(`delete ${k}: stored`, {
    steps: [{ argv: ["config", "set", k, k.startsWith("http") || k === "max_retries" ? "5" : "valuevalue1"] }, { argv: ["config", "delete", k] }, { argv: ["config", "get", k] }],
  });
  add(`delete ${k}: json`, { argv: ["--json", "config", "delete", k] });
}
add("delete unknown", cfg("delete", "bogus"));
add("delete removed", cfg("delete", "qwen_code_model"));
add("delete shortcuts.x none", cfg("delete", "shortcuts.nope"));
add("delete shortcuts.ps", { ...cfg("delete", "shortcuts.ps"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("delete shortcuts.ps json", { argv: ["--json", "config", "delete", "shortcuts.ps"], files: { "home/.ebx/config.toml": TOML_FULL } });
add("delete shortcuts.sandbox reserved", { ...cfg("delete", "shortcuts.sandbox"), files: { "home/.ebx/config.toml": '[shortcuts]\nsandbox = "x"\n' } });
add("delete shortcuts.config reserved", cfg("delete", "shortcuts.config"));
add("delete shortcuts.template reserved", cfg("delete", "shortcuts.template"));
add("delete shortcuts.mcp reserved", cfg("delete", "shortcuts.mcp"));
add("delete shortcuts. empty", cfg("delete", "shortcuts."));
add("delete shortcuts (bare)", cfg("delete", "shortcuts"));
add("delete with env override", { ...cfg("delete", "region"), env: { SANDBOX_REGION: "cn-env" }, files: { "home/.ebx/config.toml": TOML_FULL } });
add("delete secret with env override", { ...cfg("delete", "sandbox_api_key"), env: { E2B_API_KEY: "envvalue-secret" }, files: { "home/.ebx/.env": ENV_FILE } });
add("delete secret with env override (second name)", { ...cfg("delete", "sandbox_api_key"), env: { SANDBOX_API_KEY: "envvalue-secret" }, files: { "home/.ebx/.env": ENV_FILE } });
add("delete llm_api_key legacy everywhere", { ...cfg("delete", "llm_api_key"), files: { "home/.ebx/config.toml": TOML_FULL, "home/.ebx/.env": "EBX_LLM_API_KEY=a\nEBX_QWEN_CODE_API_KEY=b\nKEEP=1\n" }, env: { OPENAI_API_KEY: "x", DASHSCOPE_API_KEY: "y" } });
add("delete llm_model legacy", { ...cfg("delete", "llm_model"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("delete region last transport key", { ...cfg("delete", "region"), files: { "home/.ebx/config.toml": '[transport]\nregion = "x"\n' } });
add("delete from corrupt toml", { ...cfg("delete", "region"), files: { "home/.ebx/config.toml": "[transport\n" } });
add("delete from ./.env value not removed", { ...cfg("delete", "sandbox_api_key"), files: { "cwd/.env": "E2B_API_KEY=cwdvalue-secret\n" } });

// --- list ------------------------------------------------------------------------------------------------------------
add("list: empty", cfg("list"));
add("list: json", { argv: ["--json", "config", "list"] });
add("list: quiet", { argv: ["--quiet", "config", "list"] });
add("list: no-color", { argv: ["--no-color", "config", "list"] });
add("list: toml full", { ...cfg("list"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("list: toml full json", { argv: ["--json", "config", "list"], files: { "home/.ebx/config.toml": TOML_FULL } });
add("list: env file full", { ...cfg("list"), files: { "home/.ebx/.env": ENV_FILE } });
add("list: env file full json", { argv: ["--json", "config", "list"], files: { "home/.ebx/.env": ENV_FILE } });
add("list: ./.env", { ...cfg("list"), files: { "cwd/.env": "E2B_API_KEY=cwd-secret-abcdef\nSANDBOX_REGION=cn-cwd\nACR_NAMESPACE=cwdns\n" } });
add("list: ./.env beats home", { ...cfg("list"), files: { "cwd/.env": "E2B_API_KEY=cwd-secret-abcdef\n", "home/.ebx/.env": ENV_FILE, "home/.ebx/config.toml": TOML_FULL } });
add("list: env wins everywhere", {
  ...cfg("list"),
  env: { E2B_API_KEY: "env-secret-abcdef", SANDBOX_REGION: "cn-env", E2B_API_URL: "http://e", E2B_DOMAIN: "dd", SANDBOX_HTTP_TIMEOUT: "9", ACR_NAMESPACE: "nsenv", GITHUB_TOKEN: "ghp_envtoken123", OPENAI_API_KEY: "sk-envkey12345", OPENAI_MODEL: "m", OPENAI_BASE_URL: "http://b", ALICLOUD_ACCESS_KEY_ID: "AKIDENV", AccessSecret: "secretenv123" },
  files: { "home/.ebx/.env": ENV_FILE, "home/.ebx/config.toml": TOML_FULL },
});
add("list: env json", {
  argv: ["--json", "config", "list"],
  env: { E2B_API_KEY: "env-secret-abcdef", SANDBOX_REGION: "cn-env", SANDBOX_HTTP_TIMEOUT: "9" },
  files: { "home/.ebx/config.toml": TOML_FULL },
});
add("list: bad http_timeout env", { ...cfg("list"), env: { SANDBOX_HTTP_TIMEOUT: "abc" } });
add("list: legacy qwen only", { ...cfg("list"), files: { "home/.ebx/.env": "EBX_QWEN_CODE_API_KEY=legacy-key-1234567\n", "home/.ebx/config.toml": '[transport]\nqwen_code_base_url = "http://old"\nqwen_code_model = "oldm"\n' } });
add("list: shortcuts with unknown extra", { ...cfg("list"), files: { "home/.ebx/config.toml": '[shortcuts]\nps = "sandbox process list"\ncreate = "sandbox create"\n' } });
add("list: shortcuts json", { argv: ["--json", "config", "list"], files: { "home/.ebx/config.toml": '[shortcuts]\nps = "sandbox process list"\n' } });
add("list: shortcuts non-string values", { ...cfg("list"), files: { "home/.ebx/config.toml": "[shortcuts]\nps = 5\nok = 'sandbox list'\n" } });
add("list: unicode shortcuts alignment", { ...cfg("list"), files: { "home/.ebx/config.toml": "[shortcuts]\n\"日本語\" = 'sandbox list'\nlongaliasname = 'x'\n" } });
add("list: long values", { ...cfg("list"), files: { "home/.ebx/config.toml": `[transport]\napi_url = "${"u".repeat(200)}"\n` } });
add("list: empty-string toml values", { ...cfg("list"), files: { "home/.ebx/config.toml": '[transport]\nregion = ""\napi_url = ""\nllm_model = ""\n' } });
add("list: toml zero values", { ...cfg("list"), files: { "home/.ebx/config.toml": "[transport]\nhttp_timeout = 0\nmax_retries = 0\nhttp2 = false\n" } });
add("list: env empty strings", { ...cfg("list"), env: { E2B_API_KEY: "", SANDBOX_REGION: "" } });
add("list: ./.env comments/quotes", { ...cfg("list"), files: { "cwd/.env": '# c\nE2B_API_KEY="quoted-secret-abcdef"\nSANDBOX_REGION = spaced\nBAD LINE\nexport ACR_NAMESPACE=exp\n' } });
add("list: .env with value empty", { ...cfg("list"), files: { "home/.ebx/.env": "E2B_API_KEY=\nACR_NAMESPACE=   \n" } });
add("list: http2 string env", { ...cfg("list"), env: { SANDBOX_HTTP2: "false" } });

// --- init (non-interactive) -----------------------------------------------------------------------------------------
add("init: piped", cfg("init"));
add("init: --yes", cfg("init", "--yes"));
add("init: -y", cfg("init", "-y"));
add("init: json", { argv: ["--json", "config", "init"] });
add("init: quiet", { argv: ["--quiet", "config", "init", "-y"] });
add("init: piped with input", { ...cfg("init"), stdin: "k\n\n\n\n\n\n" });
add("init --reset-shortcuts: no config", cfg("init", "--reset-shortcuts"));
add("init --reset-shortcuts: json", { argv: ["--json", "config", "init", "--reset-shortcuts"] });
add("init --reset-shortcuts: existing", { ...cfg("init", "--reset-shortcuts"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("init --reset-shortcuts: transport only", { ...cfg("init", "--reset-shortcuts"), files: { "home/.ebx/config.toml": '[transport]\nregion = "x"\n' } });
add("init --reset-shortcuts: with comments", { ...cfg("init", "--reset-shortcuts"), files: { "home/.ebx/config.toml": '# head\n[shortcuts] # trailing\nps = "x"\n# c\n[transport]\nregion = "x"\n' } });
add("init --reset-shortcuts: shortcuts last, no newline", { ...cfg("init", "--reset-shortcuts"), files: { "home/.ebx/config.toml": '[transport]\nregion = "x"\n[shortcuts]\nps = "x"' } });
add("init --reset-shortcuts: indented header", { ...cfg("init", "--reset-shortcuts"), files: { "home/.ebx/config.toml": '  [shortcuts]\nps = "x"\n' } });
add("init --reset-shortcuts: corrupt", { ...cfg("init", "--reset-shortcuts"), files: { "home/.ebx/config.toml": "[transport\n" } });
add("init --reset-shortcuts: twice", { steps: [{ argv: ["config", "init", "--reset-shortcuts"] }, { argv: ["config", "init", "--reset-shortcuts"] }, { argv: ["config", "list"] }] });
add("init --reset-shortcuts --yes", cfg("init", "--reset-shortcuts", "--yes"));
add("init --reset-shortcuts: .ebx is file", { ...cfg("init", "--reset-shortcuts"), files: { "home/.ebx": "x" } });
add("init --reset-shortcuts: crlf", { ...cfg("init", "--reset-shortcuts"), files: { "home/.ebx/config.toml": '[shortcuts]\r\nps = "x"\r\n[transport]\r\nregion = "x"\r\n' } });

// --- shortcuts set / get ---------------------------------------------------------------------------------------------
add("set shortcuts.ps new", cfg("set", "shortcuts.ps", "sandbox process list"));
add("set shortcuts.ps json", { argv: ["--json", "config", "set", "shortcuts.ps", "sandbox process list"] });
add("set shortcuts.ps quiet", { argv: ["--quiet", "config", "set", "shortcuts.ps", "sandbox process list"] });
add("set shortcuts.ps existing section", { ...cfg("set", "shortcuts.ps", "sandbox process list"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set shortcuts.ps overwrite", { ...cfg("set", "shortcuts.ps", "sandbox list"), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set shortcuts.ps '' remove", { ...cfg("set", "shortcuts.ps", ""), files: { "home/.ebx/config.toml": TOML_FULL } });
add("set shortcuts.nope '' remove missing", cfg("set", "shortcuts.nope", ""));
add("set shortcuts.x ws-only", cfg("set", "shortcuts.x", "   "));
add("set shortcuts.sandbox reserved", cfg("set", "shortcuts.sandbox", "sandbox list"));
add("set shortcuts.config reserved", cfg("set", "shortcuts.config", "sandbox list"));
add("set shortcuts.template reserved", cfg("set", "shortcuts.template", "sandbox list"));
add("set shortcuts.mcp reserved", cfg("set", "shortcuts.mcp", "sandbox list"));
add("set shortcuts.sandbox '' reserved", cfg("set", "shortcuts.sandbox", ""));
add("set shortcuts. empty alias", cfg("set", "shortcuts.", "sandbox list"));
add("set shortcuts.bad name space", cfg("set", "shortcuts.a b", "sandbox list"));
add("set shortcuts.bad name dot", cfg("set", "shortcuts.a.b", "sandbox list"));
add("set shortcuts.bad name unicode", cfg("set", "shortcuts.é", "sandbox list"));
add("set shortcuts.bad name quote", cfg("set", "shortcuts.a\"b", "sandbox list"));
add("set shortcuts.dash-name", cfg("set", "shortcuts.my-alias_2", "sandbox list"));
add("set shortcuts.UPPER", cfg("set", "shortcuts.UP", "sandbox list"));
add("set shortcuts.x with ebx prefix", cfg("set", "shortcuts.x", "ebx sandbox list"));
add("set shortcuts.x with ebx prefix json", { argv: ["--json", "config", "set", "shortcuts.x", "ebx sandbox list"] });
add("set shortcuts.x unknown target", cfg("set", "shortcuts.x", "nonexistent thing"));
add("set shortcuts.x unknown subcommand", cfg("set", "shortcuts.x", "sandbox nonexistent"));
add("set shortcuts.x group target", cfg("set", "shortcuts.x", "sandbox"));
add("set shortcuts.x deep target", cfg("set", "shortcuts.x", "sandbox process list"));
add("set shortcuts.x too deep", cfg("set", "shortcuts.x", "sandbox list extra"));
add("set shortcuts.x option arg", cfg("set", "shortcuts.x", "sandbox list --json"));
add("set shortcuts.x quoted value", cfg("set", "shortcuts.x", '"sandbox list"'));
add("set shortcuts.x extra spaces", cfg("set", "shortcuts.x", "  sandbox   list  "));
add("set shortcuts.x tab sep", cfg("set", "shortcuts.x", "sandbox\tlist"));
add("set shortcuts.x top-level cmd", cfg("set", "shortcuts.x", "deploy"));
add("set shortcuts.x config target", cfg("set", "shortcuts.x", "config list"));
add("set shortcuts.x ebx only", cfg("set", "shortcuts.x", "ebx"));
add("set shortcuts.x value with backslash", cfg("set", "shortcuts.x", "sandbox\\list"));
add("set shortcuts.x newline value", cfg("set", "shortcuts.x", "sandbox\nlist"));
add("set shortcuts.x self-referential", cfg("set", "shortcuts.list", "list"));
add("set shortcuts.list existing default target", cfg("set", "shortcuts.list", "sandbox list"));
add("set shortcuts.create default", cfg("set", "shortcuts.create", "sandbox create"));
add("set shortcuts then get", { steps: [{ argv: ["config", "set", "shortcuts.ps", "sandbox process list"] }, { argv: ["config", "get", "shortcuts.ps"] }, { argv: ["config", "get", "shortcuts"] }, { argv: ["config", "list"] }] });
add("set shortcuts then use shortcut", { steps: [{ argv: ["config", "set", "shortcuts.cfgls", "config list"] }, { argv: ["cfgls"] }] });
add("set shortcuts then use shortcut --help", { steps: [{ argv: ["config", "set", "shortcuts.cfgls", "config list"] }, { argv: ["cfgls", "--help"] }, { argv: ["--help"] }] });
add("set shortcuts with comments preserved", {
  ...cfg("set", "shortcuts.ps", "sandbox process list"),
  files: { "home/.ebx/config.toml": "[shortcuts]\n# my comment\nls = 'sandbox list'\n# trailing\n" },
});
add("set shortcuts with transport after", {
  ...cfg("set", "shortcuts.ps", "sandbox process list"),
  files: { "home/.ebx/config.toml": "[shortcuts]\nls = 'sandbox list'\n[transport]\nregion = 'x'\n" },
});
add("set shortcuts non-string existing", {
  ...cfg("set", "shortcuts.ps", "sandbox process list"),
  files: { "home/.ebx/config.toml": "[shortcuts]\nbad = 5\n" },
});
add("set shortcuts target with quotes/backslash", cfg("set", "shortcuts.q", 'sandbox "list"'));
add("set shortcuts: .ebx file", { ...cfg("set", "shortcuts.ps", "sandbox list"), files: { "home/.ebx": "x" } });
add("set shortcuts: config corrupt", { ...cfg("set", "shortcuts.ps", "sandbox list"), files: { "home/.ebx/config.toml": "[shortcuts\n" } });
add("set shortcuts: existing file with no section", { ...cfg("set", "shortcuts.ps", "sandbox list"), files: { "home/.ebx/config.toml": '[transport]\nregion = "x"' } });
add("set shortcuts: empty config file", { ...cfg("set", "shortcuts.ps", "sandbox list"), files: { "home/.ebx/config.toml": "" } });
add("get shortcuts: empty section", { ...cfg("get", "shortcuts"), files: { "home/.ebx/config.toml": "[shortcuts]\n" } });
add("get shortcuts: after reset", { steps: [{ argv: ["config", "init", "--reset-shortcuts"] }, { argv: ["config", "get", "shortcuts"] }, { argv: ["--json", "config", "get", "shortcuts"] }, { argv: ["config", "get", "shortcuts.list"] }] });
add("get shortcuts: commented defaults", { steps: [{ argv: ["config", "init", "--reset-shortcuts"] }, { argv: ["config", "get", "shortcuts.exec"] }] });
add("get shortcuts: unicode alias", { ...cfg("get", "shortcuts"), files: { "home/.ebx/config.toml": "[shortcuts]\n\"日本\" = 'sandbox list'\nab = 'x'\n" } });
add("get shortcuts: alias with spaces key", { ...cfg("get", "shortcuts"), files: { "home/.ebx/config.toml": "[shortcuts]\n\"a b\" = 'sandbox list'\n" } });
add("get shortcuts.a b", { ...cfg("get", "shortcuts.a b"), files: { "home/.ebx/config.toml": "[shortcuts]\n\"a b\" = 'sandbox list'\n" } });

// main-level shortcut-load warnings (loaded on every invocation)
add("warn: corrupt config + sandbox --help", { ...cfg("--help"), files: { "home/.ebx/config.toml": "[shortcuts\n" } });
add("warn: corrupt config + top-level --help", { argv: ["--help"], files: { "home/.ebx/config.toml": "[shortcuts\n" } });
add("warn: corrupt config + version", { argv: ["--version"], files: { "home/.ebx/config.toml": "[shortcuts\n" } });
add("warn: corrupt config + sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "[shortcuts\n" }, env: { E2B_API_URL: "http://127.0.0.1:1", E2B_API_KEY: "k" } });
add("warn: invalid utf-8 config + top-level --help", { argv: ["--help"], binFiles: { "home/.ebx/config.toml": Buffer.from([0x5b, 0xff, 0x5d]) } });
add("warn: config is dir + top-level --help", { argv: ["--help"], dirs: ["home/.ebx/config.toml"] });
add("warn: shortcuts non-table + top-level --help", { argv: ["--help"], files: { "home/.ebx/config.toml": 'shortcuts = "x"\n' } });
add("warn: shortcut reserved name in file", { argv: ["--help"], files: { "home/.ebx/config.toml": "[shortcuts]\nsandbox = 'config list'\n" } });
add("warn: shortcut non-string in file", { argv: ["--help"], files: { "home/.ebx/config.toml": "[shortcuts]\nps = 5\n" } });
add("warn: shortcut unknown target in file", { argv: ["--help"], files: { "home/.ebx/config.toml": "[shortcuts]\nps = 'nonexistent'\n" } });
add("top-level help shows shortcuts", { argv: ["--help"], files: { "home/.ebx/config.toml": TOML_FULL } });
add("top-level help no config", { argv: ["--help"] });
add("top-level help empty home", { argv: ["--help"], files: { "home/.ebx/config.toml": "" } });
add("config file created on plain invocation?", { argv: ["--version"], post: ["home/.ebx/config.toml"] });
add("config file created on sandbox --help?", { argv: ["sandbox", "--help"] });
add("shortcut invocation: ps --help", { argv: ["ps", "--help"], files: { "home/.ebx/config.toml": TOML_FULL } });
add("shortcut invocation: ls extra args", { argv: ["ls", "--bogus"], files: { "home/.ebx/config.toml": TOML_FULL } });
add("shortcut invocation: cfg list json", { argv: ["--json", "cfgls"], files: { "home/.ebx/config.toml": "[shortcuts]\ncfgls = 'config list'\n" } });
add("shortcut invocation: nested group shortcut", { argv: ["cfg2", "get", "region"], files: { "home/.ebx/config.toml": "[shortcuts]\ncfg2 = 'config'\n" } });

// --- misc / env semantics --------------------------------------------------------------------------------------------
add("HOME unset-ish: HOME=/nonexistent get", { ...cfg("get", "region"), env: { HOME: "/nonexistent-ebx-home" } });
add("HOME unset-ish: HOME=/nonexistent set", { ...cfg("set", "region", "x"), env: { HOME: "/nonexistent-ebx-home" } });
add("secret never echoed on set (env)", { ...cfg("set", "sandbox_api_key", "super-secret-value-12345"), env: { E2B_API_KEY: "other-secret-value-12345" } });
add("get ./.env bad utf8", { ...cfg("get", "region"), binFiles: { "cwd/.env": Buffer.from([0x53, 0x41, 0x4e, 0x3d, 0xff, 0x0a]) } });
add("get ./.env is a dir", { ...cfg("get", "region"), dirs: ["cwd/.env"] });
add("get ./.env with BOM", { ...cfg("get", "region"), files: { "cwd/.env": "\ufeffSANDBOX_REGION=bomregion\n" } });
add("get ./.env CRLF", { ...cfg("get", "region"), files: { "cwd/.env": "SANDBOX_REGION=crlfregion\r\n" } });
add("get ./.env inline comment", { ...cfg("get", "region"), files: { "cwd/.env": "SANDBOX_REGION=cn-x # comment\n" } });
add("get ./.env quoted inline comment", { ...cfg("get", "region"), files: { "cwd/.env": 'SANDBOX_REGION="cn-x" # comment\n' } });
add("get ./.env single quoted w/ spaces", { ...cfg("get", "region"), files: { "cwd/.env": "SANDBOX_REGION='cn x'\n" } });
add("get ./.env escapes in double quotes", { ...cfg("get", "region"), files: { "cwd/.env": 'SANDBOX_REGION="a\\nb"\n' } });
add("get ./.env var interpolation", { ...cfg("get", "region"), files: { "cwd/.env": "BASE=cn\nSANDBOX_REGION=${BASE}-x\n" } });
add("get ./.env empty value", { ...cfg("get", "region"), files: { "cwd/.env": "SANDBOX_REGION=\n" } });
add("get ./.env empty beats ~/.ebx", { ...cfg("get", "region"), files: { "cwd/.env": "SANDBOX_REGION=\n", "home/.ebx/config.toml": "[transport]\nregion = 'toml'\n" } });
add("get ./.env duplicate keys", { ...cfg("get", "region"), files: { "cwd/.env": "SANDBOX_REGION=a\nSANDBOX_REGION=b\n" } });
add("get ./.env both alias names", { ...cfg("get", "sandbox_api_key"), files: { "cwd/.env": "SANDBOX_API_KEY=second-secret-key\nE2B_API_KEY=first-secret-key1\n" } });
add("get ~/.ebx/.env quotes", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": 'E2B_API_KEY="quoted-secret-abc"\n' } });
add("get ~/.ebx/.env single quotes", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "E2B_API_KEY='single-secret-abc'\n" } });
add("get ~/.ebx/.env export", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "export E2B_API_KEY=exported-secret-abc\n" } });
add("get ~/.ebx/.env escapes", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": 'E2B_API_KEY="a\\"b\\\\c"\n' } });
add("get ~/.ebx/.env spaces around =", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "E2B_API_KEY = spaced-secret-abc\n" } });
add("get ~/.ebx/.env value with #", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "E2B_API_KEY=abc#def-secret\n" } });
add("get ~/.ebx/.env value with ' #'", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "E2B_API_KEY=abc #def-secret\n" } });
add("get ~/.ebx/.env duplicate", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "E2B_API_KEY=first-secret-abc\nE2B_API_KEY=second-secret-abc\n" } });
add("get ~/.ebx/.env CRLF", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "E2B_API_KEY=crlf-secret-abc\r\n" } });
add("get ~/.ebx/.env BOM", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "\ufeffE2B_API_KEY=bom-secret-abc\n" } });
add("get ~/.ebx/.env only alias SANDBOX_API_KEY", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "SANDBOX_API_KEY=alias-secret-abc\n" } });
add("get ~/.ebx/.env empty", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "E2B_API_KEY=\n" } });
add("get ~/.ebx/.env interpolation", { ...cfg("get", "sandbox_api_key"), files: { "home/.ebx/.env": "X=abc\nE2B_API_KEY=${X}-secret\n" } });
add("get env empty set beats file", { ...cfg("get", "sandbox_api_key"), env: { E2B_API_KEY: "" }, files: { "home/.ebx/.env": ENV_FILE } });
add("get github_token none", cfg("get", "github_token"));
add("get github_token env", { ...cfg("get", "github_token"), env: { GITHUB_TOKEN: "ghp_envtokenabcdef" } });
add("get github_token via gh CLI env only", { ...cfg("get", "github_token"), env: { GH_TOKEN: "ghp_ghtokenabcdef" } });
add("list: github_token ./.env", { ...cfg("list"), files: { "cwd/.env": "GITHUB_TOKEN=ghp_cwdtoken123456\n" } });
add("set github_token then list", { steps: [{ argv: ["config", "set", "github_token", "ghp_abcdefghijk"] }, { argv: ["config", "list"] }] });
add("set llm_* then list json", {
  steps: [
    { argv: ["config", "set", "llm_api_key", "sk-abcdefghijk"] }, { argv: ["config", "set", "llm_model", "m1"] }, { argv: ["config", "set", "llm_base_url", "http://b"] },
    { argv: ["--json", "config", "list"] }, { argv: ["config", "list"] },
  ],
});
add("set all keys then list", {
  steps: ALL_KEYS.map((k) => ({ argv: ["config", "set", k, k === "http_timeout" ? "3" : k === "max_retries" ? "2" : k === "http2" ? "no" : `value-${k}-123456`] })).concat([{ argv: ["config", "list"] }, { argv: ["--json", "config", "list"] }]),
});
add("set two keys .env perms stay 600", { steps: [{ argv: ["config", "set", "sandbox_api_key", "abcdefghijk"] }, { argv: ["config", "set", "access_key_id", "AKID1"] }] });
add("set after delete .env", { steps: [{ argv: ["config", "set", "sandbox_api_key", "abcdefghijk"] }, { argv: ["config", "delete", "sandbox_api_key"] }, { argv: ["config", "set", "access_key_id", "AKID1"] }] });
add("delete last secret leaves empty .env?", { steps: [{ argv: ["config", "set", "sandbox_api_key", "abcdefghijk"] }, { argv: ["config", "delete", "sandbox_api_key"] }] });
add("set alias then get both", { steps: [{ argv: ["config", "set", "api_key", "abcdefghijk"] }, { argv: ["config", "get", "api_key"] }, { argv: ["config", "get", "sandbox_api_key"] }] });
add("set with leading dash value via --", cfg("set", "region", "--", "-x"));
add("set value --json after key", { argv: ["config", "set", "region", "x", "--json"] });
add("global opts after: config list --json", { argv: ["config", "list", "--json"] });
add("help: config set -- help text region", cfg("set", "--help"));

// --- round 2: extra tomllib error texts (the transport loader now prints them verbatim), long/unicode/windows values ---
const BAD_FILES_2 = {
  "bare key chars": "[transport]\nreg ion = 1\n",
  "missing equals": "[transport]\nregion\n",
  "missing value": "[transport]\nregion =\n",
  "trailing garbage": "[transport]\nregion = 1 2\n",
  "leading zero": "[transport]\nmax_retries = 007\n",
  "bad hex": "[transport]\nmax_retries = 0xZZ\n",
  "bad underscore": "[transport]\nmax_retries = 1__0\n",
  "unterminated multiline": '[transport]\nregion = """abc\n',
  "unterminated literal": "[transport]\nregion = 'abc\n",
  "unterminated array": "[transport]\nregion = [1, 2\n",
  "unterminated inline": "[transport]\nregion = { a = 1\n",
  "mixed array ok": '[transport]\nregion = [1, "a"]\n',
  "overwrite table with value": "[transport]\nregion = 1\n[transport.region]\na = 1\n",
  "redefine via dotted": "[transport]\na.b = 1\n[transport.a]\nc = 2\n",
  "bad header": "[transport\nregion = 1\n",
  "empty header": "[]\n",
  "empty key": '[transport]\n"" = 1\n',
  "bad unicode escape": '[transport]\nregion = "\\uD800"\n',
  "short unicode escape": '[transport]\nregion = "\\u12"\n',
  "control char": '[transport]\nregion = "a\u0001b"\n',
  "nul in comment": "# a\u0000b\n[transport]\n",
  "bad time": "[transport]\nt = 25:61:00\n",
  "bad datetime offset": "[transport]\nt = 2024-01-01T00:00:00+25:00\n",
  "bad bool": "[transport]\nhttp2 = True\n",
  "float no digits": "[transport]\nhttp_timeout = 1.\n",
  "float leading dot": "[transport]\nhttp_timeout = .5\n",
  "nan ok": "[transport]\nhttp_timeout = nan\n",
  "line 5 error": "# a\n# b\n[transport]\nregion = 'ok'\n@@\n",
  "unicode column": '[transport]\nregion = "ünï☃" x\n',
  "array of tables": '[[transport]]\nregion = "x"\n',
  "dotted transport": 'transport.region = "dotted"\n',
  "transport list": "transport = [1, 2]\n",
  "transport int": "transport = 5\n",
  "nested transport": '[transport.sub]\nregion = "x"\n',
  "only comment": "# nothing here\n",
  "tab indent": '\t[transport]\n\tregion = "tab"\n',
  "integer key order": '[transport]\n10 = "a"\n2 = "b"\nregion = "c"\n',
  "huge int": "[transport]\nmax_retries = 99999999999999999999\n",
  "neg zero float": "[transport]\nhttp_timeout = -0.0\n",
  "exp float": "[transport]\nhttp_timeout = 1e3\n",
  "dup after dotted": "[transport]\na.b = 1\na = 2\n",
};
for (const [label, body] of Object.entries(BAD_FILES_2)) {
  add(`toml2 (${label}): get region`, { ...cfg("get", "region"), files: { "home/.ebx/config.toml": body } });
  add(`toml2 (${label}): list json`, { argv: ["--json", "config", "list"], files: { "home/.ebx/config.toml": body } });
  add(`toml2 (${label}): get http_timeout`, { ...cfg("get", "http_timeout"), files: { "home/.ebx/config.toml": body } });
  add(`toml2 (${label}): set max_retries`, { ...cfg("set", "max_retries", "4"), files: { "home/.ebx/config.toml": body }, post: ["home/.ebx/config.toml"] });
}
for (const [label, body] of Object.entries({ ...BAD_FILES, ...BAD_FILES_2 })) {
  add(`warn-transport (${label}): sandbox list`, { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": body } });
}
for (const [label, bytes] of Object.entries({ "start byte": [0xc3, 0x28], truncated: [0x5b, 0xe2, 0x82], overlong: [0xc0, 0xaf], surrogate: [0xed, 0xa0, 0x80], "bad continuation": [0xe2, 0x28, 0xa1], "invalid start": [0xff], "4-byte bad": [0xf0, 0x28, 0x8c, 0xbc], "above max": [0xf4, 0x90, 0x80, 0x80] })) {
  add(`warn-transport (utf-8 ${label}): sandbox list`, { argv: ["sandbox", "list"], binFiles: { "home/.ebx/config.toml": Buffer.from(bytes) } });
}
add("warn-transport (directory): sandbox list", { argv: ["sandbox", "list"], dirs: ["home/.ebx/config.toml"] });
add("warn-transport (unreadable): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "[transport]\nregion='x'\n" }, chmod: { "home/.ebx/config.toml": 0o000 } });
add("warn-transport (valid, unicode path home): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "[transport]\nhttp_timeout = 1.5\nmax_retries = 2.0\n" } });
add("warn-transport (float for int field): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "[transport]\nmax_retries = 2.5\n" } });
add("warn-transport (str for float field): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": '[transport]\nhttp_timeout = "abc"\n' } });
add("warn-transport (bool for int field): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "[transport]\nmax_retries = true\n" } });
add("warn-transport (date for str field): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "[transport]\nregion = 2024-01-01\n" } });
add("warn-transport (array for str field): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "[transport]\nregion = [1]\n" } });
add("warn-transport (inf timeout): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "[transport]\nhttp_timeout = inf\n" } });
add("warn-transport (legacy flat keys): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": 'region = "x"\napi_base_url = "http://127.0.0.1:1"\n' } });
add("warn-transport (transport list): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "transport = [1, 2]\n" } });
add("warn-transport (transport str): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": 'transport = "x"\n' } });
add("warn-transport (transport int): sandbox list", { argv: ["sandbox", "list"], files: { "home/.ebx/config.toml": "transport = 5\n" } });
add("toml2: invalid utf-8 start byte get", { ...cfg("get", "region"), binFiles: { "home/.ebx/config.toml": Buffer.from([0xc3, 0x28]) } });
add("toml2: invalid utf-8 truncated get", { ...cfg("get", "region"), binFiles: { "home/.ebx/config.toml": Buffer.from([0x5b, 0xe2, 0x82]) } });
add("toml2: invalid utf-8 overlong get", { ...cfg("get", "region"), binFiles: { "home/.ebx/config.toml": Buffer.from([0xc0, 0xaf]) } });
add("toml2: invalid utf-8 surrogate get", { ...cfg("get", "region"), binFiles: { "home/.ebx/config.toml": Buffer.from([0xed, 0xa0, 0x80]) } });
add("toml2: utf-16 file get", { ...cfg("get", "region"), binFiles: { "home/.ebx/config.toml": Buffer.from("\ufeff[transport]\nregion='x'\n", "utf16le") } });
add("toml2: config.toml symlink to file", { ...cfg("get", "region"), files: { "real.toml": "[transport]\nregion='linked'\n" }, symlinks: { "home/.ebx/config.toml": "real.toml" } });
add("toml2: config.toml dangling symlink get", { ...cfg("get", "region"), symlinks: { "home/.ebx/config.toml": "nowhere.toml" } });
add("toml2: config.toml dangling symlink set", { ...cfg("set", "region", "x"), symlinks: { "home/.ebx/config.toml": "nowhere.toml" }, post: ["nowhere.toml"] });
add("toml2: config.toml symlink set follows", { ...cfg("set", "region", "x"), files: { "real.toml": "[transport]\nregion='linked'\n" }, symlinks: { "home/.ebx/config.toml": "real.toml" }, post: ["real.toml"] });
add("toml2: .env symlink set", { ...cfg("set", "sandbox_api_key", "abcdefghijk"), files: { "real.env": "OTHER=1\n" }, symlinks: { "home/.ebx/.env": "real.env" }, post: ["real.env"] });
add("toml2: config.toml unreadable set", { ...cfg("set", "region", "x"), files: { "home/.ebx/config.toml": "[transport]\nregion='x'\n" }, chmod: { "home/.ebx/config.toml": 0o000 } });
add("toml2: config.toml unreadable list", { ...cfg("list"), files: { "home/.ebx/config.toml": "[transport]\nregion='x'\n" }, chmod: { "home/.ebx/config.toml": 0o000 } });
add("toml2: config.toml readonly set", { ...cfg("set", "region", "y"), files: { "home/.ebx/config.toml": "[transport]\nregion='x'\n" }, chmod: { "home/.ebx/config.toml": 0o400 }, post: ["home/.ebx/config.toml"] });
add("toml2: config.toml readonly delete", { ...cfg("delete", "region"), files: { "home/.ebx/config.toml": "[transport]\nregion='x'\n" }, chmod: { "home/.ebx/config.toml": 0o400 }, post: ["home/.ebx/config.toml"] });
add("toml2: .env readonly delete", { ...cfg("delete", "sandbox_api_key"), files: { "home/.ebx/.env": ENV_FILE }, chmod: { "home/.ebx/.env": 0o400 } });
add("toml2: .ebx readonly delete", { ...cfg("delete", "sandbox_api_key"), files: { "home/.ebx/.env": ENV_FILE }, chmod: { "home/.ebx": 0o500 } });
add("toml2: .ebx readonly init", { ...cfg("init", "--reset-shortcuts"), dirs: ["home/.ebx"], chmod: { "home/.ebx": 0o500 } });
add("toml2: keychain env unset", { ...cfg("set", "sandbox_api_key", "abcdefghijk"), env: { EBX_NO_KEYCHAIN: "" } });
add("toml2: keychain env 0", { ...cfg("get", "sandbox_api_key"), env: { EBX_NO_KEYCHAIN: "0", E2B_API_KEY: "abcdefghijk" } });
add("toml2: keychain fake dbus", { ...cfg("set", "sandbox_api_key", "abcdefghijk"), env: { EBX_NO_KEYCHAIN: "0", DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/bus" } });

const LONG = "L".repeat(5000);
const WIN_VALUES = ["C:\\Users\\me\\.ebx\\ns", "\\\\server\\share", "D:/a/b", "ns\\with\\back", "tab\tvalue", "nul\u0000x", "emoji-\u{1F600}-value", "e\u0301combining", "\u202ertl-override", "  ", "", '"', "'", "\\", "\\u0041", "a\\nb", "\u007f", "line1\nline2", "\u2028sep", "\ud83d"];
for (const k of ["region", "domain", "api_url", "acr_namespace", "llm_model", "llm_base_url", "sandbox_api_key", "llm_api_key", "github_token", "access_key_id", "access_key_secret"]) {
  add(`round2 set ${k} very long`, { steps: [{ argv: ["config", "set", k, LONG] }, { argv: ["config", "get", k] }, { argv: ["--json", "config", "list"] }] });
  for (const [i, v] of WIN_VALUES.entries()) {
    if (v.includes("\u0000")) continue;
    add(`round2 set ${k} odd value #${i}`, { steps: [{ argv: ["config", "set", k, v] }, { argv: ["config", "get", k] }, { argv: ["config", "list"] }] });
  }
}
for (const k of ["http_timeout", "max_retries", "http2"]) {
  for (const v of ["0", "-1", "1e3", "1_0", "+5", " 7 ", "0x10", "١٢٣", "1.5", "9".repeat(40), "nan", "inf", "-inf", "true", "TRUE", "yes", "off", "2", "", "None", "1e400", "0.1e-2", "٣.٥", "1,5"]) {
    add(`round2 set ${k} ${JSON.stringify(v)}`, { steps: [{ argv: ["config", "set", k, v] }, { argv: ["config", "get", k] }, { argv: ["--json", "config", "list"] }], post: [] });
  }
}
for (const k of ["shortcuts", "shortcuts.", "shortcuts..x", ".", "..", "a.b", "transport.region", "Shortcuts.x", "shortcuts.x.y", "shortcuts. x", "shortcuts.Ps", "shortcuts.config", "shortcuts.sandbox", "shortcuts.--help", "shortcuts.é"]) {
  add(`round2 set ${JSON.stringify(k)} target`, { steps: [{ argv: ["config", "set", k, "sandbox list"] }, { argv: ["config", "get", k] }, { argv: ["config", "list"] }] });
  add(`round2 delete ${JSON.stringify(k)}`, { argv: ["config", "delete", k], files: { "home/.ebx/config.toml": TOML_FULL }, post: ["home/.ebx/config.toml"] });
  add(`round2 get ${JSON.stringify(k)}`, { argv: ["config", "get", k], files: { "home/.ebx/config.toml": TOML_FULL } });
}
for (const t of ["sandbox list", " sandbox list ", "sandbox  list", "Sandbox List", "ebx sandbox list", "sandbox", "template build", "deploy", "sandbox files list", "", " ", "sandbox list --json", "sandbox\tlist", "sandbox\u00a0list", "ebx", "ebx ", "EBX template init"]) {
  add(`round2 set shortcuts.zz ${JSON.stringify(t)}`, { steps: [{ argv: ["config", "set", "shortcuts.zz", t] }, { argv: ["config", "get", "shortcuts.zz"] }, { argv: ["--json", "config", "get", "shortcuts"] }] });
}
add("round2 shortcuts file: weird header spacing", { ...cfg("list"), files: { "home/.ebx/config.toml": '  [ shortcuts ]  # c\nps = "sandbox process list"\n' } });
add("round2 shortcuts file: quoted keys", { ...cfg("get", "shortcuts"), files: { "home/.ebx/config.toml": '[shortcuts]\n"my alias" = "sandbox list"\n\'q\' = "sandbox info"\n' } });
add("round2 shortcuts file: dotted subtable", { ...cfg("get", "shortcuts"), files: { "home/.ebx/config.toml": '[shortcuts.sub]\nx = "sandbox list"\n' } });
add("round2 shortcuts file: empty section", { ...cfg("get", "shortcuts"), files: { "home/.ebx/config.toml": "[shortcuts]\n" } });
add("round2 shortcuts file: set into empty section", { ...cfg("set", "shortcuts.x", "sandbox list"), files: { "home/.ebx/config.toml": "[shortcuts]\n" }, post: ["home/.ebx/config.toml"] });
add("round2 shortcuts file: set preserves comments", { ...cfg("set", "shortcuts.x", "sandbox list"), files: { "home/.ebx/config.toml": '# top\n[shortcuts]\n# c\nps = "sandbox process list" # t\n\n[other]\nk = 1\n' }, post: ["home/.ebx/config.toml"] });
add("round2 shortcuts file: delete last", { ...cfg("delete", "shortcuts.ps"), files: { "home/.ebx/config.toml": '[shortcuts]\nps = "sandbox process list"\n' }, post: ["home/.ebx/config.toml"] });
add("round2 shortcuts file: delete missing", { ...cfg("delete", "shortcuts.zz"), files: { "home/.ebx/config.toml": '[shortcuts]\nps = "sandbox process list"\n' }, post: ["home/.ebx/config.toml"] });
add("round2 shortcuts file: unicode alias", { steps: [{ argv: ["config", "set", "shortcuts.пс", "sandbox list"] }, { argv: ["config", "list"] }, { argv: ["--help"] }] });
add("round2 sequential writers keep both", { steps: [{ argv: ["config", "set", "region", "a"] }, { argv: ["config", "set", "domain", "b"] }, { argv: ["config", "set", "shortcuts.q", "sandbox list"] }, { argv: ["config", "set", "region", "c"] }, { argv: ["config", "list"] }] });
add("round2 get nonexistent HOME dir json", { argv: ["--json", "config", "list"], env: { HOME: "/nonexistent-ebx-home" } });
add("round2 delete every key", { steps: [...ALL_KEYS.map((k) => ({ argv: ["config", "set", k, k === "http_timeout" ? "3" : k === "max_retries" ? "2" : k === "http2" ? "no" : `value-${k}-123456`] })), ...ALL_KEYS.map((k) => ({ argv: ["config", "delete", k] })), { argv: ["config", "list"] }], post: [] });

// --- interactive (pty) -----------------------------------------------------------------------------------------------
if (HAVE_PTY) {
  const P = (name, argv, inputs, spec = {}) => add(`pty: ${name}`, { steps: [{ argv, pty: inputs }], ...spec });
  P("init all skipped", ["config", "init"], ["\n", "\n", "\n", "\n", "\n", "\n"]);
  P("init all values", ["config", "init"], ["sk-abc-123456789\n", "cn-shanghai\n", "llm-key-123456789\n", "my-ns\n", "AKID-12345\n", "aksecret-12345\n"]);
  P("init region default accepted", ["config", "init"], ["\n", "\n", "\n", "\n", "\n", "\n"], { files: { "home/.ebx/config.toml": '[transport]\nregion = "cn-beijing"\n' } });
  P("init existing namespace default", ["config", "init"], ["\n", "\n", "\n", "\n", "\n", "\n"], { files: { "home/.ebx/.env": "ACR_NAMESPACE=oldns\n" } });
  P("init migrates legacy llm key", ["config", "init"], ["\n", "\n", "new-llm-key-123\n", "\n", "\n", "\n"], { files: { "home/.ebx/config.toml": TOML_FULL } });
  P("init ctrl-c at first prompt", ["config", "init"], ["\x03"]);
  P("init ctrl-d at first prompt", ["config", "init"], ["\x04"]);
  P("init ctrl-d at region", ["config", "init"], ["\n", "\x04"]);
  P("init ctrl-c mid secret", ["config", "init"], ["abc", "\x00\x03"]);
  P("init backspace in secret", ["config", "init"], ["abcd\x7f\x7fxy\n", "\n", "\n", "\n", "\n", "\n"]);
  P("init ctrl-u in secret", ["config", "init"], ["abcd\x15xyz12345\n", "\n", "\n", "\n", "\n", "\n"]);
  P("init ctrl-w in secret?", ["config", "init"], ["abcd efg\x17h\n", "\n", "\n", "\n", "\n", "\n"]);
  P("init non-ascii secret", ["config", "init"], ["ключ-секрет\n", "\n", "\n", "\n", "\n", "\n"]);
  P("init whitespace secret ignored", ["config", "init"], ["   \n", "\n", "\n", "\n", "\n", "\n"]);
  P("init padded secret trimmed", ["config", "init"], ["  padded-secret-1  \n", "\n", "\n", "\n", "\n", "\n"]);
  P("init escape sequence in secret", ["config", "init"], ["ab\x1b[Acd\n", "\n", "\n", "\n", "\n", "\n"]);
  P("init tab in secret", ["config", "init"], ["ab\tcd\n", "\n", "\n", "\n", "\n", "\n"]);
  P("init CR line ending", ["config", "init"], ["secret-cr-1234\r", "\r", "\r", "\r", "\r", "\r"]);
  P("init region whitespace", ["config", "init"], ["\n", "   \n", "\n", "\n", "\n", "\n"]);
  P("init --yes in tty", ["config", "init", "--yes"], []);
  P("init --reset-shortcuts in tty", ["config", "init", "--reset-shortcuts"], []);
  P("init config corrupt", ["config", "init"], ["\n", "\n", "\n", "\n", "\n", "\n"], { files: { "home/.ebx/config.toml": "[transport\n" } });
  P("init corrupt: set region", ["config", "init"], ["\n", "cn-x\n", "\n", "\n", "\n", "\n"], { files: { "home/.ebx/config.toml": "[transport\n" } });
  P("init region creates shortcuts section", ["config", "init"], ["\n", "cn-x\n", "\n", "\n", "\n", "\n"]);
  P("init region keeps existing shortcuts", ["config", "init"], ["\n", "cn-x\n", "\n", "\n", "\n", "\n"], { files: { "home/.ebx/config.toml": TOML_FULL } });
  P("init json mode", ["--json", "config", "init"], ["k-12345678\n", "\n", "\n", "\n", "\n", "\n"]);
  P("init quiet mode", ["--quiet", "config", "init"], ["k-12345678\n", "\n", "\n", "\n", "\n", "\n"]);
  P("set secret masked prompt", ["config", "set", "github_token"], ["ghp_typedsecret1\n"]);
  P("set secret masked prompt empty", ["config", "set", "github_token"], ["\n"]);
  P("set secret masked prompt ctrl-c", ["config", "set", "github_token"], ["\x03"]);
  P("set secret masked prompt ctrl-d", ["config", "set", "github_token"], ["\x04"]);
  P("set secret masked prompt ctrl-d after text", ["config", "set", "github_token"], ["abc\x04"]);
  P("set secret masked prompt backspace", ["config", "set", "github_token"], ["abcdefgh\x7f\x7f\x7f\n"]);
  P("set secret masked all backspaced", ["config", "set", "github_token"], ["ab\x7f\x7f\x7f\n"]);
  P("set secret masked wide chars", ["config", "set", "sandbox_api_key"], ["日本語キーabc\n"]);
  P("set secret masked emoji", ["config", "set", "sandbox_api_key"], ["k😀k-12345678\n"]);
  P("set secret masked ctrl-u", ["config", "set", "sandbox_api_key"], ["junkjunk\x15good-key-123\n"]);
  P("set secret masked alias api_key", ["config", "set", "api_key"], ["alias-secret-123\n"]);
  P("set llm_api_key masked prompt", ["config", "set", "llm_api_key"], ["llm-typed-secret\n"], { files: { "home/.ebx/config.toml": TOML_FULL } });
  P("set access_key_secret masked prompt", ["config", "set", "access_key_secret"], ["aks-typed-secret\n"]);
  P("set access_key_id visible prompt", ["config", "set", "access_key_id"], ["AKID-typed\n"]);
  P("set region visible prompt", ["config", "set", "region"], ["cn-typed\n"]);
  P("set region visible prompt empty", ["config", "set", "region"], ["\n"]);
  P("set region visible prompt spaces", ["config", "set", "region"], ["   \n"]);
  P("set region visible prompt ctrl-d", ["config", "set", "region"], ["\x04"]);
  P("set http_timeout visible prompt", ["config", "set", "http_timeout"], ["33\n"]);
  P("set http_timeout visible prompt bad", ["config", "set", "http_timeout"], ["abc\n"]);
  P("set shortcuts.x visible prompt", ["config", "set", "shortcuts.xx"], ["sandbox list\n"]);
  P("set shortcuts.x visible prompt empty", ["config", "set", "shortcuts.xx"], ["\n"]);
  P("set unknown key prompt not reached", ["config", "set", "bogus"], []);
  P("set secret prompt json mode", ["--json", "config", "set", "github_token"], ["ghp_typedsecret1\n"]);
  P("set secret prompt quiet mode", ["--quiet", "config", "set", "github_token"], ["ghp_typedsecret1\n"]);
  P("set secret w/ env override prompts", ["config", "set", "github_token"], ["ghp_typedsecret1\n"], { env: { GITHUB_TOKEN: "envtoken-abcdefg" } });
  P("list in tty", ["config", "list"], []);
  P("get in tty", ["config", "get", "region"], []);
}

// ---------------------------------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------------------------------

const selected = CASES.filter((c) => !only || c.name.includes(only));
let failures = 0;
let next = 0;
let done = 0;

async function worker() {
  while (next < selected.length) {
    const c = selected[next++];
    const [py, nd] = await Promise.all([runCase("python", c), runCase("node", c)]);
    done++;
    if (same(py, nd)) {
      if (verbose) console.log(`ok   ${c.name}`);
    } else {
      failures++;
      console.log(showDiff(c.name, py, nd));
    }
  }
}

await Promise.all(Array.from({ length: Math.max(1, JOBS) }, worker));
console.log(`\n${done} cases, ${failures} differing${HAVE_PTY ? "" : " (pty cases skipped: python3 pty unavailable)"}`);
process.exit(failures ? 1 : 0);

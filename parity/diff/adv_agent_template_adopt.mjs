#!/usr/bin/env node
/**
 * Adversarial differential: `template init --adopt` (staging whitelist, secret filters, symlinks, size limits, reserved
 * files, promotion / backups) and the qwen-code host side (argv, scrubbed environment, process group, timeouts, output
 * parsing) against a scriptable fake `qwen` (adv_agent_template_fakeqwen.py, selected through EBX_QWEN_CODE_BIN).
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_agent_template_adopt.mjs [--verbose] [--only <substr>]
 *
 * Exit 0 = identical (or oracle absent -> skipped), 1 = differences.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireOracle, runSuite, setFileNormaliser, setSortListings } from "./adv_agent_template_lib.mjs";
setSortListings(true);
setFileNormaliser((name, data) => {
  if (name === "scenario.json" || name === "bg.pid") return Buffer.from("<masked>");
  if (name === "qwen" && data.subarray(0, 17).toString() === "#!/usr/bin/env sh") return Buffer.from("<wrapper>");
  return null;
});

requireOracle();
const HERE = dirname(fileURLToPath(import.meta.url));
const PY3 = spawnSync("python3", ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
if (!PY3) {
  console.error("python3 not found; skipping.");
  process.exit(0);
}
const FAKE = readFileSync(join(HERE, "adv_agent_template_fakeqwen.py"), "utf8").replace("#!/usr/bin/env python3", `#!${PY3}`);
void resolve;

const LT = "LT" + "AI";
const AK = "AK" + "IA";
const SK = "s" + "k-";
const cases = [];
const DOCKERFILE = 'FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py commands.py /app/\nCOPY *.whl /tmp/\nEXPOSE 9000\nCMD ["python3", "commands.py"]\n';
const COMMANDS = "from easy_sandbox.server import SandboxServer\n\nSandboxServer().serve(port=9000)\n";
const TEMPLATE = 'name: whatever\nversion: "1.0.0"\ndescription: adopted\nports: [9000]\nresources:\n  cpu: 1\n  memory: 512\n';
const GOOD = [
  { write: "Dockerfile", content: DOCKERFILE },
  { write: "commands.py", content: COMMANDS },
  { write: "template.yaml", content: TEMPLATE },
  { result: "done" },
];
const APP = { "app/app.py": "print('hi')\n" };
const ARGV = ["template", "init", "--adopt", "{work}/app", "-y", "--name", "demo"];
const ENV = { EBX_QWEN_CODE_BIN: "{work}/fakeq/qwen", OPENAI_API_KEY: "sk-fake-key-for-test", E2B_API_KEY: "leak-canary-e2b", ALICLOUD_ACCESS_KEY_ID: "leak-canary-ak", GITHUB_TOKEN: "leak-canary-gh", EBX_QWEN_CODEGEN_TIMEOUT: "20", XDG_DATA_HOME: "/xdg", LC_ALL: "C.UTF-8" };

function add(name, { actions = GOOD, files = APP, argv = ARGV, env = {}, scenario = {}, homeFiles = {}, modes = {}, ...rest } = {}) {
  cases.push({
    name,
    argv,
    files: { ...files, "fakeq/qwen": FAKE },
    modes: { "fakeq/qwen": 0o755, ...modes },
    homeFiles: { ".fakeq/scenario.json": JSON.stringify({ actions, log_env: ["HOME", "LANG", "TERM", "LC_ALL", "XDG_DATA_HOME", "OPENAI_API_KEY", "NO_PROXY"], ...scenario }), ...homeFiles },
    env: { ...ENV, ...env },
    timeoutMs: 60000,
    ...rest,
  });
}
const good = (...replace) => {
  const m = new Map(GOOD.map((a) => [a.write ?? "result", a]));
  for (const r of replace) m.set(r.write ?? "result", r);
  return [...m.values()];
};

// ---- baseline + what the agent receives ---------------------------------------------------------------------------------
add("good baseline");
add("good: default name from dir", { argv: ["template", "init", "--adopt", "{work}/app", "-y"] });
add("good: hint", { argv: [...ARGV, "--hint", "listen on 8080 — héllo 😀"] });
add("good: cwd default (.)", { argv: ["template", "init", "--adopt", "-y", "--name", "demo"], files: { "app.py": "print(1)\n" } });
add("good: many files listing (>200)", { files: Object.fromEntries(Array.from({ length: 230 }, (_, i) => [`app/f${String(i).padStart(3, "0")}.py`, `x${i}\n`])) });
add("good: nested + unicode names", { files: { "app/sub/dir/模块.py": "x=1\n", "app/with space.txt": "t\n", "app/é.py": "e\n", "app/a\nb.py": "nl\n" } });
add("good: --json", { argv: ["--json", ...ARGV] });
add("good: --quiet", { argv: ["--quiet", ...ARGV] });
add("good: --verbose", { argv: [...ARGV, "--verbose"] });
add("env: scrubbed (names logged)", { actions: [...GOOD], env: { AWS_SECRET_ACCESS_KEY: "leak-aws", ACR_PASSWORD: "leak-acr", SOME_RANDOM: "x", LC_MESSAGES: "C", XDG_CONFIG_HOME: "/xc", HTTPS_PROXY: "http://p:1", NODE_EXTRA_CA_CERTS: "/ca.pem", TMPDIR: "/tmp", CI: "1", NO_COLOR: "1" } });
add("env: DASHSCOPE only", { env: { OPENAI_API_KEY: null, DASHSCOPE_API_KEY: "dk" } });
add("env: BAILIAN only", { env: { OPENAI_API_KEY: null, BAILIAN_CODING_PLAN_API_KEY: "bk" } });
add("env: EBX_LLM_API_KEY injects OPENAI_*", { env: { OPENAI_API_KEY: null, EBX_LLM_API_KEY: "llm-key", EBX_LLM_BASE_URL: "https://llm.example/v1", EBX_LLM_MODEL: "m-1" }, scenario: { log_env: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "DASHSCOPE_API_KEY"] } });
add("env: EBX_LLM_API_KEY + OPENAI already set", { env: { EBX_LLM_API_KEY: "llm-key" }, scenario: { log_env: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"] } });
add("env: config.toml llm_api_key", { env: { OPENAI_API_KEY: null }, homeFiles: { ".ebx/config.toml": '[llm]\napi_key = "toml-llm"\nbase_url = "https://b/v1"\nmodel = "mm"\n' }, scenario: { log_env: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"] } });
add("env: ~/.ebx/.env llm key", { env: { OPENAI_API_KEY: null }, homeFiles: { ".ebx/.env": "EBX_LLM_API_KEY=dotenv-llm\n" }, scenario: { log_env: ["OPENAI_API_KEY"] } });
add("env: qwen settings.json configured", { env: { OPENAI_API_KEY: null }, homeFiles: { ".qwen/settings.json": '{"env": {"X": "1"}}' } });
add("env: qwen settings.json empty", { env: { OPENAI_API_KEY: null }, homeFiles: { ".qwen/settings.json": "{}" } });
add("env: qwen settings.json invalid", { env: { OPENAI_API_KEY: null }, homeFiles: { ".qwen/settings.json": "{" } });
add("env: no credentials", { env: { OPENAI_API_KEY: null } });
add("env: no qwen binary", { env: { EBX_QWEN_CODE_BIN: "{work}/nope/qwen" } });
add("env: qwen bin is a directory", { env: { EBX_QWEN_CODE_BIN: "{work}/app" } });
add("env: qwen bin not executable", { env: { EBX_QWEN_CODE_BIN: "{work}/app/app.py" } });
add("env: qwen bin tilde", { env: { EBX_QWEN_CODE_BIN: "~/qw" }, homeFiles: { qw: FAKE }, homeModes: { qw: 0o755 } });
add("env: qwen bin empty string -> PATH lookup", { env: { EBX_QWEN_CODE_BIN: "" } });
add("env: managed ~/.ebx/bin/qwen", { env: { EBX_QWEN_CODE_BIN: null }, homeFiles: { ".ebx/bin/qwen": FAKE }, homeModes: { ".ebx/bin/qwen": 0o755 } });
add("env: managed ~/.ebx/bin/qwen not executable", { env: { EBX_QWEN_CODE_BIN: null }, homeFiles: { ".ebx/bin/qwen": FAKE } });
add("env: bin shebang missing interpreter", { files: { ...APP, "bad-shebang": "#!/nonexistent/interp\n" }, modes: { "bad-shebang": 0o755 }, env: { EBX_QWEN_CODE_BIN: "{work}/bad-shebang" } });
add("env: timeout garbage", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "abc" } });
add("env: timeout negative", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "-5" } });
add("env: timeout zero", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "0" } });
add("env: timeout nan", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "nan" } });
add("env: timeout 3000000s (> 2^31 ms)", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "3000000" } });
add("env: timeout 2147483s (just under)", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "2147483" } });
add("env: timeout 2147484s (just over)", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "2147484" } });
add("env: timeout inf", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "inf" } });
add("env: timeout 1e2", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "1e2" } });
add("env: timeout underscores 1_0", { env: { EBX_QWEN_CODEGEN_TIMEOUT: "1_0" } });

// ---- agent output handling ----------------------------------------------------------------------------------------------
add("out: stray log lines before result", { actions: [{ stdout: "Loading...\nwarn: x\n" }, ...GOOD] });
add("out: result only (no files)", { actions: [{ result: "I did nothing" }] });
add("out: is_error with Dockerfile present", { actions: good({ result: "oops", is_error: true }) });
add("out: is_error no Dockerfile", { actions: [{ result: "oops", is_error: true }] });
add("out: exit 1 + good files", { actions: [...GOOD, { exit: 1 }] });
add("out: exit 53 (turn budget)", { actions: [{ result: "turns", is_error: true }, { exit: 53 }] });
add("out: no json at all", { actions: [{ stdout: "plain text\n" }, ...GOOD.slice(0, 3)] });
add("out: truncated json", { actions: [{ stdout: '[{"type":"result","result":"x' }, ...GOOD.slice(0, 3)] });
add("out: result non-string", { actions: [...GOOD.slice(0, 3), { result: { a: 1, b: [1, 2.0, "é"] } }] });
add("out: result unicode", { actions: [...GOOD.slice(0, 3), { result: "完成 😀" }] });
add("out: huge stdout 6MB", { actions: [{ big_stdout: 6 << 20 }, ...GOOD] });
add("out: huge stderr 6MB", { actions: [{ big_stderr: 6 << 20 }, ...GOOD] });
add("out: huge stderr + stdout interleaved", { actions: [{ big_stderr: 2 << 20 }, { big_stdout: 2 << 20 }, { big_stderr: 2 << 20 }, ...GOOD] });
add("out: invalid utf-8 stdout", { actions: [{ stdout: "\ufffd" }, ...GOOD] });
add("out: session_id in result", { actions: GOOD, scenario: { session_id: "11111111-2222-3333-4444-555555555555" } });
add("out: multiple result messages", { actions: [...GOOD.slice(0, 3), { stdout: '[{"type":"result","result":"first","is_error":false},{"type":"result","result":"second","is_error":true}]\n' }] });
add("out: result is_error truthy string", { actions: [...GOOD.slice(0, 3), { stdout: '[{"type":"result","result":"x","is_error":"yes"}]\n' }] });
add("out: json object (not array)", { actions: [...GOOD.slice(0, 3), { stdout: '{"type":"result","result":"obj"}\n' }] });
add("out: killed by SIGKILL", { actions: [...GOOD.slice(0, 3), { kill_self: "SIGKILL" }] });
add("out: killed by SIGSEGV", { actions: [...GOOD.slice(0, 3), { kill_self: "SIGSEGV" }] });
add("out: exit 255", { actions: [...GOOD.slice(0, 3), { exit: 255 }] });
add("out: exit 130", { actions: [...GOOD.slice(0, 3), { exit: 130 }] });
add("out: reject stream then json (non-tty -> json already)", { actions: [{ reject_stream: true }, ...GOOD] });

// ---- timeouts / process tree ---------------------------------------------------------------------------------------------
add("timeout: hang -> killed", { actions: [{ sleep: 60 }], env: { EBX_QWEN_CODEGEN_TIMEOUT: "2" } });
add("timeout: hang with grandchild -> tree reaped", { actions: [{ spawn_bg: { sleep: 300, pidfile: "bg.pid" } }, { sleep: 60 }], env: { EBX_QWEN_CODEGEN_TIMEOUT: "2" }, postCheck: "bg" });
add("timeout: ignores SIGTERM -> SIGKILL escalation", { actions: [{ ignore_term: true }, { sleep: 60 }], env: { EBX_QWEN_CODEGEN_TIMEOUT: "2" } });
add("timeout: ignores SIGTERM with grandchild", { actions: [{ ignore_term: true }, { spawn_bg: { sleep: 300, pidfile: "bg.pid" } }, { sleep: 60 }], env: { EBX_QWEN_CODEGEN_TIMEOUT: "2" }, postCheck: "bg" });
add("timeout: fractional 1.5", { actions: [{ sleep: 60 }], env: { EBX_QWEN_CODEGEN_TIMEOUT: "1.5" } });
add("timeout: finishes just in time", { actions: [{ sleep: 1 }, ...GOOD], env: { EBX_QWEN_CODEGEN_TIMEOUT: "6" } });
add("timeout: grandchild outlives successful run", { actions: [{ spawn_bg: { sleep: 300, pidfile: "bg.pid" } }, ...GOOD], postCheck: "bg" });
add("timeout: output then hang", { actions: [...GOOD, { sleep: 60 }], env: { EBX_QWEN_CODEGEN_TIMEOUT: "2" } });

// ---- what the agent writes into staging ------------------------------------------------------------------------------------
add("agent: extra files only reported (not applied)", { actions: [{ write: "README.md", content: "x" }, { write: "notes/a.txt", content: "y" }, ...GOOD] });
add("agent: modifies project file in staging", { actions: [{ write: "app.py", content: "print('changed')\n" }, ...GOOD] });
add("agent: deletes project file in staging", { actions: [{ rm: "app.py" }, ...GOOD], files: { ...APP, "app/other.py": "o\n" } });
add("agent: writes .dockerignore (not applied)", { actions: [{ write: ".dockerignore", content: "*.py\n" }, ...GOOD] });
add("agent: writes .dockerignore excluding wheel", { actions: [{ write: ".dockerignore", content: "*.whl\n" }, ...GOOD] });
add("agent: hidden dir changes ignored in snapshot", { actions: [{ write: ".qwen/state.json", content: "{}" }, ...GOOD] });
add("agent: extra file in hidden dir + normal", { actions: [{ write: ".hidden/x.txt", content: "h" }, { write: "vis/y.txt", content: "v" }, ...GOOD] });
add("agent: symlink extra file (skipped in snapshot)", { actions: [{ symlink: "lnk", target: "/etc/hostname" }, ...GOOD] });
add("agent: Dockerfile is symlink to outside", { actions: [{ symlink: "Dockerfile", target: "{home}/outside-Dockerfile" }, { write: "commands.py", content: COMMANDS }, { write: "template.yaml", content: TEMPLATE }, { result: "x" }], homeFiles: { "outside-Dockerfile": DOCKERFILE } });
add("agent: Dockerfile symlink to staged file", { actions: [{ write: "real.Dockerfile", content: DOCKERFILE }, { symlink: "Dockerfile", target: "real.Dockerfile" }, { write: "commands.py", content: COMMANDS }, { write: "template.yaml", content: TEMPLATE }, { result: "x" }] });
add("agent: dangling Dockerfile symlink", { actions: [{ symlink: "Dockerfile", target: "/nonexistent/x" }, { write: "commands.py", content: COMMANDS }, { write: "template.yaml", content: TEMPLATE }, { result: "x" }] });
add("agent: template.yaml symlink to secret", { actions: [{ write: "Dockerfile", content: DOCKERFILE }, { write: "commands.py", content: COMMANDS }, { symlink: "template.yaml", target: "{home}/.ebx/config.toml" }, { result: "x" }] });
add("agent: Dockerfile is a directory", { actions: [{ mkdir: "Dockerfile" }, { write: "commands.py", content: COMMANDS }, { write: "template.yaml", content: TEMPLATE }, { result: "x" }] });
add("agent: staging dir replaced by symlink dir (writes through)", { actions: [{ symlink: "sub", target: "{home}" }, { write: "sub/leak.txt", content: "leak" }, ...GOOD] });
add("agent: writes outside staging via ..", { actions: [{ write: "../escape.txt", content: "esc" }, ...GOOD] });
add("agent: writes into project via absolute path", { actions: [{ write: "{work}/app/injected.py", content: "evil" }, ...GOOD] });
add("agent: overwrites project's Dockerfile path directly", { actions: [{ write: "{work}/app/Dockerfile", content: "FROM evil\n" }, ...GOOD] });
add("agent: Dockerfile missing", { actions: [{ write: "commands.py", content: COMMANDS }, { write: "template.yaml", content: TEMPLATE }, { result: "x" }] });
add("agent: commands.py missing", { actions: [{ write: "Dockerfile", content: DOCKERFILE }, { write: "template.yaml", content: TEMPLATE }, { result: "x" }] });
add("agent: template.yaml missing", { actions: [{ write: "Dockerfile", content: DOCKERFILE }, { write: "commands.py", content: COMMANDS }, { result: "x" }] });
add("agent: Dockerfile no FROM", { actions: good({ write: "Dockerfile", content: "RUN echo\nEXPOSE 9000\nCOPY commands.py /\n" }) });
add("agent: Dockerfile FROM in comment only", { actions: good({ write: "Dockerfile", content: "# FROM x\nEXPOSE 9000\nCOPY commands.py /\n" }) });
add("agent: Dockerfile lowercase from", { actions: good({ write: "Dockerfile", content: "from python\nEXPOSE 9000\nCOPY commands.py app.py /\n" }) });
add("agent: Dockerfile no EXPOSE 9000", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py commands.py /\n" }) });
add("agent: Dockerfile EXPOSE 9000/tcp", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py commands.py /\nEXPOSE 9000/tcp\n" }) });
add("agent: Dockerfile EXPOSE 9000/udp", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py commands.py /\nEXPOSE 9000/udp 8080\n" }) });
add("agent: Dockerfile EXPOSE ${PORT}", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py commands.py /\nEXPOSE ${PORT}\n" }) });
add("agent: Dockerfile EXPOSE unicode digits", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py commands.py /\nEXPOSE \u0669\u0660\u0660\u0660 9000\n" }) });
add("agent: Dockerfile EXPOSE in indented line", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py commands.py /\n   expose 9000\n" }) });
add("agent: Dockerfile EXPOSE continued line", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py commands.py /\nEXPOSE 8080 \\\n  9000\n" }) });
add("agent: Dockerfile no commands.py ref", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py /\nEXPOSE 9000\n" }) });
add("agent: COPY missing file", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY nope.py commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY escapes ..", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY ../x commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY absolute", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY /etc/passwd commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY backslash path", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY sub\\x commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY dir", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY src/ /app/src/\nCOPY commands.py /\nEXPOSE 9000\n" }), files: { "app/src/m.py": "m\n" } });
add("agent: COPY dot-slash", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY ./app.py ././commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY . .", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY . .\nCOPY commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY --from=stage", { actions: good({ write: "Dockerfile", content: "FROM python AS b\nFROM python\nCOPY --from=b /x /y\nCOPY commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY --chown flag", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY --chown=1:1 app.py commands.py /app/\nEXPOSE 9000\n" }) });
add("agent: COPY json form", { actions: good({ write: "Dockerfile", content: 'FROM python\nCOPY ["app.py", "commands.py", "/app/"]\nEXPOSE 9000\n' }) });
add("agent: COPY json form with spaces in name", { actions: good({ write: "Dockerfile", content: 'FROM python\nCOPY ["my file.txt", "commands.py", "/app/"]\nEXPOSE 9000\n' }), files: { "app/my file.txt": "t\n" } });
add("agent: COPY variable", { actions: good({ write: "Dockerfile", content: "FROM python\nARG F=a\nCOPY $F commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY glob", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY *.py /\nCOPY commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY heredoc", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY <<EOF /x\nhi\nEOF\nCOPY commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY line continuation + comment lines", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py \\\n # c\n commands.py /\nEXPOSE 9000\n" }) });
add("agent: COPY secret-named file excluded by generated ignore", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY .env commands.py /\nEXPOSE 9000\n" }), files: { ...APP, "app/.env": "A=1\n" } });
add("agent: COPY file excluded by user dockerignore", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY app.py commands.py /\nEXPOSE 9000\n" }), files: { ...APP, "app/.dockerignore": "app.py\n**/.env\n" } });
add("agent: COPY symlink in project", { actions: good({ write: "Dockerfile", content: "FROM python\nCOPY lnk commands.py /\nEXPOSE 9000\n" }), files: { ...APP }, symlinks: [["app/lnk", "{work}/app/app.py"]] });
add("agent: COPY uppercase", { actions: good({ write: "Dockerfile", content: "FROM python\nCoPy app.py commands.py /\nEXPOSE 9000\n" }) });
add("agent: Dockerfile CRLF", { actions: good({ write: "Dockerfile", content: DOCKERFILE.replace(/\n/g, "\r\n") }) });
add("agent: Dockerfile BOM", { actions: good({ write: "Dockerfile", content: `\ufeff${DOCKERFILE}` }) });
add("agent: Dockerfile NUL", { actions: good({ write: "Dockerfile", content: `${DOCKERFILE}\u0000` }) });
add("agent: Dockerfile invalid utf8", { actions: [{ write_bytes: "Dockerfile", hex: Buffer.from(DOCKERFILE).toString("hex") + "ff" }, GOOD[1], GOOD[2], GOOD[3]] });
add("agent: Dockerfile huge (3MB)", { actions: good({ write: "Dockerfile", content: `${DOCKERFILE}# ${"x".repeat(3 << 20)}\n` }) });
add("agent: commands.py syntax error", { actions: good({ write: "commands.py", content: "def (:\n" }) });
add("agent: commands.py no server import", { actions: good({ write: "commands.py", content: "print(1)\n" }) });
add("agent: commands.py import but no serve", { actions: good({ write: "commands.py", content: "import easy_sandbox.server\n" }) });
add("agent: commands.py start( only", { actions: good({ write: "commands.py", content: "import easy_sandbox.server as s\ns.start (9000)\n" }) });
add("agent: commands.py server in comment", { actions: good({ write: "commands.py", content: "# easy_sandbox.server .serve(\n" }) });
add("agent: commands.py py2 print", { actions: good({ write: "commands.py", content: "print 'x'\n# easy_sandbox.server .serve(\n" }) });
add("agent: commands.py null byte", { actions: good({ write: "commands.py", content: `${COMMANDS}\u0000` }) });
add("agent: commands.py BOM", { actions: good({ write: "commands.py", content: `\ufeff${COMMANDS}` }) });
add("agent: commands.py latin1 coding cookie", { actions: [GOOD[0], { write_bytes: "commands.py", hex: Buffer.from("# -*- coding: latin-1 -*-\nfrom easy_sandbox.server import S\nS().serve(1)\nx = '\u00e9'\n", "latin1").toString("hex") }, GOOD[2], GOOD[3]] });
add("agent: commands.py deep nesting", { actions: good({ write: "commands.py", content: `${COMMANDS}x = ${"(".repeat(300)}1${")".repeat(300)}\n` }) });
add("agent: commands.py deep nesting 5000", { actions: good({ write: "commands.py", content: `${COMMANDS}x = ${"[".repeat(5000)}${"]".repeat(5000)}\n` }) });
add("agent: commands.py crlf", { actions: good({ write: "commands.py", content: COMMANDS.replace(/\n/g, "\r\n") }) });
add("agent: commands.py form feed / unicode ident", { actions: good({ write: "commands.py", content: `${COMMANDS}\u00e9 = 1\n\f\n` }) });
add("agent: commands.py invalid utf8 (default coding)", { actions: [GOOD[0], { write_bytes: "commands.py", hex: Buffer.from(COMMANDS).toString("hex") + "23ff0a" }, GOOD[2], GOOD[3]] });

// template.yaml content
for (const [n, y] of Object.entries({
  "not a mapping": "- a\n- b\n",
  "scalar": "just a string\n",
  "empty": "",
  "invalid yaml": "a: [\n",
  "ports string": 'name: x\nversion: "1"\ndescription: d\nports: "9000"\n',
  "ports missing 9000": 'name: x\nversion: "1"\ndescription: d\nports: [8080]\n',
  "ports with extra": 'name: x\nversion: "1"\ndescription: d\nports: [9000, 8080]\n',
  "ports extra, expose lacks it": 'name: x\nversion: "1"\ndescription: d\nports: [9000, 7000]\n',
  "ports floats": 'name: x\nversion: "1"\ndescription: d\nports: [9000.0]\n',
  "ports bool": 'name: x\nversion: "1"\ndescription: d\nports: [true, 9000]\n',
  "ports str numeric": 'name: x\nversion: "1"\ndescription: d\nports: ["9000"]\n',
  "ports null": 'name: x\nversion: "1"\ndescription: d\nports:\n',
  "ports dict": 'name: x\nversion: "1"\ndescription: d\nports: {a: 1}\n',
  "name overridden": 'name: Totally Different!\nversion: "1"\ndescription: d\nports: [9000]\n',
  "name list": "name: [a]\nversion: '1'\ndescription: d\nports: [9000]\n",
  "bad resources": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\nresources: {cpu: abc}\n',
  "resources negative": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\nresources: {cpu: -1, memory: -5}\n',
  "unknown fields": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\nsurprise: 1\nnested: {a: [1, 2.0, null]}\n',
  "anchors/merge": 'base: &b {cpu: 1}\nname: x\nversion: "1"\ndescription: d\nports: [9000]\nresources: {<<: *b, memory: 512}\n',
  "python tag": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\nz: !!python/object/apply:os.system ["echo pwn"]\n',
  "unknown tag": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\nz: !foo bar\n',
  "dup keys": 'name: x\nname: y\nversion: "1"\ndescription: d\nports: [9000]\n',
  "tab indent": 'name: x\nresources:\n\tcpu: 1\nports: [9000]\n',
  "yaml 1.1 bools": 'name: x\nversion: "1"\ndescription: yes\nports: [9000]\nflag: no\nz: on\nq: off\nn: ~\n',
  "yaml numbers": 'name: x\nversion: 1.10\ndescription: 0o17\nports: [9000]\nh: 0x1F\ne: 1e3\nu: 1_000\nsx: 190:20:30\nd: 2026-01-01\nts: 2026-01-01 10:00:00\n',
  "version number": "name: x\nversion: 1.0\ndescription: d\nports: [9000]\n",
  "unicode": 'name: x\nversion: "1"\ndescription: "模板 😀 é"\nports: [9000]\n',
  "multiline description": 'name: x\nversion: "1"\ndescription: |\n  line1\n  line2\nports: [9000]\n',
  "long strings": `name: x\nversion: "1"\ndescription: ${"word ".repeat(60)}\nports: [9000]\n`,
  "special strings": 'name: x\nversion: "1"\ndescription: "a: b # c"\nports: [9000]\nq: "yes"\nz: "1e3"\nw: "null"\nv: " lead"\n',
  "env block": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\nenv:\n  A: "1"\n  B: 2\n  C: true\n',
  "key order": 'ports: [9000]\ndescription: d\nzeta: 1\nalpha: 2\nname: x\nversion: "1"\n',
  "big int": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\nbig: 123456789012345678901234567890\n',
  "float": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\nf: 1.0\ng: 1e22\nh: .5\ni: 1.5e-7\nj: 100000000000000000.0\nk: .inf\nl: .nan\n',
  "empty value": 'name: x\nversion: "1"\ndescription:\nports: [9000]\n',
  "flow styles": 'name: x\nversion: "1"\ndescription: {a: b}\nports: [9000]\nz: [[1], {c: d}]\n',
  "complex key": '? [a, b]\n: v\nname: x\nports: [9000]\n',
  "bom": '\ufeffname: x\nversion: "1"\ndescription: d\nports: [9000]\n',
  "crlf": 'name: x\r\nversion: "1"\r\ndescription: d\r\nports: [9000]\r\n',
  "document markers": '---\nname: x\nversion: "1"\ndescription: d\nports: [9000]\n...\n',
  "two documents": '---\nname: x\nports: [9000]\n---\nname: y\n',
  "nul": 'name: x\u0000\nports: [9000]\n',
  "set tag": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\ns: !!set {a, b}\n',
  "omap tag": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\ns: !!omap [a: 1, b: 2]\n',
  "binary tag": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\ns: !!binary aGVsbG8=\n',
  "timestamp tz": 'name: x\nversion: "1"\ndescription: d\nports: [9000]\nt: 2026-01-01T10:00:00+08:00\n',
  "deep nesting": `name: x\nports: [9000]\nz: ${"[".repeat(200)}${"]".repeat(200)}\n`,
  "large": `name: x\nversion: "1"\ndescription: d\nports: [9000]\n${Array.from({ length: 5000 }, (_, i) => `k${i}: ${i}`).join("\n")}\n`,
})) {
  const usesExpose = /7000/.test(y) ? 'FROM python\nCOPY app.py commands.py /\nEXPOSE 9000\n' : DOCKERFILE;
  add(`yaml: ${n}`, { actions: good({ write: "template.yaml", content: y }, { write: "Dockerfile", content: usesExpose }) });
}
add("yaml: invalid utf-8", { actions: [GOOD[0], GOOD[1], { write_bytes: "template.yaml", hex: Buffer.from(TEMPLATE).toString("hex") + "ff" }, GOOD[3]] });

// ---- project side ----------------------------------------------------------------------------------------------------------
const DRY = ["template", "init", "--adopt", "{work}/app", "--dry-run", "--name", "demo"];
const pd = (name, files, rest = {}) => add(name, { files: Object.fromEntries(Object.entries(files).map(([k, v]) => [`app/${k}`, v])), argv: DRY, ...rest });
for (const [n, f] of Object.entries({
  ".env": ".env", ".ENV": ".ENV", ".env.local": ".env.local", ".env.example": ".env.example", ".env.sample": ".env.sample", ".env.template": ".env.template", ".env.EXAMPLE": ".env.EXAMPLE", ".env.prod.example": ".env.prod.example", "env": "env", "x.pem": "x.pem", "X.PEM": "X.PEM", "k.key": "k.key", "a.p12": "a.p12", "a.pfx": "a.pfx", "t.tfvars": "t.tfvars", "t.tfstate": "t.tfstate", "t.tfstate.backup": "t.tfstate.backup", "a.tfstate.d": "a.tfstate.d", "kubeconfig": "kubeconfig", "kubeconfig.yaml": "kubeconfig.yaml", "KubeConfig": "KubeConfig", "id_rsa": "id_rsa", "id_rsa.pub": "id_rsa.pub", "id_ed25519": "id_ed25519", "id_ed25519.pub": "id_ed25519.pub", ".npmrc": ".npmrc", ".pypirc": ".pypirc", ".netrc": ".netrc", ".git-credentials": ".git-credentials", "credentials": "credentials", "credentials.json": "credentials.json", "Credentials.json": "Credentials.json", "secrets": "secrets", "secrets.yaml": "secrets.yaml", "Secrets.yaml": "Secrets.yaml", "secret.txt": "secret.txt", "mysecrets.txt": "mysecrets.txt", "sub/.env": "sub/.env", "sub/deep/id_rsa": "sub/deep/id_rsa", "config.pem.txt": "config.pem.txt", "a.key.bak": "a.key.bak", ".envrc": ".envrc", "env.local": "env.local", ".ENV.LOCAL": ".ENV.LOCAL", "É.pem": "É.pem",
})) pd(`proj: name ${n}`, { "app.py": "x\n", [f]: "A=1\n" });
for (const [n, c] of Object.entries({
  "private key": "-----BEGIN RSA " + "PRIVATE KEY-----\nabc\n",
  "private key bare": "-----BEGIN " + "PRIVATE KEY-----\n",
  "private key openssh": "-----BEGIN OPENSSH " + "PRIVATE KEY-----\n",
  "public key ok": "-----BEGIN PUBLIC KEY-----\n",
  "LTAI": `key = ${LT}abcdefgh12345\n`,
  "LTAI short": `${LT}abc\n`,
  "AKIA": `${AK}ABCDEFGHIJKLMNOP\n`,
  "AKIA lower": `${AK.toLowerCase()}abcdefghijklmnop\n`,
  "AKIA 17": `${AK}ABCDEFGHIJKLMNOPQ\n`,
  "sk-": `${SK}abcdefghijklmnopqrstuvwxyz\n`,
  "sk- short": `${SK}abc\n`,
  "ghp": "gh" + "p_abcdefghijklmnopqrstuvwxyz0123\n",
  "github_pat": "github_pat_abcdefghijklmnopqrstu\n",
  "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk\n",
  "password quoted": "password = 'supersecret1'\n",
  "PASSWORD upper": "PASSWORD: \"supersecret1\"\n",
  "token short": "token = 'abc'\n",
  "secret double": 'secret="abcdefgh"\n',
  "password unquoted": "password = supersecret1\n",
  "password beyond 64KiB": `${"a".repeat(70000)}\npassword = 'supersecret1'\n`,
  "secret at 64KiB boundary": `${"a".repeat(65536 - 30)}\npassword = 'supersecret1'\n`,
  "secret split at boundary": `${"a".repeat(65536 - 8)}${LT}abcdefgh12345\n`,
  "multibyte before secret": `${"é".repeat(40000)}\n${LT}abcdefgh12345\n`,
  "invalid utf8 then secret": `\xff\xfe ${LT}abcdefgh12345\n`,
  "secret in binary-looking": `${LT}abcdefgh12345\u0000bin`,
  "wordboundary": `x${LT}abcdefgh12345\n`,
  "underscore boundary": `_${LT}abcdefgh12345\n`,
  "unicode letter boundary": `é${LT}abcdefgh12345\n`,
})) pd(`proj: content ${n}`, { "app.py": "x\n", "c.txt": Buffer.from(c, "latin1") });
pd("proj: NUL after 8192 bytes (not binary)", { "app.py": "x\n", "b.txt": `${"a".repeat(8192)}\u0000` });
pd("proj: NUL at 8191", { "app.py": "x\n", "b.txt": `${"a".repeat(8191)}\u0000` });
pd("proj: exactly 1MiB", { "app.py": "x\n", "big.txt": "a".repeat(1 << 20) });
pd("proj: 1MiB + 1", { "app.py": "x\n", "big.txt": "a".repeat((1 << 20) + 1) });
pd("proj: 2000 files", Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`f${i}.txt`, "x"])));
pd("proj: 2001 files", Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`f${i}.txt`, "x"])));
pd("proj: 20MiB exactly", Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`b${i}.txt`, "a".repeat(1 << 20)])));
pd("proj: 20MiB + 1", { ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`b${i}.txt`, "a".repeat(1 << 20)])), "x.txt": "a" });
pd("proj: excluded files don't count toward limit", { ...Object.fromEntries(Array.from({ length: 2100 }, (_, i) => [`node_modules/f${i}.txt`, "x"])), "app.py": "x" });
for (const d of [".git", "node_modules", ".venv", "venv", "__pycache__", ".tox", ".mypy_cache", "dist", "build", "target", ".next", ".idea", ".vscode", "Dist", "BUILD", "sub/node_modules", ".github", ".cache", "vendor", "env", ".env"]) pd(`proj: dir ${d}`, { "app.py": "x\n", [`${d}/f.txt`]: "y\n" });
pd("proj: symlinked file", { "app.py": "x\n" }, { symlinks: [["app/lnk.py", "{work}/app/app.py"], ["app/dangling", "/nonexistent"], ["app/outside", "/etc/hostname"]] });
pd("proj: symlinked dir", { "app.py": "x\n", "real/f.txt": "y\n" }, { symlinks: [["app/linkdir", "{work}/app/real"], ["app/loop", "{work}/app"]] });
pd("proj: symlink named like skip dir", { "app.py": "x\n" }, { symlinks: [["app/node_modules", "/tmp"]] });
pd("proj: unreadable file", { "app.py": "x\n", "secret.dat": "d\n" }, { modes: { "app/secret.dat": 0o000 } });
pd("proj: unreadable dir", { "app.py": "x\n", "d/f.txt": "d\n" }, { modes: { "app/d": 0o000 } });
pd("proj: empty files and dirs", { "app.py": "", "e/.keep": "" });
pd("proj: hidden files", { ".hidden": "h\n", ".a/.b/c": "c\n", "app.py": "x\n" });
pd("proj: case-colliding names", { "A.py": "a\n", "a.py": "b\n" });
pd("proj: unicode normalisation names", { "caf\u00e9.py": "nfc\n", "cafe\u0301.py": "nfd\n" });
pd("proj: reserved files present (dry run)", { "app.py": "x\n", Dockerfile: "FROM x\n", "commands.py": "print(1)\n", "template.yaml": "name: a\n", ".dockerignore": "x\n" });
pd("proj: sorted order of listing", { "b.py": "1", "a.py": "1", "B.py": "1", "10.py": "1", "2.py": "1", "sub/z.py": "1", "sub/a.py": "1", "é.py": "1", "Z.py": "1", "_u.py": "1", "-d.py": "1" });
pd("proj: listing json bytes", { "app.py": "x\n", ".env": "A=1\n", "k.pem": "k\n", "img.bin": "\u0000\u0001" });
pd("proj: dockerignore excluding (ignored reason)", { "app.py": "x\n", "skip.txt": "s\n", "keep.txt": "k\n", ".dockerignore": "skip.txt\n**/.env\n**/*.pem\n" });
pd("proj: dockerignore secret not excluded", { "app.py": "x\n", ".env": "A=1\n", ".dockerignore": "skip\n" });
pd("proj: Dockerfile.dockerignore variant", { "app.py": "x\n", ".env": "A=1\n", "Dockerfile.dockerignore": "**/.env\n" });
pd("proj: dockerignore negation re-includes secret", { "app.py": "x\n", ".env": "A=1\n", ".dockerignore": "**/.env\n!.env\n" });
pd("proj: dockerignore bare .env only root", { "app.py": "x\n", "sub/.env": "A=1\n", ".dockerignore": ".env\n" });
pd("proj: dockerignore excludes whl", { "app.py": "x\n", ".dockerignore": "*.whl\n**/.env\n" });
pd("proj: dockerignore excludes **", { "app.py": "x\n", ".dockerignore": "**\n" });
pd("proj: dockerignore crlf", { "app.py": "x\n", ".env": "A=1\n", ".dockerignore": "**/.env\r\n" });
pd("proj: dockerignore bom", { "app.py": "x\n", ".env": "A=1\n", ".dockerignore": "\ufeff**/.env\n" });
pd("proj: dockerignore comment + trailing spaces", { "app.py": "x\n", ".env": "A=1\n", ".dockerignore": "# c\n**/.env   \n  \n" });
pd("proj: dockerignore invalid utf8", { "app.py": "x\n", ".dockerignore": Buffer.from([0xff, 0x0a]) });
pd("proj: dockerignore is a dir", { "app.py": "x\n", ".dockerignore/x": "1" });
pd("proj: dockerignore bad pattern", { "app.py": "x\n", ".dockerignore": "[\n!\n**/.env\n" });

// reserved-file policy (real runs)
const R = (name, files, rest = {}) => add(name, { files: Object.fromEntries(Object.entries(files).map(([k, v]) => [`app/${k}`, v])), ...rest });
R("reserved: template.yaml exists", { "app.py": "x\n", "template.yaml": "name: a\n" });
R("reserved: template.yaml exists --force", { "app.py": "x\n", "template.yaml": "name: a\n" }, { argv: [...ARGV, "--force"] });
R("reserved: Dockerfile exists non-interactive", { "app.py": "x\n", Dockerfile: "FROM old\n" });
R("reserved: Dockerfile exists --force (backup)", { "app.py": "x\n", Dockerfile: "FROM old\n" }, { argv: [...ARGV, "--force"] });
R("reserved: backups exist -> numbering", { "app.py": "x\n", Dockerfile: "FROM old\n", "Dockerfile.ebx-bak": "b0", "Dockerfile.ebx-bak.1": "b1" }, { argv: [...ARGV, "--force"] });
R("reserved: commands.py user-owned", { "app.py": "x\n", "commands.py": "print(1)\n" });
R("reserved: commands.py user-owned --force", { "app.py": "x\n", "commands.py": "print(1)\n" }, { argv: [...ARGV, "--force"] });
R("reserved: commands.py server-owned (needs force non-tty)", { "app.py": "x\n", "commands.py": COMMANDS });
R("reserved: commands.py server-owned --force", { "app.py": "x\n", "commands.py": COMMANDS }, { argv: [...ARGV, "--force"] });
R("reserved: all four --force", { "app.py": "x\n", Dockerfile: "FROM old\n", "commands.py": "print(1)\n", "template.yaml": "name: a\n", ".dockerignore": "**/.env\n" }, { argv: [...ARGV, "--force"] });
R("reserved: .dockerignore exists (kept)", { "app.py": "x\n", ".dockerignore": "**/.env\n**/*.pem\n" });
R("reserved: .dockerignore generated written", { "app.py": "x\n" });
R("reserved: Dockerfile is symlink", { "app.py": "x\n" }, { symlinks: [["app/Dockerfile", "{work}/app/app.py"]] });
R("reserved: Dockerfile dangling symlink --force", { "app.py": "x\n" }, { symlinks: [["app/Dockerfile", "/nonexistent"]], argv: [...ARGV, "--force"] });
R("reserved: template.yaml symlink", { "app.py": "x\n" }, { symlinks: [["app/template.yaml", "{work}/app/app.py"]], argv: [...ARGV, "--force"] });
R("reserved: commands.py symlink", { "app.py": "x\n" }, { symlinks: [["app/commands.py", "{work}/app/app.py"]] });
R("reserved: .dockerignore symlink", { "app.py": "x\n" }, { symlinks: [["app/.dockerignore", "{work}/app/app.py"]] });
R("reserved: Dockerfile is a directory", { "app.py": "x\n", "Dockerfile/x": "1" });
R("reserved: commands.py is a directory", { "app.py": "x\n", "commands.py/x": "1" });
R("reserved: .dockerignore is a directory", { "app.py": "x\n", ".dockerignore/x": "1" });
R("reserved: Dockerfile unreadable", { "app.py": "x\n", Dockerfile: "FROM x\n" }, { modes: { "app/Dockerfile": 0o000 }, argv: [...ARGV, "--force"] });
R("reserved: commands.py invalid utf8", { "app.py": "x\n", "commands.py": Buffer.from([0xff, 0xfe]) });
R("reserved: project dir read-only (promote fails)", { "app.py": "x\n" }, { modes: { app: 0o555 } });
R("reserved: existing file read-only --force", { "app.py": "x\n", Dockerfile: "FROM old\n" }, { argv: [...ARGV, "--force"], modes: { "app/Dockerfile": 0o444 } });
R("reserved: existing file mode preserved?", { "app.py": "x\n", Dockerfile: "FROM old\n" }, { argv: [...ARGV, "--force"], modes: { "app/Dockerfile": 0o600 } });
R("reserved: .ebx-tmp leftover present", { "app.py": "x\n", "Dockerfile.ebx-tmp": "stale" });
R("reserved: Dockerfile.ebx-tmp is dir", { "app.py": "x\n", "Dockerfile.ebx-tmp/x": "1" });
R("reserved: drift (agent rewrites project Dockerfile)", { "app.py": "x\n", Dockerfile: "FROM old\n" }, { argv: [...ARGV, "--force"], actions: [{ write: "{work}/app/Dockerfile", content: "FROM drift\n" }, ...GOOD] });
R("reserved: drift (agent creates project Dockerfile)", { "app.py": "x\n" }, { actions: [{ write: "{work}/app/Dockerfile", content: "FROM drift\n" }, ...GOOD] });
R("reserved: drift (agent deletes project Dockerfile)", { "app.py": "x\n", Dockerfile: "FROM old\n" }, { argv: [...ARGV, "--force"], actions: [{ rm: "{work}/app/Dockerfile" }, ...GOOD] });
R("reserved: drift (agent symlinks project Dockerfile)", { "app.py": "x\n", Dockerfile: "FROM old\n" }, { argv: [...ARGV, "--force"], actions: [{ rm: "{work}/app/Dockerfile" }, { symlink: "{work}/app/Dockerfile", target: "/etc/hostname" }, ...GOOD] });
R("reserved: drift (agent creates .dockerignore)", { "app.py": "x\n" }, { actions: [{ write: "{work}/app/.dockerignore", content: "x\n" }, ...GOOD] });
R("reserved: drift (agent swaps project dir for symlink)", { "app.py": "x\n" }, { actions: [{ write: "{work}/app/new.txt", content: "n" }, ...GOOD] });

// target directory / name handling
const T = (name, argv, files = APP, rest = {}) => add(name, { argv, files, ...rest });
T("target: file instead of dir", ["template", "init", "--adopt", "{work}/app/app.py", "-y"]);
T("target: missing", ["template", "init", "--adopt", "{work}/nope", "-y"]);
T("target: root", ["template", "init", "--adopt", "/", "-y", "--name", "x"]);
T("target: home", ["template", "init", "--adopt", "{home}", "-y", "--name", "x"]);
T("target: home via ~", ["template", "init", "--adopt", "~", "-y", "--name", "x"]);
T("target: ~/.ebx", ["template", "init", "--adopt", "{home}/.ebx", "-y", "--name", "x"], APP, { homeFiles: { ".ebx/config.toml": "x" } });
T("target: inside ~/.ebx", ["template", "init", "--adopt", "{home}/.ebx/sub", "-y", "--name", "x"], APP, { homeFiles: { ".ebx/sub/f.txt": "x" } });
T("target: symlink to ~/.ebx", ["template", "init", "--adopt", "{work}/lnk", "-y", "--name", "x"], APP, { homeFiles: { ".ebx/f.txt": "x" }, symlinks: [["lnk", "{home}/.ebx"]] });
T("target: symlink to home", ["template", "init", "--adopt", "{work}/lnk", "-y", "--name", "x"], APP, { symlinks: [["lnk", "{home}"]] });
T("target: symlink to project dir", ["template", "init", "--adopt", "{work}/lnk", "-y", "--name", "demo"], APP, { symlinks: [["lnk", "{work}/app"]] });
T("target: ~/.ebx-other not blocked", ["template", "init", "--adopt", "{home}/.ebx-other", "-y", "--name", "x"], APP, { homeFiles: { ".ebx-other/app.py": "x" } });
T("target: with .. segments", ["template", "init", "--adopt", "{work}/app/../app", "-y", "--name", "demo"]);
T("target: trailing slash", ["template", "init", "--adopt", "{work}/app/", "-y", "--name", "demo"]);
T("target: tilde expands", ["template", "init", "--adopt", "~/proj", "-y", "--name", "demo"], {}, { homeFiles: { "proj/app.py": "x" } });
T("target: tilde user form", ["template", "init", "--adopt", "~nobodyxyz/proj", "-y", "--name", "demo"]);
T("target: empty string", ["template", "init", "--adopt", "", "-y", "--name", "demo"]);
T("target: dash", ["template", "init", "--adopt", "-", "-y"]);
T("target: sentence (not dir)", ["template", "init", "--adopt", "build me a bot", "-y"]);
T("name: derived from unicode dir", ["template", "init", "--adopt", "{work}/模板", "-y"], { "模板/app.py": "x" });
T("name: derived upper/dots", ["template", "init", "--adopt", "{work}/My_App.v2", "-y"], { "My_App.v2/app.py": "x" });
T("name: derived long dir", ["template", "init", "--adopt", `{work}/${"a".repeat(100)}`, "-y"], { [`${"a".repeat(100)}/app.py`]: "x" });
T("name: derived long with hyphen at cut", ["template", "init", "--adopt", `{work}/${"a".repeat(63)}-bbbb`, "-y"], { [`${"a".repeat(63)}-bbbb/app.py`]: "x" });
T("name: derived leading digits/hyphens", ["template", "init", "--adopt", "{work}/--9x--", "-y"], { "--9x--/app.py": "x" });
T("name: derived empty slug (symbols)", ["template", "init", "--adopt", "{work}/___", "-y"], { "___/app.py": "x" });
T("name: derived dir named with space", ["template", "init", "--adopt", "{work}/my app", "-y"], { "my app/app.py": "x" });
T("name: derived fullwidth/accents", ["template", "init", "--adopt", "{work}/Ａpp-é", "-y"], { "Ａpp-é/app.py": "x" });
for (const nm of ["Bad", "bad_name", "-lead", "trail-", "a", "9", "a--b", "x".repeat(128), "x".repeat(129), "", " ", "a b", "é", "a.b", "ＡＢ", "a\n", "UP", "a-"]) T(`name: --name ${JSON.stringify(nm.length > 20 ? `${nm.slice(0, 5)}…(${nm.length})` : nm)}`, ["template", "init", "--adopt", "{work}/app", "-y", "--name", nm]);
T("name: -n short flag", ["template", "init", "--adopt", "{work}/app", "-y", "-n", "short"]);
T("name: name ignored in prompt? (hint with newlines)", ["template", "init", "--adopt", "{work}/app", "-y", "--name", "demo", "--hint", "a\nb\r\nc\u2028d"]);
T("name: hint empty", ["template", "init", "--adopt", "{work}/app", "-y", "--name", "demo", "--hint", ""]);
T("name: hint whitespace", ["template", "init", "--adopt", "{work}/app", "-y", "--name", "demo", "--hint", "   "]);
T("name: hint huge 100KB", ["template", "init", "--adopt", "{work}/app", "-y", "--name", "demo", "--hint", "h".repeat(100000)]);
T("flags: --dry-run with -y", ["template", "init", "--adopt", "{work}/app", "-y", "--dry-run", "--name", "demo"]);
T("flags: -y -y", ["template", "init", "--adopt", "{work}/app", "-y", "-y", "--name", "demo"]);
T("flags: --yes long", ["template", "init", "--adopt", "{work}/app", "--yes", "--name", "demo"]);
T("flags: top-level init shortcut", ["init", "--adopt", "{work}/app", "-y", "--name", "demo"]);
T("flags: adopt + --from", ["template", "init", "--adopt", "{work}/app", "--from", "x", "-y"]);
T("flags: adopt + --template", ["template", "init", "--adopt", "{work}/app", "--template", "python", "-y"]);
T("flags: adopt + extra positional", ["template", "init", "--adopt", "{work}/app", "extra", "-y"]);

// ---- driver --------------------------------------------------------------------------------------------------------------------
process.exit((await runSuite(cases, { title: "adv_agent_template_adopt" })) ? 1 : 0);

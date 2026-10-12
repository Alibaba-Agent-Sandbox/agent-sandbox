#!/usr/bin/env node
/**
 * Differential test of `cli/repl.py` helpers (`describe_command_failure`, `sanitize_text`, `program_name`) against the
 * original Python implementation, over hand-written and seeded-random exceptions (envd RPC errors with every
 * `envd_error` / `body_text` shape, httpx errors, SDK errors, builtins) and command lines.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/repl_failures.mjs [--seed N] [--count N] [--verbose]
 *
 * Exit code 0 = identical, 1 = differences, 2 = oracle missing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const argAfter = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
let seed = Number(argAfter("--seed", "11"));
const count = Number(argAfter("--count", "1500"));
const verbose = process.argv.includes("--verbose");

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("ORACLE_VENV must point to a venv with the original easy-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

const TEXTS = [
  "", "boom", "bash: sl: command not found", "bash: line 1: git: command not found", "sl: executable file not found", "not found: jq",
  'exec: "foo": executable file not found in $PATH', "exec not found", "executable file not found in $PATH", "command not found", "x: not found",
  "For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500", "Client error '500' for url 'https://sbx-1.example/envd'",
  "see https://a.b/c and http://d.e/f now", "multi\nline\ttext  with   gaps", "日本語エラー", "a".repeat(300), "word ".repeat(80), "'quoted'", '"dq" text',
  "connection to https://sbx-1.cn-hangzhou.e2b.fc.aliyuncs.com refused", "no such file or directory: /bin/zzz", "zsh: command not found: qq", "cd: no such file",
  "permission denied", "invalid argument: bad pid", "\u00a0nbsp\u2028sep", "tab\tonly",
];
const CMDS = ["", "ls -la", "sl -la", "cd /app", "export FOO=1", '"/usr/bin/ls" -la', "echo \"unclosed", "  spaced  cmd  x", "git status", "日本語 cmd", "a'b c", "python3 -c 'print(1)'", "FOO=1 env", "figma", "./run.sh", "/bin/zzz arg"];
const KNOWN = [[], ["ls", "cat"], ["ls", "cd", "git", "grep", "python3"], ["sl"], ["lss", "ls", "l"], ["git", "gti", "gut"], ["echo", "ech", "eco", "echoo"]];

const exc = () => {
  const r = rnd();
  const text = () => pick(TEXTS);
  if (r < 0.4) {
    const shape = pick(["error-msg", "error-code", "error-str", "top-msg", "empty", "none", "list", "bare-str", "nested-nonstr"]);
    let envd_error = null;
    if (shape === "error-msg") envd_error = { error: { code: 500, message: text() } };
    else if (shape === "error-code") envd_error = { error: { code: 3 } };
    else if (shape === "error-str") envd_error = { error: text() };
    else if (shape === "top-msg") envd_error = { message: text() };
    else if (shape === "empty") envd_error = {};
    else if (shape === "list") envd_error = { error: [text()] };
    else if (shape === "bare-str") envd_error = { details: text(), error: { message: "" } };
    else if (shape === "nested-nonstr") envd_error = { error: { message: 5 } };
    return { kind: "envd", message: text(), status_code: pick([0, 400, 404, 500, 502, 503]), rpc_path: pick(["", "/process.Process/Start"]), envd_error, body_text: pick(["", text(), text()]) };
  }
  if (r < 0.5) return { kind: "sdk", cls: pick(["CommandTimeoutError", "ConnectionError_", "SandboxError", "AuthenticationError", "ProcessError", "SandboxCreationError", "TemplateParseError"]), message: text() };
  if (r < 0.75) return { kind: "httpx", cls: pick(["ReadTimeout", "ConnectTimeout", "RemoteProtocolError", "LocalProtocolError", "ConnectError", "ReadError", "NetworkError", "HTTPError", "RequestError", "TransportError", "DecodingError"]), message: text() };
  if (r < 0.82) return { kind: "status", code: pick([400, 401, 404, 429, 500, 503]) };
  if (r < 0.9) return { kind: "builtin", cls: pick(["ValueError", "OSError", "TimeoutError"]), message: text() };
  return { kind: "envd", message: "x", status_code: 500, rpc_path: "", envd_error: { error: { message: 'exec: "' + pick(["sl", "cd", "export", "ls", "figma", "gti"]) + '": executable file not found in $PATH' } }, body_text: "" };
};

const failureCases = [];
for (let i = 0; i < count; i += 1) failureCases.push({ exc: exc(), command: pick(CMDS), known: pick(KNOWN), timeout: pick([30, 30, 5, 90]) });
const textCases = [...TEXTS, ...CMDS, "a  b\n\nc", "x https://y.z/w  ", " check: https://x ", "For more information check: ", "(see http://x)"];

const PY = String.raw`
import json, sys
import httpx
from easy_sandbox.cli.repl import describe_command_failure, program_name, sanitize_text
from easy_sandbox.models import errors as E

spec = json.load(open(sys.argv[1]))

def build(x):
    k = x["kind"]
    if k == "envd":
        return E.EnvdRpcError(x["message"], status_code=x["status_code"], rpc_path=x["rpc_path"], envd_error=x["envd_error"], body_text=x["body_text"])
    if k == "sdk":
        return getattr(E, x["cls"])(x["message"])
    if k == "httpx":
        return getattr(httpx, x["cls"])(x["message"])
    if k == "status":
        req = httpx.Request("POST", "https://sbx.example/x")
        return httpx.HTTPStatusError("Server error", request=req, response=httpx.Response(x["code"], request=req))
    return {"ValueError": ValueError, "OSError": OSError, "TimeoutError": TimeoutError}[x["cls"]](x["message"])

res = {"failures": [], "texts": []}
for c in spec["failures"]:
    try:
        f = describe_command_failure(build(c["exc"]), command=c["command"], timeout=c["timeout"], known_commands=c["known"])
        res["failures"].append([f.message, f.suggestion, f.code])
    except Exception as e:
        res["failures"].append("raised " + type(e).__name__ + ": " + str(e))
for t in spec["texts"]:
    try:
        res["texts"].append([sanitize_text(t), program_name(t)])
    except Exception as e:
        res["texts"].append("raised " + type(e).__name__ + ": " + str(e))
json.dump(res, sys.stdout)
`;

const TS = `
import { readFileSync } from "node:fs";
import { describeCommandFailure, programName, sanitizeText } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/cli/repl.ts")).href)};
import * as E from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/models/errors.ts")).href)};
import * as httpx from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/transport/_httpx.ts")).href)};
import { ValueError } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/framework/types.ts")).href)};
import { OSError } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/utils/_pyos.ts")).href)};
import { AsyncioTimeoutError as TimeoutError } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/transport/ws.ts")).href)};

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const build = (x) => {
  if (x.kind === "envd") return new E.EnvdRpcError(x.message, { status_code: x.status_code, rpc_path: x.rpc_path, envd_error: x.envd_error, body_text: x.body_text });
  if (x.kind === "sdk") return new E[x.cls](x.message);
  if (x.kind === "httpx") return new httpx[x.cls](x.message);
  if (x.kind === "status") {
    const request = new httpx.Request("POST", "https://sbx.example/x");
    return new httpx.HTTPStatusError("Server error", { request, response: new httpx.Response(x.code, { request }) });
  }
  return new ({ ValueError, OSError, TimeoutError }[x.cls])(x.message);
};
const res = { failures: [], texts: [] };
for (const c of spec.failures) {
  try {
    const f = describeCommandFailure(build(c.exc), { command: c.command, timeout: c.timeout, known_commands: c.known });
    res.failures.push([f.message, f.suggestion, f.code]);
  } catch (e) {
    res.failures.push("raised " + e.constructor.name + ": " + e.message);
  }
}
for (const t of spec.texts) {
  try {
    res.texts.push([sanitizeText(t), programName(t)]);
  } catch (e) {
    res.texts.push("raised " + e.constructor.name + ": " + e.message);
  }
}
process.stdout.write(JSON.stringify(res));
`;

const scratch = mkdtempSync(join(tmpdir(), "ebx-repl-"));
let failed = 0;
try {
  const specFile = join(scratch, "spec.json");
  writeFileSync(specFile, JSON.stringify({ failures: failureCases, texts: textCases }));
  const tsFile = join(scratch, "run.mts");
  writeFileSync(tsFile, TS);
  const tsx = pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href;
  const env = { PATH: process.env.PATH, HOME: scratch, EBX_NO_KEYCHAIN: "1", LANG: "C.UTF-8" };
  const py = spawnSync(join(ORACLE_VENV, "bin", "python"), ["-c", PY, specFile], { env, cwd: scratch, encoding: "utf8", maxBuffer: 1 << 28 });
  if (py.status !== 0) throw new Error(`oracle failed: ${py.stderr}`);
  const node = spawnSync(process.execPath, ["--import", tsx, tsFile, specFile], { env, cwd: CLI_ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  if (node.status !== 0) throw new Error(`node failed: ${node.stderr}`);
  const a = JSON.parse(py.stdout);
  const b = JSON.parse(node.stdout);
  failureCases.forEach((c, i) => {
    if (JSON.stringify(a.failures[i]) !== JSON.stringify(b.failures[i])) {
      failed += 1;
      if (failed <= 8) console.log(`DIFF failure ${JSON.stringify(c)}\n  py:   ${JSON.stringify(a.failures[i])}\n  node: ${JSON.stringify(b.failures[i])}`);
    }
  });
  textCases.forEach((t, i) => {
    if (JSON.stringify(a.texts[i]) !== JSON.stringify(b.texts[i])) {
      failed += 1;
      if (failed <= 8) console.log(`DIFF text ${JSON.stringify(t)}\n  py:   ${JSON.stringify(a.texts[i])}\n  node: ${JSON.stringify(b.texts[i])}`);
    }
  });
  if (verbose) console.log(`sample: ${JSON.stringify(a.failures.slice(0, 3))}`);
  console.log(`${failed === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${failed} differing case(s) of ${failureCases.length + textCases.length}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);

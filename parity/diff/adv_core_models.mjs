#!/usr/bin/env node
/**
 * ADV-core: differential fuzz of the hand-written pydantic emulation (src/models/_pydantic.ts) against the oracle's
 * real pydantic: every model x every field x a list of hostile values, through model_validate / model_validate_json.
 * Compares `str(ValidationError)`, `errors()` (type/loc/msg) and `model_dump_json()`.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_core_models.mjs [--verbose] [--max N]
 *
 * Exit: 0 identical, 1 differences, 2 oracle missing (skip).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const verbose = process.argv.includes("--verbose");
const tailIdx = process.argv.indexOf("--tail");
const TAIL = tailIdx > 0 ? Number(process.argv[tailIdx + 1]) : 0;
const IGNORE_IV = process.argv.includes("--ignore-input-value");
const maxArg = process.argv.indexOf("--max");
const MAX = maxArg > 0 ? Number(process.argv[maxArg + 1]) : Infinity;

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("[adv_core_models] ORACLE_VENV not set / missing: SKIPPED");
  process.exit(2);
}

const MODELS = {
  GlobalConfig: {},
  SessionConfig: { name: "n" },
  SessionInfo: { name: "n" },
  FileInfo: { name: "a", path: "/a" },
  WatchEvent: { type: "created", path: "/a" },
  SandboxConfig: {},
  SandboxInfo: { sandboxID: "sb" },
  ProcessChunk: { type: "stdout" },
  ProcessResult: {},
  CommandResult: {},
  OutputFile: { name: "n", path: "p" },
  CodeResult: {},
  ProcessInfo: { pid: 1 },
  TemplateInfo: { templateID: "t" },
  BuildInfo: { buildID: "b" },
  CustomCommandArg: { name: "x" },
  CustomCommand: { cmd: "echo" },
  SandboxTemplate: { name: "t" },
  TemplateRef: {},
};

const long = "x".repeat(70);
const VALUES = [
  null, true, false, 0, 1, -1, 2, 5, 86401, 86400, 3, 11, 300, 1e10, 2.5, -0.5, 1e21, 123456789012, 2 ** 53,
  "", " ", "5", " 5 ", "+5", "-5", "05", "5.0", "5.5", "5.", ".5", "1e3", "1E3", "0x10", "1_000", "1__0", "_1", "٣", "５",
  "true", "True", "TRUE", "yes", "Y", "on", "ON", "t", "T", "false", "no", "off", "f", "0", "1", "2", "nope", "inf", "-inf", "nan", "Infinity",
  "running", "RUNNING", "file", "directory", "stdout", "created", "ready", "string", "integer", "float", "boolean", "shell", "terminal", "bogus",
  [], [1], ["a"], ["a", 1], ["shell", "bogus"], [[]], {}, { a: "b" }, { a: 1 }, { a: null }, { "": "" }, { a: { b: 1 } },
  "2024-01-01", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00z", "2024-01-01 00:00:00", "2024-01-01t00:00:00", "2024-01-01T00:00:00+08:00",
  "2024-01-01T00:00:00+0800", "2024-01-01T00:00:00+08", "2024-01-01T00:00:00.123456789Z", "2024-01-01T00:00:00.1Z", "2024-01-01T24:00:00Z",
  "2024-01-01T23:59:60Z", "2024-01-01T10:00", "2024-01-01T10", "2024-02-30", "2023-02-29", "2024-13-01", "2024-00-01", "0000-01-01", "2024/01/01",
  "20240101", "2024-1-1", "2024-01-01T", "2024-01-01Tfoo", "2024-01-01T00:00:00Zjunk", "2024-01-01T00:00:00-00:00", "2024-01-01T00:00:00+23:59",
  "2024-01-01T00:00:00+24:00", "2024-01-01T00:00:00+00:60", "9999-12-31T23:59:59Z", "1969-12-31T23:59:59Z", "0001-01-01T00:00:00Z",
  1735689600, 1735689600.5, 1735689600123, 1735689600123.456, 20000000000, 20000000001, -20000000001, 253402300799, 253402300800, -62135596800, -62135596801,
  "1735689600", "1735689600.5", "-1", "20000000001", "1e3",
  "héllo", "日本語", "\u0000", "a\nb", "\ud83d\ude00", long, long.repeat(3), "é".repeat(60), "[" + "1,".repeat(40) + "1]",
  JSON.parse('{"k":"' + long + '"}'), JSON.parse('["' + long + '"]'),
];

const tmp = mkdtempSync(join(tmpdir(), "adv-models-"));
try {
  const PY = String.raw`
import json, sys
from pydantic import ValidationError
import easy_sandbox.models as M
spec = json.load(open(sys.argv[1]))
out = {}
for case in spec:
    cls = getattr(M, case["model"])
    r = {}
    for mode in ("py", "json"):
        try:
            if mode == "py":
                inst = cls.model_validate(json.loads(case["text"]))
            else:
                inst = cls.model_validate_json(case["text"])
            r[mode] = {"ok": inst.model_dump_json(), "alias": inst.model_dump_json(by_alias=True)}
        except ValidationError as e:
            r[mode] = {"err": str(e), "errors": [{"type": x["type"], "loc": [str(l) if not isinstance(l, int) else l for l in x["loc"]], "msg": x["msg"]} for x in e.errors()]}
        except Exception as e:
            r[mode] = {"exc": type(e).__name__ + ": " + str(e)}
    out[case["id"]] = r
json.dump(out, sys.stdout)
`;
  const TS = String.raw`
import { readFileSync } from "node:fs";
import * as M from ${JSON.stringify(join(CLI_ROOT, "src/models/index.ts"))};
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = {};
for (const c of spec) {
  const cls = M[c.model];
  const r = {};
  for (const mode of ["py", "json"]) {
    try {
      const inst = mode === "py" ? cls.modelValidate(JSON.parse(c.text)) : cls.modelValidateJson(c.text);
      r[mode] = { ok: inst.modelDumpJson(), alias: inst.modelDumpJson({ by_alias: true }) };
    } catch (e) {
      if (e && e.name === "ValidationError") r[mode] = { err: e.message, errors: e.errors().map((x) => ({ type: x.type, loc: x.loc.map((l) => (typeof l === "number" ? l : String(l))), msg: x.msg })) };
      else r[mode] = { exc: String(e && e.message) };
    }
  }
  out[c.id] = r;
}
process.stdout.write(JSON.stringify(out));
`;
  const spec = [];
  let id = 0;
  // fetch field names + aliases from oracle
  const meta = spawnSync(join(ORACLE_VENV, "bin", "python"), ["-c", `
import json, easy_sandbox.models as M
names = ${JSON.stringify(Object.keys(MODELS))}
o = {}
for n in names:
    c = getattr(M, n)
    o[n] = [[k, f.alias] for k, f in c.model_fields.items()]
print(json.dumps(o))`], { encoding: "utf8", env: { ...process.env, HOME: tmp, EBX_NO_KEYCHAIN: "1" } });
  const fields = JSON.parse(meta.stdout);
  for (const [model, base] of Object.entries(MODELS)) {
    const mk = (extra) => ({ id: String(id++), model, text: JSON.stringify({ ...base, ...extra }) });
    spec.push(mk({}));
    for (const [name, alias] of fields[model]) {
      for (const key of new Set([alias ?? name, name])) {
        for (const v of VALUES) spec.push(mk({ [key]: v }));
        spec.push({ id: String(id++), model, text: JSON.stringify(Object.fromEntries(Object.entries(base).filter(([k]) => k !== key))) });
      }
    }
    for (const t of ["", "{", "[]", "null", "5", '"s"', "{}", '{"a":1,}', "nan", "{'a':1}", '{"name":"n"} x', "\ufeff{}", "[1,2", '{"a":', "tru", '{"a":01}', '{"a":"\\x"}']) {
      spec.push({ id: String(id++), model, text: t });
    }
    for (const bad of [[], 5, "str", null]) spec.push({ id: String(id++), model, text: JSON.stringify(bad) });
  }
  const EXTRA = [
    ["SandboxTemplate", { name: "t", custom_commands: { a: { cmd: "x", args: [{ name: "n", type: "bogus" }, { name: 5 }, 7, { name: "ok", type: "integer", default: 5 }] }, b: "str", c: { cmd: 5, timeout: "x", env: { A: 1 } } } }],
    ["SandboxTemplate", { name: "t", capabilities: ["shell", "x", "y", 5] }],
    ["SandboxTemplate", { name: "t", capabilities: "shell" }],
    ["SandboxTemplate", { name: "t", ports: [1, "2", "x", 3.5, true], tags: [1, null], env: { A: null, B: 1, C: [] } }],
    ["SandboxTemplate", { name: 5, version: 1, description: null, author: [], license: {}, cpu_count: "a", memory_mb: "b" }],
    ["SandboxTemplate", { name: "t", unknown: 1, custom_commands: null }],
    ["SandboxTemplate", {}],
    ["TemplateInfo", { templateID: "t", aliases: ["a", 1, null, { x: 1 }], metadata: { a: { b: [1, 2] } } }],
    ["TemplateInfo", { templateID: "t", aliases: 5 }],
    ["TemplateInfo", { templateID: "t", aliases: null }],
    ["TemplateInfo", { templateID: "t", aliases: { a: 1 } }],
    ["TemplateInfo", { templateID: "t", aliases: "x", build_status: "READY", buildStatus: "ready" }],
    ["TemplateInfo", { template_id: "t", templateID: "u" }],
    ["TemplateInfo", { template_id: "t" }],
    ["TemplateInfo", { templateID: "t", public: "maybe", cpuCount: "x", createdAt: "bad", updatedAt: 5, metadata: [] }],
    ["TemplateInfo", { templateID: null, buildID: 5, startCmd: [] }],
    ["BuildInfo", { buildID: "b", logs: ["a", 1, null], error: 5, finishedAt: "2024-05-05T05:05:05.123456Z" }],
    ["BuildInfo", { build_id: "b", buildID: "c", status: "bogus" }],
    ["SessionInfo", { name: "n", config: { name: "c", ttl: -1, envs: { a: 1 } }, metadata: { a: 1, b: null } }],
    ["SessionInfo", { name: "n", config: 5 }],
    ["SessionInfo", { name: "n", config: [] }],
    ["SessionInfo", { name: "n", sessionId: "a", session_id: "b", sandboxId: "x", sandbox_id: "y" }],
    ["SessionInfo", { name: "n", createdAt: "2024-01-01T00:00:00.123456+05:30", lastConnected: 1735689600.123456 }],
    ["SessionInfo", { name: "n", createdAt: "2024-01-01T00:00:00-03:30", lastConnected: "2024-01-01 00:00:00.5" }],
    ["SandboxInfo", { sandboxID: "s", lifecycle: { a: 1 } }],
    ["SandboxInfo", { sandboxID: "s", lifecycle: "x" }],
    ["SandboxInfo", { sandboxID: "s", lifecycle: [] }],
    ["SandboxInfo", { sandboxID: "s", lifecycle: 5 }],
    ["SandboxInfo", { sandboxID: "s", state: "RUNNING" }],
    ["SandboxInfo", { sandboxID: "s", state: "paused", status: "error" }],
    ["SandboxInfo", { sandboxID: "s", state: null }],
    ["SandboxInfo", { sandbox_id: "s", sandboxID: "t" }],
    ["SandboxInfo", { sandbox_id: "s", templateID: 5, alias: 5, cpuCount: 2.5 }],
    ["SandboxConfig", { templateID: "a", template: "b", timeout: 0, autoPause: "x", envVars: { a: 1 }, env_vars: { b: "2" }, cpu: "x", gpu: 5 }],
    ["SandboxConfig", { timeout: 86401, memory: -1, disk: null }],
    ["SandboxConfig", { timeout: -5, metadata: { 1: 2 } }],
    ["CodeResult", { output_files: [{ name: "a", path: "b" }, { name: 1 }, 5, null] }],
    ["CodeResult", { output_files: { a: 1 }, execution_time: "x", exit_code: "y" }],
    ["CommandResult", { value: { a: [1, { b: null }] }, execution_time: "1.5", exit_code: "2" }],
    ["ProcessChunk", { type: "exit", exit_code: "3", pid: "4", timestamp: "5.5" }],
    ["ProcessChunk", { type: "EXIT" }],
    ["ProcessChunk", {}],
    ["WatchEvent", { type: "created", path: "/a", timestamp: 1735689600.5, old_path: 5 }],
    ["FileInfo", { name: "a", path: "p", type: "directory", size: "12", modified: "2024-03-03T03:03:03Z" }],
    ["FileInfo", { name: "a", path: "p", type: "DIRECTORY", size: -5 }],
    ["GlobalConfig", { timeout: 0, max_retries: 11, secure: "maybe", region: 5 }],
    ["GlobalConfig", { timeout: "300", max_retries: "3", secure: "false" }],
    ["GlobalConfig", { timeout: -1, max_retries: -1, api_url: null, domain: null, log_level: null, default_template: null }],
    ["CustomCommand", { cmd: "x", args: "nope", env: [] }],
    ["CustomCommandArg", { name: "x", type: "STRING" }],
    ["CustomCommandArg", { name: "x", type: 5 }],
    ["CustomCommandArg", { name: "x", type: "bad\'quote\"" }],
    ["CustomCommandArg", { name: "x", default: 5, required: "yes" }],
    ["CustomCommandArg", { name: "x", default: true }],
  ];
  for (const [model, v] of EXTRA) spec.push({ id: String(id++), model, text: JSON.stringify(v) });
  const limited = spec.slice(0, MAX);
  const specFile = join(tmp, "spec.json");
  writeFileSync(specFile, JSON.stringify(limited));
  const py = spawnSync(join(ORACLE_VENV, "bin", "python"), ["-c", PY, specFile], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, HOME: tmp, EBX_NO_KEYCHAIN: "1" } });
  if (py.status !== 0) { console.error(py.stderr); process.exit(2); }
  const tsFile = join(tmp, "run.mjs");
  writeFileSync(tsFile, TS);
  const ts = spawnSync(process.execPath, ["--import", "tsx", tsFile, specFile], { encoding: "utf8", cwd: CLI_ROOT, maxBuffer: 1 << 28 });
  if (ts.status !== 0) { console.error(ts.stderr); process.exit(2); }
  const exp = JSON.parse(py.stdout);
  const act = JSON.parse(ts.stdout);
  let diffs = 0;
  const byKind = new Map();
  const groups = new Map();
  for (const c of limited) {
    for (const mode of ["py", "json"]) {
      const norm = (x) => (IGNORE_IV ? JSON.stringify(x).replace(/input_value=.*?, input_type=\w+/g, "input_value=X") : JSON.stringify(x));
      if (mode === "py") {
        try { JSON.parse(c.text); } catch { continue; }
      }
      const a = norm(exp[c.id][mode]);
      const b = norm(act[c.id][mode]);
      if (a !== b) {
        diffs++;
        const kind = `${c.model}:${mode}`;
        byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
        const sig = (r) => (r.errors ? r.errors.map((e) => `${e.type}|${e.msg}`).join(";") : r.ok ? "ok" : r.exc ?? "?");
        const key = `${mode} ${c.model} :: oracle[${sig(exp[c.id][mode])}] node[${sig(act[c.id][mode])}]`;
        groups.set(key, (groups.get(key) ?? []).concat(c.text.slice(0, 120)));
        if (verbose && (!TAIL || Number(c.id) >= Number(limited.at(-1).id) - TAIL)) {
          console.log(`--- ${c.model} [${mode}] ${c.text.slice(0, 200)}`);
          console.log("oracle:", a.slice(0, 700));
          console.log("node  :", b.slice(0, 700));
        }
      }
    }
  }
  console.log(`[adv_core_models] cases=${limited.length} comparisons=${limited.length * 2} diffs=${diffs}`);
  for (const [k, v] of byKind) console.log(`  ${k}: ${v}`);
  if (process.argv.includes("--groups")) {
    for (const [k, v] of groups) console.log(`${v.length}x ${k}\n      e.g. ${v[0]}`);
  }
  process.exit(diffs ? 1 : 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

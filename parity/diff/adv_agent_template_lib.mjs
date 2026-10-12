/**
 * Shared runner of the adversarial `agent-template` differential harnesses (adv_agent_template_*.mjs).
 *
 * Runs identical argv against the Python oracle (`$ORACLE_VENV/bin/ebx`) and the Node CLI (`src/bin/ebx.ts` through tsx) in
 * an isolated HOME / work directory, against a scripted stub server (platform REST, template index, GitHub tarballs) and a
 * fake `docker` on PATH, then compares exit code, stdout, stderr, stub request log, docker argv log, the work-dir tree and
 * the HOME tree (relative path, size, hash, permission bits).
 *
 * Case options:
 *   files        seeded into the work dir ({port}/{work}/{home} are substituted in names' contents and argv/env)
 *   homeFiles    seeded into HOME
 *   docker       put a fake docker on PATH           env  extra env (null deletes)       input  stdin text
 *   platform     { "<METHOD> <path>": response }      index  response for /index.yaml      tarball  see below
 *   repeat       run the command N times in the same HOME/work (cache / re-run behaviour)
 *   unreachable  nothing listens on E2B_API_URL       known  marker for a documented difference
 *   tarball      { files, subdir } | { raw: Buffer, status? } | { status, body, headers } | { spec: <mktar spec> }
 *   symlinks     [[path, target]] created in the work dir after seeding
 *   modes        { relpath: 0o755 } chmod after seeding   homeSymlinks / homeModes: same, relative to HOME
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ORACLE_VENV = process.env.ORACLE_VENV;
export const verbose = process.argv.includes("--verbose");
const onlyIdx = process.argv.indexOf("--only");
export const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

export function requireOracle() {
  if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "ebx"))) {
    console.error("ORACLE_VENV must point to a venv with the original easy-sandbox installed; skipping.");
    process.exit(0);
  }
}

export const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ebx-advtpl-")));

export const DOCKERFILE = 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD ["python3", "commands.py"]\n';
export const TEMPLATE_YAML = 'name: demo-tpl\nversion: "1.0.0"\ndescription: demo\nresources:\n  cpu: 1\n  memory: 512\n';
export const TPL = { Dockerfile: DOCKERFILE, "template.yaml": TEMPLATE_YAML, "commands.py": "print('hi')\n" };
export const CREDS = { ALICLOUD_ACCESS_KEY_ID: "ak-test", ALICLOUD_ACCESS_KEY_SECRET: "sk-test" };
export const json = (status, obj) => ({ status, type: "application/json", body: Buffer.from(JSON.stringify(obj)) });
export const text = (status, s, type = "text/plain") => ({ status, type, body: Buffer.from(s) });
export const TPL_IN = (dir) => Object.fromEntries(Object.entries(TPL).map(([k, v]) => [`${dir}/${k}`, v]));

export const PLATFORM_TEMPLATES = [
  { templateID: "tmpl-001", aliases: ["python-base"], names: ["python-base"], cpuCount: 2, memoryMB: 2048, public: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", builds: [{ buildID: "b-1", status: "ready" }] },
];

const FAKE_DOCKER = `#!/bin/sh
echo "$@" >> "$DOCKER_LOG"
case "$1" in
  info) [ -n "$DOCKER_FAIL_INFO" ] && exit 1; exit 0 ;;
  build) echo "#1 [internal] load build definition"; echo "#2 DONE"; [ -n "$DOCKER_FAIL_BUILD" ] && { echo "build exploded" >&2; exit 1; }; exit 0 ;;
  login) cat >/dev/null; [ -n "$DOCKER_FAIL_LOGIN" ] && { echo "login denied" >&2; exit 1; }; exit 0 ;;
  push) echo "The push refers to repository [$2]"; [ -n "$DOCKER_FAIL_PUSH" ] && { echo "push denied" >&2; exit 1; }; exit 0 ;;
  tag) [ -n "$DOCKER_FAIL_TAG" ] && exit 1; exit 0 ;;
  *) exit 0 ;;
esac
`;

export function makeTarball(files, subdir = null) {
  const root = mkdtempSync(join(scratch, "tar-"));
  const top = join(root, "owner-repo-abc123");
  for (const [rel, text] of Object.entries(files)) {
    const dest = join(top, subdir ? `${subdir}/${rel}` : rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  const r = spawnSync("tar", ["--sort=name", "--mtime=2026-01-01", "--owner=0", "--group=0", "-czf", "-", "-C", root, "owner-repo-abc123"], { maxBuffer: 1 << 26 });
  rmSync(root, { recursive: true, force: true });
  return r.stdout;
}

/** Hostile tarball built with Python's tarfile (names / link types / compression that `tar` would refuse to write). */
export function pyTar(spec) {
  const py = join(ORACLE_VENV, "bin", "python");
  const r = spawnSync(py, [join(CLI_ROOT, "parity", "diff", "adv_agent_template_mktar.py")], { input: JSON.stringify(spec), maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`mktar failed: ${r.stderr}`);
  return r.stdout;
}
export const TOP = "owner-repo-abc123";
export const F = (name, data = "x\n", extra = {}) => ({ name, type: "file", data, ...extra });
export const D = (name) => ({ name, type: "dir" });

mkdirSync(join(scratch, "bin"), { recursive: true });
writeFileSync(join(scratch, "bin", "docker"), FAKE_DOCKER);
chmodSync(join(scratch, "bin", "docker"), 0o755);
const nodeEntry = join(CLI_ROOT, "src/bin/ebx.ts");

export function startStub(testCase) {
  const log = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const h = req.headers;
      log.push({
        method: req.method,
        path: req.url,
        body: Buffer.concat(chunks).toString("utf8"),
        "x-api-key": h["x-api-key"] ?? null,
        authorization: h.authorization ?? null,
        accept: h.accept ?? null,
      });
      const key = `${req.method} ${req.url.split("?")[0]}`;
      const url = req.url.split("?")[0];
      let out = null;
      if (testCase.platform?.[key]) out = testCase.platform[key];
      else if (url === "/index.yaml" && testCase.index) out = testCase.index;
      else if (url.startsWith("/repos/") && url.includes("/tarball") && testCase.tarball) {
        const t = testCase.tarball;
        if (t.raw) out = { status: t.status ?? 200, type: "application/gzip", body: t.raw };
        else if (t.spec) out = { status: 200, type: "application/gzip", body: pyTar(t.spec) };
        else if (t.files) out = { status: 200, type: "application/gzip", body: makeTarball(t.files, t.subdir) };
        else out = { status: t.status, type: "application/json", headers: t.headers, body: Buffer.from(t.body ?? "") };
      } else if (url === "/templates" && req.method === "GET") out = json(200, PLATFORM_TEMPLATES);
      else if (url.startsWith("/templates/") && req.method === "GET") {
        const id = url.slice("/templates/".length);
        const found = PLATFORM_TEMPLATES.find((t) => t.templateID === id);
        out = found ? json(200, found) : json(404, { message: "template not found" });
      } else out = json(404, { message: "unscripted route" });
      const headers = { "Content-Type": out.type, "Content-Length": out.body.length, ...(out.headers ?? {}) };
      res.writeHead(out.status, headers);
      res.end(out.status === 204 ? undefined : out.body);
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, log, port: server.address().port })));
}

let fileNormaliser = null;
/** Hook: (basename, Buffer) => Buffer | null; lets a suite mask known-different bytes (e.g. the IDE launcher) before hashing. */
export function setFileNormaliser(fn) {
  fileNormaliser = fn;
}

function snapshot(root, prefix = "") {
  const out = [];
  const walk = (dir, rel) => {
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.push(`${prefix}${r} -> ${readlinkSync(p)}`);
      else if (st.isDirectory()) {
        out.push(`${prefix}${r}/ ${(st.mode & 0o777).toString(8)}`);
        walk(p, r);
      } else {
        let digest = "unreadable";
        let ignoreSize = false;
        try {
          let data = readFileSync(p);
          if (name.endsWith(".meta.json")) data = Buffer.from(data.toString("utf8").replace(/"fetched_at": [0-9.]+/, '"fetched_at": <t>').replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>"));
          const normed = fileNormaliser?.(name, data);
          if (normed) {
            data = normed;
            ignoreSize = true;
          }
          digest = createHash("sha1").update(data).digest("hex").slice(0, 10);
          if (process.env.ADV_CAT && name === process.env.ADV_CAT) digest += ` :: ${data.toString("utf8").slice(0, 3000)}`;
        } catch {
          /* mode 000 */
        }
        out.push(`${prefix}${r} ${digest} ${name.endsWith(".meta.json") || ignoreSize ? "-" : st.size} ${(st.mode & 0o777).toString(8)}`);
      }
    }
  };
  walk(root, "");
  return out;
}

function runOnce(kind, testCase, port, ctx) {
  const { home, work, dockerLog } = ctx;
  const sub = (s) => s.split("{port}").join(String(port)).split("{work}").join(work).split("{home}").join(home);
  const env = {
    PATH: testCase.docker ? `${join(scratch, "bin")}:${process.env.PATH}` : process.env.PATH.split(":").filter((d) => !existsSync(join(d, "docker"))).join(":"),
    HOME: home,
    USERPROFILE: home,
    EBX_NO_KEYCHAIN: "1",
    E2B_API_KEY: "stub-key",
    E2B_API_URL: `http://127.0.0.1:${port}`,
    NO_PROXY: "*",
    no_proxy: "*",
    LANG: "C.UTF-8",
    COLUMNS: "80",
    DOCKER_LOG: dockerLog,
    TERM: "dumb",
  };
  for (const [k, v] of Object.entries(testCase.env ?? {})) {
    if (v === null) delete env[k];
    else env[k] = sub(v);
  }
  const argv = testCase.argv.map(sub);
  const [cmd, args] =
    kind === "py"
      ? [join(ORACLE_VENV, "bin", "ebx"), argv]
      : [process.execPath, ["--import", pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href, nodeEntry, ...argv]];
  return new Promise((ok) => {
    let proc;
    try {
      proc = spawn(cmd, args, { cwd: work, env, stdio: ["pipe", "pipe", "pipe"], detached: false });
    } catch (e) {
      ok({ code: `spawn-error:${e.code}`, stdout: "", stderr: "" });
      return;
    }
    const out = [];
    const err = [];
    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => err.push(d));
    const timer = setTimeout(() => proc.kill("SIGKILL"), testCase.timeoutMs ?? 90_000);
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      ok({ code: signal ? `signal:${signal}` : code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(testCase.input ?? "");
  });
}

async function run(kind, testCase, port) {
  const home = mkdtempSync(join(scratch, "home-"));
  const work = mkdtempSync(join(scratch, "work-"));
  const dockerLog = join(scratch, `docker-${kind}-${Math.random().toString(36).slice(2)}.log`);
  const sub = (s) => s.split("{port}").join(String(port)).split("{work}").join(work).split("{home}").join(home);
  for (const [base, files] of [[work, testCase.files], [home, testCase.homeFiles]]) {
    for (const [rel, content] of Object.entries(files ?? {})) {
      const dest = join(base, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, typeof content === "string" ? sub(content) : content);
    }
  }
  for (const [p, target] of testCase.symlinks ?? []) {
    mkdirSync(dirname(join(work, p)), { recursive: true });
    symlinkSync(sub(target), join(work, p));
  }
  for (const [p, target] of testCase.homeSymlinks ?? []) {
    mkdirSync(dirname(join(home, p)), { recursive: true });
    symlinkSync(sub(target), join(home, p));
  }
  for (const [p, mode] of Object.entries(testCase.modes ?? {})) chmodSync(join(work, p), mode);
  for (const [p, mode] of Object.entries(testCase.homeModes ?? {})) chmodSync(join(home, p), mode);
  const ctx = { home, work, dockerLog };
  const outs = [];
  const errs = [];
  const codes = [];
  for (let i = 0; i < (testCase.repeat ?? 1); i += 1) {
    const r = await runOnce(kind, testCase, port, ctx);
    outs.push(r.stdout);
    errs.push(r.stderr);
    codes.push(r.code);
  }
  if (testCase.postCheck === "bg") {
    await new Promise((r) => setTimeout(r, 600));
    let verdict = "no pidfile";
    try {
      const pid = Number(readFileSync(join(home, "bg.pid"), "utf8"));
      try {
        process.kill(pid, 0);
        verdict = "grandchild STILL ALIVE";
        process.kill(pid, "SIGKILL");
      } catch {
        verdict = "grandchild dead";
      }
    } catch {
      /* none */
    }
    outs.push(`[postCheck bg: ${verdict}]`);
  }
  const files = [...snapshot(work), ...snapshot(home, "~/")];
  const docker = existsSync(dockerLog) ? readFileSync(dockerLog, "utf8") : "";
  spawnSync("chmod", ["-R", "u+rwx", home, work]);
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
  rmSync(dockerLog, { force: true });
  return { code: codes.join(","), stdout: outs.join("\n=== run ===\n"), stderr: errs.join("\n=== run ===\n"), files, docker, work, home };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let sortListings = false;
export function setSortListings(on) {
  sortListings = on;
}

function sortIndentedRuns(t) {
  const lines = t.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; ) {
    if (!/^ {2}\S/.test(lines[i])) {
      out.push(lines[i++]);
      continue;
    }
    let j = i;
    while (j < lines.length && /^ {2}\S/.test(lines[j])) j++;
    out.push(...lines.slice(i, j).sort());
    i = j;
  }
  return out.join("\n");
}

// shutil.Error extended with the characters of a str prints the path as a list of 1-char reprs.
const charRepr = (s) => [...s].map((c) => (c === "'" ? `"'"` : `'${c}'`)).join(", ");

function normalise(text, ctx) {
  let t = text.split(charRepr(ctx.work)).join("<work-chars>").split(ctx.work).join("<work>").split(ctx.home).join("<home>");
  t = t.split(basename(ctx.work)).join("<workname>");
  t = t.replace(/work-[A-Za-z0-9]{6}\b/g, "work-<rand>");
  t = t.replace(/INFO: Building SDK wheel from [^\n]*\n/g, "");
  t = t.replace(/ListTeams API call failed: Error: [^"]*/g, "ListTeams API call failed: <aliyun-error>");
  t = t.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");
  t = t.replace(new RegExp(`${esc(scratch)}/[A-Za-z0-9._-]+`, "g"), "<scratch>");
  t = t.replace(/ebx-adopt-[A-Za-z0-9_]+/g, "ebx-adopt-<rand>");
  t = t.replace(/tmp[a-z0-9_]{8}\.tar\.gz/g, "<tmp>.tar.gz");
  t = t.replace(/\d+\.\d+s\b/g, "<t>s");
  t = t.replace(/WARNING: (Failed to build SDK wheel|Could not fetch easy-sandbox-server)[^\n]*\n(\n)?/g, "<sdk-wheel-warning>\n");
  // httpx's HTTPStatusError text spans two lines; the oracle's wheel is on PyPI, the Node build's (bumped) one may not be.
  t = t.replace(/<sdk-wheel-warning>\nFor more information check: [^\n]*\n/g, "<sdk-wheel-warning>\n");
  t = t.replace(/\[E5000\] ListTeams API call failed: [^\n]*/g, "[E5000] ListTeams API call failed: <aliyun-error>");
  t = t.replace(/WARNING: GetAuthorizationToken failed:[\s\S]*?falling back to direct AK\/SK login/g, "WARNING: GetAuthorizationToken failed: <net>");
  return sortListings ? sortIndentedRuns(t) : t;
}

function stderrFilter(s) {
  return s
    .split("\n")
    .filter((l) => !/^(DEBUG: (Starting new HTTPS connection|https:\/\/[^ ]+ "|Using selector|connect_tcp|connect_unix|start_tls|send_request|receive_response|response_closed|close\.)|INFO: HTTP Request)/.test(l))
    .join("\n");
}

async function runCase(testCase) {
  const res = {};
  for (const kind of ["py", "node"]) {
    let stub = null;
    let port;
    if (testCase.unreachable) {
      const s = http.createServer();
      await new Promise((r) => s.listen(0, "127.0.0.1", r));
      port = s.address().port;
      await new Promise((r) => s.close(r));
    } else {
      stub = await startStub(testCase);
      port = stub.port;
    }
    const r = await run(kind, testCase, port);
    const norm = (s) => normalise(s, r);
    const requests = stub ? stub.log.map((l) => norm(JSON.stringify(l))) : [];
    stub?.server.closeAllConnections?.();
    stub?.server.close();
    res[kind] = {
      code: r.code,
      stdout: norm(r.stdout),
      stderr: stderrFilter(norm(r.stderr)),
      requests,
      docker: norm(r.docker),
      files: r.files.map(norm),
    };
  }
  return res;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function runSuite(cases, { title = "adv" } = {}) {
  const selected = cases.filter((c) => !only || c.name.includes(only));
  let diffs = 0;
  try {
    const results = await pool(selected, 6, runCase);
    selected.forEach((c, i) => {
      const { py, node } = results[i];
      const problems = [];
      if (py.code !== node.code) problems.push(`exit: py=${py.code} node=${node.code}`);
      if (py.stdout !== node.stdout) problems.push(`stdout:\n    py:   ${JSON.stringify(py.stdout)}\n    node: ${JSON.stringify(node.stdout)}`);
      if (py.stderr !== node.stderr) problems.push(`stderr:\n    py:   ${JSON.stringify(py.stderr)}\n    node: ${JSON.stringify(node.stderr)}`);
      if (py.docker !== node.docker) problems.push(`docker log:\n    py:   ${JSON.stringify(py.docker)}\n    node: ${JSON.stringify(node.docker)}`);
      if (JSON.stringify(py.files) !== JSON.stringify(node.files)) problems.push(`files:\n    py:   ${JSON.stringify(py.files)}\n    node: ${JSON.stringify(node.files)}`);
      if (JSON.stringify(py.requests) !== JSON.stringify(node.requests)) {
        const n = Math.max(py.requests.length, node.requests.length);
        for (let k = 0; k < n; k += 1) {
          if (py.requests[k] !== node.requests[k]) {
            problems.push(`stub request #${k}:\n    py:   ${py.requests[k]}\n    node: ${node.requests[k]}`);
            break;
          }
        }
      }
      if (c.known) {
        console.log(problems.length ? `KNOWN ${c.name}: ${c.known}` : `FIXED ${c.name}: remove the "known" marker`);
        if (!problems.length) diffs += 1;
      } else if (problems.length) {
        diffs += 1;
        console.log(`DIFF ${c.name}  [${c.argv.join(" ")}]\n  ${problems.join("\n  ")}`);
      } else if (verbose) {
        console.log(`ok   ${c.name} (exit ${py.code}) out=${JSON.stringify(py.stdout.slice(0, +(process.env.ADV_SHOW ?? 90)))} err=${JSON.stringify(py.stderr.slice(0, +(process.env.ADV_SHOW ?? 90)))}`);
      }
    });
    console.log(`${title}: ${diffs === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${diffs} differing case(s) of ${selected.length}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return diffs;
}

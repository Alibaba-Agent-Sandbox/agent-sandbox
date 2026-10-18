// Regression tests for the findings of the adversarial review of the command framework / output / REPL / sandbox commands area
// (parity/review/commands.md, C-01..C-11). Every expected value is the behaviour of the Python oracle (the original
// `abx`) and is hard-coded, so no oracle is needed to run them.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { startStub } from "../../parity/diff/stub.mjs";

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENTRY = path.join(CLI_ROOT, "src/bin/abx.ts");
const TSX = pathToFileURL(path.join(CLI_ROOT, "node_modules/tsx/dist/esm/index.mjs")).href;
const PTY_RUN = path.join(CLI_ROOT, "parity/diff/pty_run.py");
const SB = "sbx-ev-001";
const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

interface Stub {
  url: string;
  close(): Promise<void>;
}

function baseEnv(home: string, url: string | null, extra: Record<string, string | null> = {}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    USERPROFILE: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    COLUMNS: "100",
    ABX_NO_KEYCHAIN: "1",
  };
  if (url) Object.assign(env, { ABX_SANDBOX_API_KEY: "k-adversarial-stub", ABX_SANDBOX_BASE_URL: url, ABX_SANDBOX_DOMAIN: "stub.invalid" });
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  return env;
}

async function withStub<T>(
  fn: (ctx: { stub: Stub; home: string; cwd: string; log: () => Promise<Array<Record<string, any>>> }) => Promise<T>,
): Promise<T> {
  const stub: Stub = await startStub({});
  const home = mkdtempSync(path.join(tmpdir(), "adv-cmd-h-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "adv-cmd-c-"));
  homes.push(home, cwd);
  try {
    return await fn({ stub, home, cwd, log: async () => (await fetch(`${stub.url}/__log`)).json() as any });
  } finally {
    await stub.close();
  }
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function collect(cmd: string, args: string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<Run> {
  return new Promise((ok) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs);
    child.on("close", (status) => {
      clearTimeout(timer);
      ok({ status, stdout, stderr });
    });
  });
}

function runAbx(args: string[], opts: { home: string; cwd: string; url: string | null; env?: Record<string, string | null>; shell?: string; built?: boolean }): Promise<Run> {
  const env = baseEnv(opts.home, opts.url, opts.env);
  const argv = opts.built ? [path.join(CLI_ROOT, "dist/bin/abx.js"), ...args] : ["--import", TSX, ENTRY, ...args];
  if (opts.shell) {
    env.ABX = [process.execPath, ...argv].map((x) => `'${x.replace(/'/g, "'\\''")}'`).join(" ");
    return collect("bash", ["-c", opts.shell], { cwd: opts.cwd, env, timeoutMs: 30000 });
  }
  return collect(process.execPath, argv, { cwd: opts.cwd, env, timeoutMs: 30000 });
}

async function ptySession(args: string[], opts: { home: string; cwd: string; url: string; steps: Array<{ expect: string; send: string }>; timeout: number }) {
  const env = baseEnv(opts.home, opts.url, { TERM: "xterm-256color", NO_COLOR: null });
  const spec = { argv: [process.execPath, "--import", TSX, ENTRY, ...args], cwd: opts.cwd, env, steps: opts.steps, timeout: opts.timeout };
  const r = await collect("python3", [PTY_RUN, JSON.stringify(spec)], { cwd: opts.cwd, env: { PATH: process.env.PATH ?? "" }, timeoutMs: (opts.timeout + 20) * 1000 });
  return JSON.parse(r.stdout) as { code: number; output: string; timed_out: boolean };
}

const havePython = spawnSync("python3", ["--version"]).status === 0;
const strip = (s: string) => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r+\n/g, "\n");

describe("commands (review regressions)", () => {
  it("ADV-commands-01 int options accept Unicode decimal digits like Python int()", async () => {
    await withStub(async ({ stub, home, cwd, log }) => {
      const r = await runAbx(["list", "--limit", "\u0663"], { home, cwd, url: stub.url });
      expect(r.stderr).not.toContain("not a valid integer");
      expect(r.status).toBe(0);
      const sent = (await log()).find((e) => e.path === "/sandboxes");
      expect(sent?.query?.limit).toBe("3");
    });
  });

  it("ADV-commands-02 integers above 2**53 keep full precision", async () => {
    await withStub(async ({ stub, home, cwd, log }) => {
      await runAbx(["list", "--limit", "99999999999999999999"], { home, cwd, url: stub.url });
      const sent = (await log()).find((e) => e.path === "/sandboxes");
      expect(sent?.query?.limit).toBe("99999999999999999999");
    });
  });

  it("ADV-commands-03 a timeout above 2**31-1 ms does not fire immediately (exec --timeout 2147483648)", async () => {
    await withStub(async ({ stub, home, cwd, log }) => {
      const r = await runAbx(["exec", SB, "--timeout", "2147483648", "echo hi"], { home, cwd, url: stub.url });
      expect(r.stderr).not.toContain("TimeoutOverflowWarning");
      expect(r.stderr).not.toContain("E3001");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("hi\n");
      expect((await log()).some((e) => e.path === "/process.Process/Start")).toBe(true);
    });
  });

  it("ADV-commands-04 a negative exec timeout expires before any Start request is sent (already-expired ConnectTimeout -> E3001)", async () => {
    await withStub(async ({ stub, home, cwd, log }) => {
      const r = await runAbx(["exec", SB, "--timeout", "-5", "echo hi"], { home, cwd, url: stub.url });
      // `--timeout -5` becomes httpx.Timeout(0). That expires as ConnectTimeout before any bytes (AT-12); the CLI
      // maps TimeoutException to E3001. A ConnectTimeout under a positive timeout is still ConnectionError_ (KI-003).
      expect(r.status).toBe(5);
      expect(r.stderr).toContain("[E3001] Request timed out");
      expect(r.stderr).not.toContain("ReadTimeout");
      expect((await log()).some((e) => e.path === "/process.Process/Start")).toBe(false);
    });
  });

  it("ADV-commands-05 --log-level info prints the httpx 'HTTP Request:' line for each request", async () => {
    await withStub(async ({ stub, home, cwd }) => {
      const r = await runAbx(["--log-level", "info", "list"], { home, cwd, url: stub.url });
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/^INFO: HTTP Request: GET http:\/\/127\.0\.0\.1:\d+\/sandboxes\S* "HTTP\/1\.1 200 OK"$/m);
    });
  });

  it("ADV-commands-06 create --env __proto__=1 sends the key", async () => {
    await withStub(async ({ stub, home, cwd, log }) => {
      await runAbx(["create", "--template", "base", "--env", "__proto__=1", "--metadata", "__proto__=2"], { home, cwd, url: stub.url });
      const post = (await log()).find((e) => e.method === "POST" && e.path === "/sandboxes");
      const body = post?.body;
      expect(JSON.stringify(body)).toContain('"__proto__":"1"');
      expect(JSON.stringify(body)).toContain('"__proto__":"2"');
    });
  });

  it.skipIf(!existsSync("/dev/full"))("ADV-commands-07 a failed stdout write is reported (config list > /dev/full: OS error, exit 120 like Python)", async () => {
    await withStub(async ({ home, cwd }) => {
      const r = await runAbx(["config", "list"], { home, cwd, url: null, shell: 'eval "$ABX" > /dev/full' });
      // Python: `OS error: [Errno 28] ...` from the failed flush, then the interpreter's final flush fails again
      // ("Exception ignored in: <_io.TextIOWrapper name='<stdout>' ...>") and the exit status becomes 120.
      expect(r.status).toBe(120);
      expect(r.stderr).toContain("OS error: [Errno 28] No space left on device");
      expect(r.stderr).toContain("Suggestion: Check file permissions and disk space.");
      expect(r.stderr).toContain("Exception ignored in: <_io.TextIOWrapper name='<stdout>' mode='w' encoding='utf-8'>\nOSError: [Errno 28] No space left on device\n");
      expect(r.stderr).not.toContain("Unhandled 'error' event");
    });
  });

  it("ADV-commands-08 FORCE_COLOR together with NO_COLOR does not leak a Node warning on stderr", async () => {
    await withStub(async ({ stub, home, cwd }) => {
      // tsx can emit Node's color warning before the CLI shim is evaluated.
      // Check the actual shipped entrypoint, not a loader's earlier side effect.
      const r = await runAbx(["config", "list"], { home, cwd, url: stub.url, built: true, env: { FORCE_COLOR: "1", NO_COLOR: "1" } });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain("ignored due to the 'FORCE_COLOR'");
    });
  });

  it("ADV-commands-09 a scheme-less ABX_SANDBOX_BASE_URL reports the httpx protocol message", async () => {
    await withStub(async ({ home, cwd }) => {
      const r = await runAbx(["list"], { home, cwd, url: "127.0.0.1:9" });
      expect(r.stderr).toContain("Request URL is missing an 'http://' or 'https://' protocol.");
      expect(r.stderr).not.toContain("Invalid URL");
    });
  });

  it.skipIf(!existsSync("/dev/full"))("ADV-commands-10 a download write failure carries no filename (OS error: [Errno 28] No space left on device)", async () => {
    await withStub(async ({ stub, home, cwd }) => {
      const r = await runAbx(["download", SB, "/home/user/hello.txt", "/dev/full"], { home, cwd, url: stub.url });
      expect(r.stderr).toContain("OS error: [Errno 28] No space left on device");
      expect(r.stderr).not.toContain("/dev/full");
    });
  });

  it("ADV-commands-11 a truncated Content-Length body reports 'received N bytes, expected M'", async () => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://x");
      res.setHeader("content-type", "application/json");
      if (u.pathname.startsWith("/sandboxes/")) {
        const origin = `http://127.0.0.1:${(server.address() as any).port}`;
        return res.end(JSON.stringify({ sandboxID: SB, templateID: "base", state: "running", cpuCount: 2, memoryMB: 2048, startedAt: "2026-01-02T03:04:05Z", endAt: "2026-01-02T03:09:05Z", envdVersion: "0.5.2", metadata: {}, envdUrl: origin, envdAccessToken: "t", clientID: "c" }));
      }
      if (u.pathname === "/files") {
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": "5000" });
        res.write("x".repeat(1000));
        return void setTimeout(() => res.socket?.destroy(), 100);
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const home = mkdtempSync(path.join(tmpdir(), "adv-cmd-h-"));
    const cwd = mkdtempSync(path.join(tmpdir(), "adv-cmd-c-"));
    homes.push(home, cwd);
    try {
      const url = `http://127.0.0.1:${(server.address() as any).port}`;
      const r = await runAbx(["download", SB, "/trunc", "out"], { home, cwd, url });
      expect(r.stderr).toContain("(received 1000 bytes, expected 5000)");
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it.skipIf(!havePython)("ADV-commands-12 the REPL runs every line of a multi-line paste (type-ahead is not dropped)", async () => {
    await withStub(async ({ stub, home, cwd }) => {
      const P = "abx:sbx-ev-0> ";
      const r = await ptySession(["connect", SB], { home, cwd, url: stub.url, timeout: 20, steps: [{ expect: P, send: "echo a\recho b\recho c\rexit\r" }] });
      const out = strip(r.output);
      expect(r.timed_out).toBe(false);
      expect(out).toMatch(/^b$/m);
      expect(out).toMatch(/^c$/m);
    });
  });

  it.skipIf(!havePython)("ADV-commands-13 the REPL keeps working after a very long (5000 char) line", async () => {
    await withStub(async ({ stub, home, cwd }) => {
      const P = "abx:sbx-ev-0> ";
      const r = await ptySession(["connect", SB], {
        home,
        cwd,
        url: stub.url,
        timeout: 15,
        steps: [
          { expect: P, send: `echo ${"x".repeat(5000)}\r` },
          { expect: P, send: "echo hello\r" },
          { expect: "hello", send: "exit\r" },
        ],
      });
      expect(r.timed_out).toBe(false);
      expect(r.code).toBe(0);
    });
  });

  it("ADV-commands-14 process signal --signal above 2**63 is rejected like python ('Integer exceeds 64-bit range')", async () => {
    await withStub(async ({ stub, home, cwd, log }) => {
      const r = await runAbx(["sandbox", "process", "signal", SB, "1", "--signal", "99999999999999999999"], { home, cwd, url: stub.url });
      const sentSignal = (await log()).some((e) => e.path === "/process.Process/SendSignal");
      expect(sentSignal).toBe(false);
      expect(r.status).not.toBe(0);
    });
  });

  it("ADV-commands-15 the oversized request timeout (--request-timeout 99999999999) is not clamped to 1 ms", async () => {
    await withStub(async ({ stub, home, cwd }) => {
      const r = await runAbx(["create", "--template", "base", "--request-timeout", "99999999999"], { home, cwd, url: stub.url });
      expect(r.stderr).not.toContain("TimeoutOverflowWarning");
      expect(r.status).toBe(0);
    });
  });

  it.skipIf(!havePython)("ADV-commands-16 pasted lines run in order, Ctrl+D on an empty prompt after type-ahead disconnects (C-01)", async () => {
    await withStub(async ({ stub, home, cwd, log }) => {
      const P = "abx:sbx-ev-0> ";
      const r = await ptySession(["connect", SB], { home, cwd, url: stub.url, timeout: 20, steps: [{ expect: P, send: "echo a\recho b\r\x04" }] });
      expect(r.timed_out).toBe(false);
      expect(r.code).toBe(0);
      const starts = (await log()).filter((e) => e.path === "/process.Process/Start").map((e) => JSON.stringify(e.body?.process?.args));
      expect(starts).toEqual(['["a"]', '["b"]']);
    });
  });

  it.skipIf(!havePython)("ADV-commands-17 Ctrl+W deletes a whitespace-delimited word (kills do not merge) and Ctrl+Y yanks it back (C-11)", async () => {
    await withStub(async ({ stub, home, cwd, log }) => {
      const P = "abx:sbx-ev-0> ";
      const r = await ptySession(["connect", SB], {
        home,
        cwd,
        url: stub.url,
        timeout: 20,
        steps: [
          { expect: P, send: "echo foo bar\x17\x19\x19\r" },
          { expect: P, send: "echo x-y z\x17\x17-\x19\r" },
          { expect: P, send: "exit\r" },
        ],
      });
      expect(r.code).toBe(0);
      const starts = (await log()).filter((e) => e.path === "/process.Process/Start").map((e) => JSON.stringify(e.body?.process?.args));
      expect(starts).toEqual(['["foo","barbar"]', '["-x-y"]']);
    });
  });

  it.skipIf(!havePython)("ADV-commands-18 TERM=dumb keeps line editing (history, Ctrl+A/K/U) like Python's readline (C-11)", async () => {
    await withStub(async ({ stub, home, cwd, log }) => {
      const P = "abx:sbx-ev-0> ";
      const env = baseEnv(home, stub.url, { TERM: "dumb", NO_COLOR: null });
      const spec = {
        argv: [process.execPath, "--import", TSX, ENTRY, "connect", SB],
        cwd,
        env,
        timeout: 20,
        steps: [
          { expect: P, send: "echo abc\x01\x0bXYZ\r" },
          { expect: P, send: "exit\r" },
        ],
      };
      const run = await collect("python3", [PTY_RUN, JSON.stringify(spec)], { cwd, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 40000 });
      const out = JSON.parse(run.stdout) as { code: number; timed_out: boolean };
      expect(out.timed_out).toBe(false);
      const starts = (await log()).filter((e) => e.path === "/process.Process/Start").map((e) => JSON.stringify(e.body?.process));
      expect(starts).toEqual(['{"cmd":"XYZ"}']);
    });
  });
});

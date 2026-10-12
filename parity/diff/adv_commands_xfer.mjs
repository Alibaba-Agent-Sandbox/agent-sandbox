#!/usr/bin/env node
/**
 * ADV-commands: upload / download / dir transfers (empty, big, binary, unicode names, symlinks, FIFOs, unreadable
 * files, nested dirs, odd remote paths, existing local files/dirs, parents that are files, 404/500/truncated bodies).
 * Own stub (binary-safe /files). Compares exit code, stdout, stderr, upload wire (multipart sha1 per part, query) and
 * the local files written.
 *   ORACLE_VENV=... node parity/diff/adv_commands_xfer.mjs [--only substr] [--jobs N]
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { argOf, requireOracle, runAll } from "./adv_commands_lib.mjs";
requireOracle();
const SB = "sbx-ev-001";

const BIG = Buffer.alloc(12 * 1024 * 1024);
for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 31 + (i >> 8)) & 255;
const REMOTE = new Map([
  ["/app/text.txt", Buffer.from("hello\nworld\n")],
  ["/app/empty", Buffer.alloc(0)],
  ["/app/bin.dat", Buffer.from(Array.from({ length: 256 }, (_, i) => i))],
  ["/app/big.bin", BIG],
  ["/app/日本語.txt", Buffer.from("unicode")],
  ["/app/crlf.txt", Buffer.from("a\r\nb\r\n")],
  ["/app/dir/", Buffer.from("not a file")],
  ["/trunc", Buffer.from("x".repeat(1000))],
]);

function makeStub(c) {
  const log = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, "http://stub");
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (url.pathname === "/__log") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(log)); }
      if (url.pathname === "/__world") { res.writeHead(200); return res.end("{}"); }
      const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), ct: (req.headers["content-type"] ?? "").split(";")[0] };
      const j = (st, o) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      let m = /^\/sandboxes\/([^/]+)$/.exec(url.pathname);
      if (m) {
        log.push(entry);
        if (m[1] !== SB) return j(404, { code: 404, message: "not found" });
        return j(200, { sandboxID: SB, templateID: "base", state: "running", cpuCount: 2, memoryMB: 2048, startedAt: "2026-01-02T03:04:05Z", endAt: "2026-01-02T03:09:05Z", envdVersion: "0.5.2", metadata: {}, envdUrl: origin, envdAccessToken: "tok", clientID: "c" });
      }
      if (url.pathname === "/files" && req.method === "POST") {
        const ctype = req.headers["content-type"] ?? "";
        const boundary = /boundary=([^;]+)/.exec(ctype)?.[1]?.replace(/^"|"$/g, "");
        const parts = [];
        if (boundary) {
          const raw = body.toString("latin1");
          for (const p of raw.split(`--${boundary}`)) {
            if (!p.trim() || p.startsWith("--")) continue;
            const [head, ...rest] = p.replace(/^\r\n/, "").split("\r\n\r\n");
            const content = Buffer.from(rest.join("\r\n\r\n").replace(/\r\n$/, ""), "latin1");
            parts.push({ name: /name="([^"]*)"/.exec(head)?.[1], filename: /filename="([^"]*)"/.exec(head)?.[1], bytes: content.length, sha: createHash("sha1").update(content).digest("hex").slice(0, 12), ctype: /content-type: (.*)/i.exec(head)?.[1]?.trim() });
          }
        }
        entry.parts = parts;
        log.push(entry);
        if (c.uploadStatus) return j(c.uploadStatus, { message: "upload failed" });
        return j(200, [{ name: "x", path: entry.query.path, type: "file" }]);
      }
      if (url.pathname === "/files" && req.method === "GET") {
        log.push(entry);
        const p = url.searchParams.get("path");
        if (p === "/trunc") { res.writeHead(200, { "content-type": "application/octet-stream", "content-length": "5000" }); res.write(REMOTE.get(p)); return setTimeout(() => res.socket.destroy(), 100); }
        if (p === "/500") return j(500, { message: "boom" });
        if (p === "/403") return j(403, { message: "denied" });
        const f = REMOTE.get(p);
        if (!f) return j(404, { code: "not_found", message: "file not found" });
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(f);
      }
      log.push(entry);
      if (url.pathname.startsWith("/templates")) return j(404, { message: "nf" });
      return j(404, { message: "no route" });
    });
  });
  return new Promise((ok) => {
    server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
    server.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }) }));
  });
}

const cases = [];
const add = (name, argv, extra = {}) => cases.push({ name, argv, stubFactory: makeStub, tree: true, timeoutMs: 90000, ...extra });
const put = (h, c, rel, data) => { const p = join(c, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, data); };

// ---- upload file
add("upload small", ["upload", SB, "a.txt", "/app/a.txt"], { setup: (h, c) => put(h, c, "a.txt", "hi\n") });
add("upload empty", ["upload", SB, "e", "/app/e"], { setup: (h, c) => put(h, c, "e", "") });
add("upload binary all bytes", ["upload", SB, "b", "/app/b"], { setup: (h, c) => put(h, c, "b", Buffer.from(Array.from({ length: 256 }, (_, i) => i))) });
add("upload 12MB", ["upload", SB, "big", "/app/big"], { setup: (h, c) => put(h, c, "big", BIG) });
add("upload unicode name", ["upload", SB, "日本語🎉.txt", "/app/日本語🎉.txt"], { setup: (h, c) => put(h, c, "日本語🎉.txt", "u") });
add("upload remote with spaces/quotes", ["upload", SB, "a.txt", "/app/a b'c\"d&e=f#g?h%20i.txt"], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload remote relative", ["upload", SB, "a.txt", "rel/a.txt"], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload remote empty", ["upload", SB, "a.txt", ""], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload remote slash", ["upload", SB, "a.txt", "/"], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload remote trailing slash", ["upload", SB, "a.txt", "/app/dir/"], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload remote dots", ["upload", SB, "a.txt", "/app/../etc/./x"], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload remote very long", ["upload", SB, "a.txt", "/" + "a".repeat(5000)], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload remote newline", ["upload", SB, "a.txt", "/app/a\nb"], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload local missing", ["upload", SB, "nope", "/app/x"]);
add("upload local dash", ["upload", SB, "-", "/app/x"]);
add("upload local empty string", ["upload", SB, "", "/app/x"]);
add("upload local tilde", ["upload", SB, "~/a.txt", "/app/x"], { setup: (h, c) => put(h, h, "a.txt", "x") });
add("upload local env var path", ["upload", SB, "$HOME/a.txt", "/app/x"], { setup: (h, c) => put(h, h, "a.txt", "x") });
add("upload local with ..", ["upload", SB, "d/../a.txt", "/app/x"], { setup: (h, c) => { put(h, c, "a.txt", "x"); mkdirSync(join(c, "d")); } });
add("upload local absolute", ["upload", SB, (ctx) => ctx, "/app/x"], {});
add("upload sandbox 404", ["upload", "sbx-nope", "a.txt", "/app/x"], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload server 500", ["upload", SB, "a.txt", "/app/x"], { setup: (h, c) => put(h, c, "a.txt", "x"), uploadStatus: 500 });
add("upload server 403", ["upload", SB, "a.txt", "/app/x"], { setup: (h, c) => put(h, c, "a.txt", "x"), uploadStatus: 403 });
add("upload server 413", ["upload", SB, "a.txt", "/app/x"], { setup: (h, c) => put(h, c, "a.txt", "x"), uploadStatus: 413 });
add("upload server 401", ["upload", SB, "a.txt", "/app/x"], { setup: (h, c) => put(h, c, "a.txt", "x"), uploadStatus: 401 });
add("upload server 429", ["upload", SB, "a.txt", "/app/x"], { setup: (h, c) => put(h, c, "a.txt", "x"), uploadStatus: 429 });
add("upload json", ["--json", "upload", SB, "a.txt", "/app/a.txt"], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload quiet", ["--quiet", "upload", SB, "a.txt", "/app/a.txt"], { setup: (h, c) => put(h, c, "a.txt", "x") });
add("upload symlink file", ["upload", SB, "ln", "/app/ln"], { setup: (h, c) => { put(h, c, "t", "target"); symlinkSync("t", join(c, "ln")); } });
add("upload broken symlink", ["upload", SB, "ln", "/app/ln"], { setup: (h, c) => symlinkSync("missing", join(c, "ln")) });
add("upload fifo", ["upload", SB, "ff", "/app/ff"], { setup: (h, c) => execFileSync("mkfifo", [join(c, "ff")]) });
add("upload /dev/null", ["upload", SB, "/dev/null", "/app/ff"]);
add("upload unreadable file", ["upload", SB, "nr", "/app/nr"], { setup: (h, c) => { put(h, c, "nr", "x"); chmodSync(join(c, "nr"), 0o000); } });
// ---- upload dir
add("upload empty dir", ["upload", SB, "d", "/app/d"], { setup: (h, c) => mkdirSync(join(c, "d")) });
add("upload dir nested", ["upload", SB, "d", "/app/d"], { setup: (h, c) => { put(h, c, "d/a.txt", "a"); put(h, c, "d/sub/b.txt", "b"); put(h, c, "d/sub/deep/c.txt", "c"); mkdirSync(join(c, "d/emptysub")); } });
add("upload dir trailing slash", ["upload", SB, "d/", "/app/d/"], { setup: (h, c) => { put(h, c, "d/a.txt", "a"); put(h, c, "d/sub/b.txt", "b"); } });
add("upload dir remote double slash", ["upload", SB, "d", "/app//d//"], { setup: (h, c) => put(h, c, "d/a.txt", "a") });
add("upload dir remote root", ["upload", SB, "d", "/"], { setup: (h, c) => put(h, c, "d/a.txt", "a") });
add("upload dir remote empty", ["upload", SB, "d", ""], { setup: (h, c) => put(h, c, "d/a.txt", "a") });
add("upload dir unicode", ["upload", SB, "d", "/app/日本"], { setup: (h, c) => { put(h, c, "d/日本語/é.txt", "a"); put(h, c, "d/with space/x y.txt", "b"); } });
add("upload dir hidden", ["upload", SB, "d", "/app/d"], { setup: (h, c) => { put(h, c, "d/.hidden", "a"); put(h, c, "d/.git/config", "b"); } });
add("upload dir symlinks", ["upload", SB, "d", "/app/d"], { setup: (h, c) => { put(h, c, "d/real.txt", "r"); symlinkSync("real.txt", join(c, "d/ln.txt")); mkdirSync(join(c, "d/sub")); put(h, c, "d/sub/s.txt", "s"); symlinkSync("sub", join(c, "d/lnsub")); symlinkSync("missing", join(c, "d/broken")); symlinkSync("..", join(c, "d/loop")); } });
add("upload dir with fifo", ["upload", SB, "d", "/app/d"], { setup: (h, c) => { put(h, c, "d/a", "a"); execFileSync("mkfifo", [join(c, "d/ff")]); } });
add("upload dir unreadable file", ["upload", SB, "d", "/app/d"], { setup: (h, c) => { put(h, c, "d/a", "a"); put(h, c, "d/nr", "x"); chmodSync(join(c, "d/nr"), 0o000); } });
add("upload dir many files", ["upload", SB, "d", "/app/d"], { setup: (h, c) => { for (let i = 0; i < 120; i++) put(h, c, `d/f${String(i).padStart(3, "0")}.txt`, `file ${i}`); } });
add("upload dir 500", ["upload", SB, "d", "/app/d"], { setup: (h, c) => put(h, c, "d/a", "a"), uploadStatus: 500 });
add("upload dir json", ["--json", "upload", SB, "d", "/app/d"], { setup: (h, c) => put(h, c, "d/a", "a") });
add("upload dir quiet", ["--quiet", "upload", SB, "d", "/app/d"], { setup: (h, c) => put(h, c, "d/a", "a") });
add("upload dir files with colon star", ["upload", SB, "d", "/app/d"], { setup: (h, c) => { put(h, c, "d/a:b", "a"); put(h, c, "d/c*d", "b"); put(h, c, "d/e\\f", "c"); put(h, c, "d/q\"uote", "d"); } });
// ---- download
add("download text", ["download", SB, "/app/text.txt", "out.txt"]);
add("download to dir", ["download", SB, "/app/text.txt", "."]);
add("download to existing dir sub", ["download", SB, "/app/text.txt", "sub"], { setup: (h, c) => mkdirSync(join(c, "sub")) });
add("download to dir w/ trailing slash", ["download", SB, "/app/text.txt", "sub/"], { setup: (h, c) => mkdirSync(join(c, "sub")) });
add("download to missing dir trailing slash", ["download", SB, "/app/text.txt", "newdir/"]);
add("download to nested new path", ["download", SB, "/app/text.txt", "a/b/c/out.txt"]);
add("download overwrite existing", ["download", SB, "/app/text.txt", "out.txt"], { setup: (h, c) => put(h, c, "out.txt", "OLD CONTENT LONGER THAN NEW") });
add("download over readonly", ["download", SB, "/app/text.txt", "out.txt"], { setup: (h, c) => { put(h, c, "out.txt", "old"); chmodSync(join(c, "out.txt"), 0o444); } });
add("download parent is file", ["download", SB, "/app/text.txt", "f/out.txt"], { setup: (h, c) => put(h, c, "f", "i am a file") });
add("download target is dir-symlink", ["download", SB, "/app/text.txt", "lnd"], { setup: (h, c) => { mkdirSync(join(c, "real")); symlinkSync("real", join(c, "lnd")); } });
add("download target is file-symlink", ["download", SB, "/app/text.txt", "lnf"], { setup: (h, c) => { put(h, c, "real", "R"); symlinkSync("real", join(c, "lnf")); } });
add("download target is broken-symlink", ["download", SB, "/app/text.txt", "lnb"], { setup: (h, c) => symlinkSync("missing", join(c, "lnb")) });
add("download empty", ["download", SB, "/app/empty", "e"]);
add("download binary", ["download", SB, "/app/bin.dat", "b"]);
add("download 12MB", ["download", SB, "/app/big.bin", "big"]);
add("download unicode remote", ["download", SB, "/app/日本語.txt", "."]);
add("download unicode local", ["download", SB, "/app/text.txt", "日本語🎉.txt"]);
add("download crlf", ["download", SB, "/app/crlf.txt", "c"]);
add("download remote trailing slash to dir", ["download", SB, "/app/dir/", "."]);
add("download remote no slash name", ["download", SB, "text.txt", "."]);
add("download remote empty", ["download", SB, "", "."]);
add("download local empty", ["download", SB, "/app/text.txt", ""]);
add("download local dot-dot", ["download", SB, "/app/text.txt", ".."]);
add("download local tilde", ["download", SB, "/app/text.txt", "~/x"]);
add("download local /dev/null", ["download", SB, "/app/text.txt", "/dev/null"]);
add("download local /dev/full", ["download", SB, "/app/text.txt", "/dev/full"]);
add("download local unwritable dir", ["download", SB, "/app/text.txt", "ro/out"], { setup: (h, c) => { mkdirSync(join(c, "ro")); chmodSync(join(c, "ro"), 0o555); } });
add("download local name too long", ["download", SB, "/app/text.txt", "x".repeat(300)]);
add("download local nul-ish", ["download", SB, "/app/text.txt", "a\nb"]);
add("download 404", ["download", SB, "/nope", "out"]);
add("download 500", ["download", SB, "/500", "out"]);
add("download 403", ["download", SB, "/403", "out"]);
add("download truncated body", ["download", SB, "/trunc", "out"]);
add("download sandbox 404", ["download", "sbx-nope", "/app/text.txt", "out"]);
add("download json", ["--json", "download", SB, "/app/text.txt", "out"]);
add("download quiet", ["--quiet", "download", SB, "/app/text.txt", "out"]);
add("download ci", ["--ci", "download", SB, "/app/text.txt", "out"]);
add("download no creds", ["download", SB, "/app/text.txt", "out"], { creds: false });
// round trip names with leading dash
add("download local starts with dash", ["download", SB, "/app/text.txt", "--", "-x"]);
add("download local dash after --", ["download", SB, "--", "/app/text.txt", "-x"]);
const filt = argOf("--only");
const resolved = cases.map((c) => (typeof c.argv.find((a) => typeof a === "function") === "function" ? { ...c, argv: ({ cwd }) => c.argv.map((a) => (typeof a === "function" ? a(cwd) : a)) } : c));
const diffs = await runAll(resolved, { jobs: Number(argOf("--jobs") ?? 4), only: filt });
process.exitCode = diffs.length ? 1 : 0;

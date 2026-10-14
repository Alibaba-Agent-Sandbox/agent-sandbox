import fs from "node:fs";
import http from "node:http";

import { WebSocketServer } from "ws";

/** A local E2B-shaped backend that serves the control plane and envd on one port. */

export interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface E2BMock {
  origin: string;
  port: number;
  seen: Seen[];
  flags: {
    connectStatus: number;
    omitToken: boolean;
    envdUrl: string | null;
    unauthorized: boolean;
    /** Shape of `GET /v2/sandboxes`: a bare array, or wrapped as `{sandboxes}` / `{data}`. */
    listAs: "array" | "sandboxes" | "data";
    /** Leave `domain` off the sandbox payload so the client uses its configured default. */
    omitDomain: boolean;
  };
  close(): Promise<void>;
}

/** Control-plane `/kruise/api` and private data-plane `/kruise/{id}/{port}` both sit on this server. */
function routeOf(raw: string): string {
  const q = raw.indexOf("?");
  const path = q >= 0 ? raw.slice(0, q) : raw;
  const query = q >= 0 ? raw.slice(q) : "";
  let p = path;
  if (p === "/kruise/api" || p.startsWith("/kruise/api/")) p = p.slice("/kruise/api".length) || "/";
  else {
    const prefixed = /^\/kruise\/[^/]+\/\d+(?=\/|$)/.exec(p);
    if (prefixed) p = p.slice(prefixed[0].length) || "/";
  }
  if (!p.startsWith("/")) p = `/${p}`;
  return p + query;
}

const frame = (flags: number, payload: object): Buffer => {
  const raw = Buffer.from(JSON.stringify(payload));
  const head = Buffer.alloc(5);
  head.writeUInt8(flags, 0);
  head.writeUInt32BE(raw.length, 1);
  return Buffer.concat([head, raw]);
};

export async function startE2BMock(): Promise<E2BMock> {
  const seen: Seen[] = [];
  const flags = {
    connectStatus: 200,
    omitToken: false,
    envdUrl: null as string | null,
    unauthorized: false,
    listAs: "array" as "array" | "sandboxes" | "data",
    omitDomain: process.env["ABX_E2B_MOCK_OMIT_DOMAIN"] === "1",
  };
  const seenPath = process.env["ABX_E2B_MOCK_SEEN"];
  let killed = false;
  const note = (entry: Seen): void => {
    seen.push(entry);
    if (!seenPath) return;
    const headers = entry.headers;
    const values = Object.values(headers).flatMap((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]));
    fs.appendFileSync(
      seenPath,
      `${JSON.stringify({
        method: entry.method,
        url: entry.url,
        headers: {
          "x-api-key": headers["x-api-key"] ?? null,
          authorization: headers["authorization"] ?? null,
          "x-access-token": headers["x-access-token"] ?? null,
          "e2b-sandbox-port": headers["e2b-sandbox-port"] ?? null,
        },
        values,
      })}\n`,
    );
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = routeOf(req.url ?? "");
      note({ method: req.method ?? "", url, headers: req.headers, body });
      const json = (status: number, payload: unknown): void => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (flags.unauthorized) return json(401, { message: "unauthorized" });
      const info = {
        sandboxID: "sbx-1",
        templateID: "base",
        ...(flags.omitToken ? {} : { envdAccessToken: "tok" }),
        ...(flags.envdUrl ? { envdUrl: flags.envdUrl } : {}),
        envdVersion: "0.2.0",
        clientID: "c",
        state: "running",
        ...(flags.omitDomain ? {} : { domain: "reported.test" }),
      };
      const forced = /\/sandboxes\/status-(401|404|503)(?:\/|$|\?)/.exec(url);
      if (forced) {
        const status = Number(forced[1]);
        return json(status, { code: status, message: `forced ${status}` });
      }
      if (req.method === "POST" && url === "/sandboxes") {
        let template = "";
        try {
          template = String((JSON.parse(body.toString("utf8") || "{}") as { templateID?: string }).templateID ?? "");
        } catch {
          template = "";
        }
        if (template === "status-401") return json(401, { code: 401, message: "invalid api key" });
        if (template === "status-404") return json(404, { code: 404, message: "template not found" });
        if (template === "status-429") return json(429, { code: 429, message: "quota exceeded" });
        if (template === "status-400") return json(400, { code: 400, message: "bad create" });
        if (template === "status-503") return json(503, { code: 503, message: "backend unavailable" });
        killed = false;
        return json(201, info);
      }
      if (killed && /^\/(v2\/)?sandboxes\/sbx-1/.test(url) && req.method !== "DELETE") {
        return json(404, { code: 404, message: "sandbox not found" });
      }
      if (req.method === "POST" && /\/sandboxes\/sbx-1\/connect$/.test(url)) {
        if (flags.connectStatus === 200) return json(200, info);
        res.writeHead(flags.connectStatus).end();
        return;
      }
      if (req.method === "POST" && url === "/sandboxes/sbx-1/resume") return void res.writeHead(204).end();
      if (req.method === "POST" && url === "/sandboxes/sbx-1/pause") return void res.writeHead(204).end();
      if (req.method === "POST" && url === "/sandboxes/sbx-1/timeout") return void res.writeHead(204).end();
      if (req.method === "DELETE" && url === "/sandboxes/sbx-1") {
        killed = true;
        return void res.writeHead(204).end();
      }
      if (req.method === "GET" && url === "/sandboxes/sbx-1") return json(200, info);
      if (req.method === "GET" && (url.startsWith("/v2/sandboxes") || url.startsWith("/sandboxes?"))) {
        const rows = killed ? [] : [info];
        if (flags.listAs === "sandboxes") return json(200, { sandboxes: rows });
        if (flags.listAs === "data") return json(200, { data: rows });
        return json(200, rows);
      }
      if (req.method === "POST" && url === "/process.Process/Start") {
        let cmd = "";
        try {
          cmd = String((JSON.parse(body.toString("utf8")) as { process?: { cmd?: string } }).process?.cmd ?? "");
        } catch {
          cmd = "";
        }
        if (cmd === "status-500") return json(500, { message: "envd exploded" });
        res.writeHead(200, { "Content-Type": "application/connect+json" });
        res.end(
          Buffer.concat([
            frame(0, { event: { start: { pid: 7 } } }),
            frame(0, { event: { data: { stdout: Buffer.from("hi\n").toString("base64") } } }),
            frame(0, { event: { end: { exitCode: 0, exited: true } } }),
            frame(2, {}),
          ]),
        );
        return;
      }
      if (url.startsWith("/files?")) {
        const target = new URL(url, "http://127.0.0.1").searchParams.get("path") ?? "";
        if (target.includes("status-404")) return json(404, { message: "missing" });
        if (target.includes("status-500")) return json(500, { message: "envd failed" });
        if (req.method === "GET") return void res.writeHead(200).end("file-bytes");
        return json(201, [{ path: "/x", name: "x", type: "file" }]);
      }
      if (req.method === "POST" && url === "/execute") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.end(`${JSON.stringify({ type: "stdout", text: "42\n" })}\n${JSON.stringify({ type: "result", text: "42" })}\n`);
        return;
      }
      if (req.method === "POST" && url === "/filesystem.Filesystem/ListDir") {
        return json(200, { entries: [{ name: "a.txt", path: "/tmp/a.txt", type: "file", size: 5 }] });
      }
      if (req.method === "POST" && url === "/filesystem.Filesystem/Stat") {
        return json(200, { entry: { name: "a.txt", path: "/tmp/a.txt", type: "file", size: 5 } });
      }
      if (req.method === "POST" && url === "/process.Process/List") {
        return json(200, { processes: [{ pid: 7, config: { cmd: "echo", args: ["hi"] } }] });
      }
      if (req.method === "POST" && (url === "/process.Process/SendSignal" || url === "/process.Process/SendInput")) {
        return json(200, {});
      }
      if (req.method === "POST" && url === "/code.CodeInterpreter/Execute") {
        return json(200, { result: { stdout: "42\n", text: "42", stderr: "", exitCode: 0 } });
      }
      if (req.method === "POST" && url === "/filesystem.Filesystem/WatchDir") {
        res.writeHead(200, { "Content-Type": "application/connect+json" });
        res.end(Buffer.concat([frame(0, { filesystem: { name: "/tmp/a.txt", type: "EVENT_TYPE_WRITE" } }), frame(2, {})]));
        return;
      }
      res.writeHead(404).end("{}");
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    seen.push({ method: "UPGRADE", url: req.url ?? "", headers: req.headers, body: Buffer.alloc(0) });
    if (req.url !== "/terminal") return void socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => ws.on("message", (data, isBinary) => ws.send(data, { binary: isBinary })));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    seen,
    flags,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

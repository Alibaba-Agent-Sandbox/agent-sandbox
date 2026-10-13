/** Adversarial review fix (AT-03): `mcp start --http` accepts request heads beyond Node's 16 KiB default cap. */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ENTRY,
  ORACLE_BIN,
  TSX,
  sandbox,
  useAdvSandboxes,
} from "../helpers/advAgentTemplate.js";

useAdvSandboxes();

describe("ADV-agent-template: mcp start --http", () => {
  async function freePort(): Promise<number> {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const { port } = srv.address() as net.AddressInfo;
    await new Promise((r) => srv.close(r));
    return port;
  }

  function rawGet(port: number, request: string): Promise<string> {
    return new Promise((resolve) => {
      const sock = net.connect(port, "127.0.0.1", () => sock.write(request));
      const chunks: Buffer[] = [];
      sock.on("data", (d) => chunks.push(d));
      sock.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
      sock.on("error", () => resolve(Buffer.concat(chunks).toString("latin1")));
      setTimeout(() => sock.destroy(), 3000);
    });
  }

  it("ADV-agent-template-13 the HTTP server accepts a 20 KB request header (uvicorn/httptools has no 16 KiB cap)", async () => {
    const sb = sandbox();
    const port = await freePort();
    const args = [
      "mcp",
      "start",
      "--http",
      "--port",
      String(port),
      "--api-key",
      "k-stub",
      "--api-url",
      "http://127.0.0.1:9",
      "--template",
      "t",
    ];
    const cmd = ORACLE_BIN || process.execPath;
    const argv = ORACLE_BIN ? args : ["--import", TSX, ENTRY, ...args];
    const run = path.join(sb.home, "run");
    mkdirSync(run);
    const proc = spawn(cmd, argv, {
      cwd: sb.work,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: sb.home,
        ABX_NO_KEYCHAIN: "1",
        ABX_MCP_RUNTIME_DIR: run,
        LANG: "C.UTF-8",
        NO_PROXY: "*",
      },
      stdio: "ignore",
    });
    try {
      let up = "";
      for (let i = 0; i < 100 && !up; i += 1) {
        up = await rawGet(
          port,
          "GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
        );
        if (!up) await new Promise((r) => setTimeout(r, 200));
      }
      expect(up.startsWith("HTTP/1.1 200")).toBe(true);
      const big = await rawGet(
        port,
        `GET /health HTTP/1.1\r\nHost: x\r\nX-Big: ${"a".repeat(20000)}\r\nConnection: close\r\n\r\n`,
      );
      expect(big.split("\r\n")[0]).toBe("HTTP/1.1 200 OK");
    } finally {
      proc.kill("SIGKILL");
    }
  });
});

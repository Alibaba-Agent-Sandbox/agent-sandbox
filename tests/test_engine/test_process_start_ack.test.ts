/** Real EPP subprocess -> process model -> engine HTTP/SSE startup acknowledgement. */
import { describe, expect, it } from "vitest";
import { startEngine } from "../../src/engine/server.js";
import * as installer from "../../src/providers/installer.js";
import { useIso } from "../_support/iso.js";
import { LOCAL_PROCESS, TEST_HOST_VERSION, pythonAvailable } from "../_support/plugins.js";

useIso();

describe.skipIf(!pythonAvailable())("engine process startup acknowledgement", () => {
  it("preserves a backend-issued opaque ID over real SSE before a silent process exits", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    const engine = await startEngine({ idle_timeout: 0 });
    const base = `http://127.0.0.1:${engine.record.port}`;
    const headers = {
      Authorization: `Bearer ${engine.record.token}`,
      "X-Abx-Connection": Buffer.from(JSON.stringify({ provider: "local-process" })).toString("base64url"),
      "Content-Type": "application/json",
    };
    let sandboxId: string | null = null;
    try {
      const created = await fetch(`${base}/v1/sandboxes`, { method: "POST", headers, body: JSON.stringify({ template: "base" }) });
      expect(created.status).toBe(201);
      sandboxId = ((await created.json()) as { sandbox_id: string }).sandbox_id;
      const response = await fetch(`${base}/v1/sandboxes/${sandboxId}/commands/stream`, {
        method: "POST", headers,
        body: JSON.stringify({ cmd: process.execPath, args: ["-e", "setTimeout(() => process.exit(0), 50)"], timeout: 5 }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const chunks = (await response.text()).split("\n\n").filter(frame => frame.startsWith("data: ")).map(frame => JSON.parse(frame.slice(6)));
      expect(chunks[0]).toMatchObject({ type: "stdout", data: "", pid: expect.stringMatching(/^[a-f0-9]{8}$/) });
      expect(chunks.at(-1)).toMatchObject({ type: "exit", exit_code: 0, pid: chunks[0].pid });
    } finally {
      try {
        if (sandboxId !== null) {
          const removed = await fetch(`${base}/v1/sandboxes/${sandboxId}`, { method: "DELETE", headers });
          expect(removed.status).toBe(200);
        }
      } finally { await engine.close(); }
    }
  });
});

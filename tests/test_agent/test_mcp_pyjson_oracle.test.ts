/**
 * Oracle-backed check of the MCP stdio server's JSON number / object handling: every request line in
 * `parity/diff/mcp_pyjson_cases.json` was answered by the original Python server (see `mcp_pyjson_gen.py`) and the
 * Node server must reproduce each response byte for byte (whole floats stay floats, big ints stay exact,
 * `NaN`/`Infinity` ids, duplicate keys, integer-like keys keep insertion order).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CASES = JSON.parse(
  fs.readFileSync(path.join(ROOT, "parity", "diff", "mcp_pyjson_cases.json"), "utf-8"),
) as { cases: Array<[string, string | null]> };

const home = fs.mkdtempSync(path.join(os.tmpdir(), "abx-mcp-pyjson-"));
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

async function drive(): Promise<Array<string | null>> {
  // This is a JSON fidelity oracle, not a test of the host's port-1/proxy behavior.
  // Fix the backend failure so platform interception cannot rewrite its bytes.
  const probe = [
    'import { sdk } from "./src/agent/mcp.ts";',
    'import { ConnectionError_ } from "./src/models/errors.ts";',
    'import { main } from "./src/agent/mcp_main.ts";',
    'sdk.loadSandbox = async () => ({ create: async () => { throw new ConnectionError_("Failed to connect to Platform API: All connection attempts failed", {suggestion: "Check network connectivity and API base URL."}); } });',
    'await main();',
  ].join("\n");
  const proc = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", probe], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ABX_NO_KEYCHAIN: "1",
      ABX_SANDBOX_API_KEY: "stub-key",
      ABX_SANDBOX_BASE_URL: "http://127.0.0.1:1",
      ABX_DEFAULT_TEMPLATE: "stub-template",
      NO_PROXY: "*",
      no_proxy: "*",
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let buf = "";
  proc.stdout.setEncoding("utf-8");
  proc.stdout.on("data", (c: string) => {
    buf += c;
    let at: number;
    while ((at = buf.indexOf("\n")) !== -1) {
      queue.push(buf.slice(0, at));
      buf = buf.slice(at + 1);
    }
    wake?.();
  });
  const next = async (): Promise<string> => {
    while (queue.length === 0) await new Promise<void>((r) => ((wake = r), setTimeout(r, 20_000)));
    return queue.shift() as string;
  };
  const out: Array<string | null> = [];
  for (const [line, expected] of CASES.cases) {
    proc.stdin.write(line + "\n");
    out.push(expected === null ? null : await next());
  }
  proc.stdin.end();
  await new Promise((r) => proc.on("close", r));
  return out;
}

describe("MCP stdio JSON fidelity vs the Python server", () => {
  it("answers every recorded request line exactly like the oracle", async () => {
    const got = await drive();
    const unversion = (line: string | null | undefined): string | null | undefined =>
      line?.replace(/("serverInfo": \{"name": "agent-sandbox", "version": )"[^"]*"/, '$1"<version>"')
        // Tool catalog additions are tested in test_tools; this oracle keeps wire-number fidelity.
        // Keep the historical fixture unchanged while normalizing only its versioned catalog value.
        .replace(/("result": \{"tools": )\[[\s\S]*\](\}\})$/, '$1"<tool-catalog>"$2');
    CASES.cases.forEach(([req, res], i) => expect({ req, res: unversion(got[i]) }).toEqual({ req, res: unversion(res) }));
  }, 120_000);
});

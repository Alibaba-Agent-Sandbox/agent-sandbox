/** Run helper argv through the real CLI parser, replacing cloud work with help. */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe.skipIf(process.platform === "win32")("deployment helper parser contract", () => {
  it.each([["build_hermes.sh", 2], ["deploy_all_templates.sh", 20]] as const)(
    "%s selects Express and parses every invocation before cloud work", (script, expectedCalls) => {
      const folder = mkdtempSync(join(tmpdir(), "abx-helper-contract-"));
      folders.push(folder);
      const wrapper = join(folder, "abx-help.mjs");
      const trace = join(folder, "argv.jsonl");
      writeFileSync(wrapper, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
appendFileSync(process.env.ABX_HELP_TRACE, JSON.stringify(args) + "\\n");
const result = spawnSync(process.execPath, [process.env.ABX_ACTUAL_ENTRY, ...args, "--help"], { encoding: "utf8", timeout: 30000 });
if (result.error) throw result.error;
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
`);
      chmodSync(wrapper, 0o700);
      execFileSync("bash", [fileURLToPath(new URL(`../../scripts/${script}`, import.meta.url))], {
        encoding: "utf8", timeout: 90_000,
        env: { PATH: process.env.PATH, HOME: folder, ABX_PROVIDER: "opensandbox", ABX_BIN: wrapper,
          ABX_ACTUAL_ENTRY: fileURLToPath(new URL("../../dist/bin/abx.js", import.meta.url)),
          ABX_HELP_TRACE: trace, ACR_NAMESPACE: "parser-only", REGION: "cn-shanghai",
          EXAMPLES_TEMPLATES_DIR: join(folder, "no-fixtures"), RESULTS_FILE: join(folder, "results.txt") },
      });
      const calls = readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      expect(calls).toHaveLength(expectedCalls);
      for (const args of calls) {
        expect(args.slice(0, 3)).toEqual(["--provider", "alicloud-express", "template"]);
        expect(args.indexOf("--region")).toBeGreaterThan(3);
        expect(args[args.indexOf("--region") + 1]).toBe("cn-shanghai");
        expect(args).not.toContain("--official-api");
        expect(args).not.toContain("--legacy-api");
      }
    }, 90_000,
  );
});

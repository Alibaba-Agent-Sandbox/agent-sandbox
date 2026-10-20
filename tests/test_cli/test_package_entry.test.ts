/** Package content validation must accept supported npm report shapes without losing its gate. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/check-package-entry.mjs", import.meta.url));

for (const shape of ["array", "object"] as const) {
  for (const included of [true, false]) {
    it(`${shape} report ${included ? "accepts" : "rejects a missing"} CLI entry point`, () => {
      const entry = { files: [{ path: included ? "dist/bin/abx.js" : "README.md" }] };
      const report = shape === "array" ? [entry] : { "@agent-sandbox/cli": entry };
      const result = spawnSync(process.execPath, [script], { input: JSON.stringify(report), encoding: "utf8" });
      expect(result.status).toBe(included ? 0 : 1);
      expect(result.stdout + result.stderr).toContain(included ? "found in package: OK" : "NOT found in package");
    });
  }
}

it("rejects malformed pack output", () => {
  const result = spawnSync(process.execPath, [script], { input: "invalid JSON", encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Invalid npm pack JSON report");
});

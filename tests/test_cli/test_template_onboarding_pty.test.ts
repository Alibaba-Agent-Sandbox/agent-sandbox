import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const available = process.platform !== "win32" && existsSync(`${root}/dist/bin/abx.js`) &&
  spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;

it.skipIf(!available)("built CLI preserves template consent through a real POSIX terminal", () => {
  const result = spawnSync(process.execPath, ["e2e/onboarding.mjs"], {
    cwd: root, encoding: "utf8", timeout: 55000, env: { ...process.env, ABX_BIN: "" },
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout.match(/^PASS:/gm)).toHaveLength(6);
}, 60000);

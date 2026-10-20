import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { selectCommandSurface } from "../../src/cli/entry_surface.js";

describe("explicit project command surface", () => {
  it("preserves the selected provider and all native command arguments", () => {
    expect(selectCommandSurface(["--native", "--provider", "example-provider", "template", "list", "--official-api"]))
      .toEqual({ native: true, args: ["--provider", "example-provider", "template", "list", "--official-api"] });
  });

  it("never consumes a flag in remote exec input", () => {
    const args = ["exec", "owned-sandbox", "printf", "--native"];
    expect(selectCommandSurface(args)).toEqual({ native: false, args });
  });

  it("keeps the default entry point unchanged", () => {
    expect(selectCommandSurface(["template", "list"])).toEqual({ native: false, args: ["template", "list"] });
    expect(selectCommandSurface([])).toEqual({ native: false, args: [] });
  });

  it("executes the packaged native entry without exposing cloud credentials", () => {
    const executable = fileURLToPath(new URL("../../dist/bin/abx.js", import.meta.url));
    const output = execFileSync(process.execPath, [executable, "--native", "config", "get", "region"], {
      encoding: "utf8", env: { ...process.env, ALIBABA_CLOUD_REGION_ID: "cn-hangzhou" },
    });
    expect(output).toContain("cn-hangzhou");
    const help = execFileSync(process.execPath, [executable, "--native", "template", "list", "--help"], { encoding: "utf8" });
    expect(help).toContain("--official-api");
  });
});

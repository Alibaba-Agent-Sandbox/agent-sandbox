import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bundled protocol boundary", () => {
  it("imports a library without parsing argv or changing environment", async () => {
    const before = { ...process.env }; const argv = [...process.argv];
    const runtime = await import("../../src/standard_cli/runtime.mjs");
    expect(runtime.Sandbox.createSnapshot).toBeTypeOf("function");
    expect(runtime.Sandbox.fork).toBeTypeOf("function");
    expect(runtime.Sandbox.updateNetwork).toBeTypeOf("function");
    expect(process.argv).toEqual(argv); expect(process.env).toEqual(before);
    const source = readFileSync(new URL("../../src/standard_cli/runtime.mjs", import.meta.url), "utf8");
    expect(source).not.toContain("parseAsync(");
    expect(source).not.toContain("sandboxCommand");
    expect(source).not.toContain("updateNotifier");
  });
});

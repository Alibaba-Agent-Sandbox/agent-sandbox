import { describe, expect, it } from "vitest";

import { YAMLError, dumpYaml, isMapping, loadYaml } from "../../src/utils/yaml_io.js";

describe("loadYaml", () => {
  it("reads YAML 1.1 booleans, timestamps and repeated keys", () => {
    const data = loadYaml("a: yes\nb: 2024-01-02\nc: 1\nc: 2\n") as Record<string, unknown>;
    expect(data["a"]).toBe(true);
    expect(data["b"]).toBeInstanceOf(Date);
    expect(data["c"]).toBe(2);
  });

  it("reports malformed input with a line and column", () => {
    expect(() => loadYaml("a: [1\nb: 2\n")).toThrow(YAMLError);
    expect(() => loadYaml("a: [1\nb: 2\n")).toThrow(/line 2, column 1/);
  });

  it.each([
    ["an unknown tag", "z: !!python/object/apply:os.system [echo pwn]\n", /Unresolved tag/],
    ["a NUL character", "name: demo\0\n", /#x0000/],
  ])("rejects %s", (_name, text, message) => {
    expect(() => loadYaml(text)).toThrow(message);
  });
});

describe("dumpYaml", () => {
  it("keeps key order and writes block style with unindented sequences", () => {
    expect(dumpYaml({ name: "x", ports: [9000, 8080], resources: { cpu: 1 }, note: "quoted: yes" })).toBe(
      "name: x\nports:\n- 9000\n- 8080\nresources:\n  cpu: 1\nnote: 'quoted: yes'\n",
    );
  });

  it("round-trips through loadYaml", () => {
    const data = { name: "x", version: "1.0", env: { A: "1" }, tags: ["a", "b"] };
    expect(loadYaml(dumpYaml(data))).toEqual(data);
  });
});

describe("isMapping", () => {
  it("is true only for plain objects", () => {
    expect(isMapping({})).toBe(true);
    for (const v of [null, [], new Set(), new Date(), "x", 1]) expect(isMapping(v)).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTemplateEnvironment } from "../../src/template/environment.js";

afterEach(() => vi.unstubAllEnvs());

describe("template runtime environment", () => {
  it("requires a declared application token without borrowing a baked default", () => {
    vi.stubEnv("ABX_SERVER_TOKEN", "");
    expect(() => resolveTemplateEnvironment({ ABX_SERVER_TOKEN: "model-default" })).toThrow("require ABX_SERVER_TOKEN");
  });

  it("resolves only declared environment and gives explicit runtime values priority", () => {
    vi.stubEnv("ABX_SERVER_TOKEN", "host-token");
    vi.stubEnv("UNDECLARED_SECRET", "never-inherit");
    vi.stubEnv("EMPTY_DEFAULT", "host-default");
    expect(resolveTemplateEnvironment({ ABX_SERVER_TOKEN: "", EMPTY_DEFAULT: "", HAS_DEFAULT: "declared-default" }, { ABX_SERVER_TOKEN: "explicit-token", EXTRA: "explicit-extra" })).toEqual({ ABX_SERVER_TOKEN: "explicit-token", EMPTY_DEFAULT: "host-default", HAS_DEFAULT: "declared-default", EXTRA: "explicit-extra" });
  });

  it.each(["", "   ", "line\nbreak", "line\rbreak"])("rejects an unusable explicit token", (token) => {
    vi.stubEnv("ABX_SERVER_TOKEN", "host-token");
    expect(() => resolveTemplateEnvironment({ ABX_SERVER_TOKEN: "" }, { ABX_SERVER_TOKEN: token })).toThrow("require ABX_SERVER_TOKEN");
  });

  it("preserves an intentionally anonymous existing template without adding credentials", () => {
    vi.stubEnv("ABX_SERVER_TOKEN", "host-token");
    expect(resolveTemplateEnvironment({ LANG: "C.UTF-8" })).toEqual({ LANG: "C.UTF-8" });
  });
});

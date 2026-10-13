import { afterEach, describe, expect, it } from "vitest";

import { injectedPackageVersion } from "../../src/utils/package_version.js";

describe("injectedPackageVersion", () => {
  afterEach(() => {
    delete (globalThis as { __ABX_VERSION?: string }).__ABX_VERSION;
  });

  it("is absent unless the binary banner set it", () => {
    expect(injectedPackageVersion()).toBeUndefined();
  });

  it("returns the version baked into a standalone binary", () => {
    (globalThis as { __ABX_VERSION?: string }).__ABX_VERSION = "0.3.0";
    expect(injectedPackageVersion()).toBe("0.3.0");
  });

  it("ignores an empty banner value", () => {
    (globalThis as { __ABX_VERSION?: string }).__ABX_VERSION = "";
    expect(injectedPackageVersion()).toBeUndefined();
  });
});

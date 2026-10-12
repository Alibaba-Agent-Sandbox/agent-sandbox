/** Version of this CLI host, checked against a plugin's `[compat] requires = { cli = ">=..." }`. */

import { readFileSync } from "node:fs";

import { injectedPackageVersion } from "../utils/package_version.js";

let cached: string | null = null;

export function hostVersion(): string {
  if (cached !== null) return cached;
  const injected = injectedPackageVersion();
  if (injected !== undefined) {
    cached = injected;
    return cached;
  }
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    cached = typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}

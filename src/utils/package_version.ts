/**
 * Version of this CLI package.
 *
 * A standalone binary has no `package.json` beside the executable. `scripts/build_binary.mjs`
 * sets `globalThis.__ABX_VERSION` before any CLI code runs. Source checkouts and `npm` installs
 * still read `package.json`.
 */

export function injectedPackageVersion(): string | undefined {
  const value = (globalThis as { __ABX_VERSION?: unknown }).__ABX_VERSION;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

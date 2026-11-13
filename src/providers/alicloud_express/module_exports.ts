/** Normalize the published CommonJS SDK namespace in Node ESM and an esbuild CJS bundle. */
export function nativeModuleExports<T>(namespace: unknown): T {
  const value = namespace as { default?: unknown };
  // Node ESM wraps module.exports in default; bundlers may expose the exports directly.
  return (value.default !== null && typeof value.default === "object" ? value.default : namespace) as T;
}

/** A connected resource is borrowed; retention cannot transfer its cleanup ownership. */
export class BorrowedSandboxError extends Error {
  constructor() { super("Connected sandboxes are borrowed; retention cannot transfer cleanup ownership."); }
}

/** Cleanup is incomplete; the manager still owns the handles needed to retry. */
export class McpCleanupError extends Error {
  constructor() {
    super("MCP cleanup is incomplete; failed handles are retained for retry.");
    this.name = "McpCleanupError";
  }
}

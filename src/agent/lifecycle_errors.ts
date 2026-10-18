/** A connected resource is borrowed; retention cannot transfer its cleanup ownership. */
export class BorrowedSandboxError extends Error {
  constructor() { super("Connected sandboxes are borrowed; retention cannot transfer cleanup ownership."); }
}

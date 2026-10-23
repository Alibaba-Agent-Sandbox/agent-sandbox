/** Explicit workflow operation contract, independent from discovery feature groups. */
import contract from "../template/workflow-v1.json" with { type: "json" };
import { ProviderProtocolError } from "../models/provider_errors.js";
export interface OperationDeclaration { cli: readonly string[]; python: readonly string[] }
/** Validate a declaration without activating operations from metadata aliases. */
export function validateOperations(version: unknown, operations: unknown): OperationDeclaration {
  if (version !== 1 || operations === null || typeof operations !== "object" || Array.isArray(operations)) throw new ProviderProtocolError("Provider operation contract version 1 is required.");
  const value = operations as Record<string, unknown>;
  if (Object.keys(value).some(k => k !== "cli" && k !== "python")) throw new ProviderProtocolError("Unknown provider operation consumer.");
  for (const consumer of ["cli", "python"]) {
    const list = value[consumer];
    if (!Array.isArray(list) || list.some(v => typeof v !== "string" || !Object.hasOwn(contract.operations, v)) || new Set(list).size !== list.length)
      throw new ProviderProtocolError("Provider operation declaration contains unknown or duplicate operations.");
  }
  return value as unknown as OperationDeclaration;
}
/** Reject runtime/manifest drift before executing a provider operation. */
export function verifyRuntimeOperations(expected: OperationDeclaration, version: unknown, operations: unknown): OperationDeclaration {
  const actual = validateOperations(version, operations);
  for (const consumer of ["cli", "python"] as const)
    if (JSON.stringify([...expected[consumer]].sort()) !== JSON.stringify([...actual[consumer]].sort())) throw new ProviderProtocolError("Provider runtime operations do not match its installed manifest.");
  return actual;
}

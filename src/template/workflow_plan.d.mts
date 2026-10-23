export interface WorkflowPlan {
  contract_version: 1; workflow_id: string; consumer: string; state: "T" | "F" | "U";
  requirements: Array<{ operation: string; phase: string; owner: string; state: "T" | "F" | "U"; reason: string }>;
  binding: { transport: string; endpoint: string; caller: string; authentication: string };
  kind: string; input: string; service: { protocol: string; version: number; port: number; operations: string[] } | null;
}
export interface WorkflowProvider { id: string; operation_contract_version: 1; operations: { cli: readonly string[]; python: readonly string[] }; workflow_inputs: readonly string[]; startup_modes: readonly string[]; project_preparation?: string }
export const workflowContract: { version: number; operations: Record<string, unknown>; [key: string]: unknown };
export const verificationProfiles: unknown;
export function validateWorkflowManifest(manifest: unknown): Record<string, unknown>;
export function planWorkflow(manifest: unknown, provider: WorkflowProvider, workflowId: string | null | undefined, consumer: string): WorkflowPlan;

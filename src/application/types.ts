/** Host-side application contracts. Deployment never runs from Sandbox.create(). */
export interface Hook {
  id: string; executor: "host-command"; argv: string[]; cwd: string;
  timeoutSeconds: number; envAllowlist: string[];
}
export interface FunctionSpec {
  component: string;
  props: Record<string, unknown>;
  actions?: Record<string, unknown>;
}
export interface ServerlessProject {
  edition: "3.0.0"; name: string; resources: Record<string, FunctionSpec>;
}
export interface Application {
  runtime: { placement: "external" | "in-sandbox"; driver: string; profile?: string };
  gateway: { placement: "fc-web" | "client-direct" };
  deployment: { adapter: "none" | "serverless-devs-fc3"; project?: string; inline?: ServerlessProject; toolchainLock?: string; accessRef?: string };
  sandbox: { provider: string; lifetime: "per-run"; workspace: "exclusive"; requiredFeatures: string[] };
  state: { profile: "ephemeral" | "durable"; bindingRef?: string };
  bindings: Record<string, string>;
  limits: Record<string, number>;
  hooks?: Partial<Record<"beforeApply" | "afterReady", Hook[]>>;
}
export interface ApplicationTemplate {
  name: string; spec_version: 3; capabilities: string[];
  resources: { cpu: number; memory: number }; start_cmd: string; ready_cmd: string;
  application: Application;
}
export interface ToolchainLock {
  schemaVersion: 1;
  node: { sha256: string };
  serverlessDevs: { directory: string; executable: string; version: string; sha256: string };
  fc3: { version: string; directory: string; sha256: string };
}
export interface ApplicationPlan {
  schemaVersion: 1; kind: "ApplicationPlan"; operation: "apply" | "destroy";
  id: string; createdAt: string; expiresAt: string; projectRoot: string; templateFile: string;
  sourceDigest: string; template: ApplicationTemplate; serverless: ServerlessProject | null;
  toolchain: ToolchainLock | null; receiptPath?: string; receiptDigest?: string;
}
export interface FunctionReceipt {
  logicalName: string; nativeId: string; region: string; functionName: string;
  functionId: string; createdTime: string; image: string; ownership: "created"; state: string; endpoint?: string;
}
export interface ApplicationReceipt {
  schemaVersion: 1; kind: "ApplicationReceipt"; plan: ApplicationPlan;
  operationId: string; status: "applying" | "requires_reconcile" | "ready" | "destroying" | "destroyed";
  intent: "apply" | "destroy"; accountId?: string;
  sandboxTemplate?: { provider: string; reference: string; ownership: "created" };
  resources: FunctionReceipt[]; updatedAt: string;
}

/** Explicit host deployment contracts for the managed Agents application profile. */
export type Role = "gateway" | "worker" | "dispatcher";
export interface Binding {
  reference: string;
  targets: string[];
  resolverRole?: Role;
  allowedEnv?: string[];
  kind?: "function-alias" | "custom-domain";
}
export interface ApplicationHook {
  id: string;
  type: "custom" | "serverless-devs";
  argv?: string[];
  cwd?: string;
  timeoutSeconds?: number;
  envAllowlist?: string[];
  step?: Role;
  command?: "info";
}
export interface ManagedApplication {
  api: { protocol: "agent-sandbox-managed-agents/v1"; compatibility: string; busyInputPolicy: "reject-unless-steerable"; explicitQueue: boolean };
  runtime: { placement: "in-sandbox"; driver: "sandbox-local-api"; profile: "managed-bridge-v1" };
  gateway: { placement: "fc-web" };
  sandbox: { provider: string; lifetime: "per-session"; workspace: "exclusive"; requiredFeatures: string[] };
  sessions: Record<string, number | string>;
  state: { profile: "durable"; bindingRef: string };
  storage: Record<string, number | string>;
  bindings: Record<string, Binding>;
  limits: Record<string, number>;
  deployment: {
    profile: "fc-managed-agents";
    accessRef: string;
    region: string;
    component: string;
    serverImage?: string;
    serverBuildRecipe?: { dockerfile: string; context: "." };
    ingressBindingRef: string;
    revisionStrategy: "immutable-workers-with-drain";
  };
  hooks?: Partial<Record<"beforeApply" | "afterReady", ApplicationHook[]>>;
  outputs?: Record<string, unknown>;
}
export interface ApplicationTemplate {
  name: string;
  spec_version: 6;
  resources: { cpu: number; memory: number };
  start_cmd: string;
  ready_cmd: string;
  application: ManagedApplication;
  [key: string]: unknown;
}
export interface ToolchainLock {
  schemaVersion: 1;
  node: { path: string; version: string; sha256: string };
  loader: { path: string; version: string; directory: string; sha256: string };
  component: { reference: string; directory: string; sha256: string };
}
export interface BuildReceipt {
  schemaVersion: 1;
  kind: "ManagedApplicationBuild";
  sourceDigest: string;
  image: string;
  toolchain: ToolchainLock;
  createdAt: string;
  status?: "building" | "ready" | "requires_reconcile" | "cleaned";
  ownedServerImage?: OwnedServerImage;
  usedBy?: Array<{ applicationId: string; revision: string }>;
  accessRef?: string;
}
export interface OwnedServerImage {
  accountId: string;
  region: string;
  namespace: string;
  repository: string;
  tag: string;
  localTag: string;
  localImageId?: string;
  digest?: string;
  state: "intent" | "local-built" | "push-started" | "confirmed" | "deleted";
  journalId: string;
  intentId: string;
}
export interface DeploymentStep {
  id: string;
  type: "sandbox-template" | "serverless-devs" | "custom" | "managed-ingress";
  dependsOn: string[];
  resourceIdentity?: string;
}
export interface ApplicationPlan {
  schemaVersion: 2;
  kind: "ManagedApplicationPlan";
  operation: "apply" | "destroy";
  id: string;
  revision: string;
  createdAt: string;
  expiresAt: string;
  projectRoot: string;
  templateFile: string;
  sourceDigest: string;
  template: ApplicationTemplate;
  image: string;
  toolchain: ToolchainLock;
  identities: Record<Role, string>;
  steps: DeploymentStep[];
  previousReceipt?: string;
  previousDigest?: string;
  buildReceipt?: string;
  ownedServerImage?: OwnedServerImage;
}
export interface FunctionReceipt {
  role: Role;
  functionName: string;
  functionArn: string;
  functionId: string;
  createdTime: string;
  ownership: "created" | "retained";
  image: string;
  revision: string;
}
export interface PreparedSandbox {
  provider: string;
  reference: string;
  journalId: string;
  resources: Array<{ kind: string; id?: string; state: string; cleanup: string; intent_id: string }>;
}
export interface ApplicationReceipt {
  schemaVersion: 2;
  kind: "ManagedApplicationReceipt";
  plan: ApplicationPlan;
  operationId: string;
  status: "applying" | "ready" | "requires_reconcile" | "destroying" | "destroyed";
  phase: string;
  accountId: string;
  functions: FunctionReceipt[];
  sandbox?: PreparedSandbox;
  gatewayVersion?: string;
  previousAliasVersion?: string | null;
  aliasName?: string;
  candidateTrigger?: string;
  endpoint?: string;
  candidateEndpoint?: string;
  credentialsFile?: string;
  controlDigest?: string;
  executionMayHaveStarted?: boolean;
  drainConfirmed?: boolean;
  publishedVersions?: string[];
  retainedImages?: OwnedServerImage[];
  stateInstanceId?: string;
  stateIdentityDigest?: string;
  retained: Array<{ revision: string; worker: string; dispatcher: string; template: string }>;
  cleanup: Array<{ kind: string; identity: string; status: "pending" | "confirmed" | "uncertain" }>;
  updatedAt: string;
}

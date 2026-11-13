/** Resource deployment prepares templates; instance creation remains an explicit runtime operation. */
import type { Context } from "./kit.js";
import { ProviderConfigError } from "../models/provider_errors.js";
import { Sandbox, type CreateOptions } from "../api/sandbox.js";
import type { ResourceJournal } from "../template/resource_journal.js";
import type { PreparedTemplate } from "../providers/template_contract.js";
import type { captureDeploymentTarget } from "./deployment_store.js";

export const launchSeams = { create: (options: Parameters<typeof Sandbox.create>[0]) => Sandbox.create(options) };
export interface TemplateLaunchResult { receipt: Record<string, unknown>; creation: Record<string, unknown> }

/** Reject the retired automatic instance-launch path before any resource effects. */
export async function executeTemplateLaunch(
  _ctx: Context,
  _params: Record<string, unknown>,
  _creationOptions: Pick<CreateOptions, "envs" | "metadata" | "volume_mounts" | "request_timeout" | "lifecycle"> & { configurationSource?: string; approved?: boolean; afterCreate?: (sandbox: Sandbox) => Promise<void>; onJournal?: (journal: ResourceJournal) => void; onCreated?: (id: string) => Promise<void>; prepareOnly?: boolean; prepared?: PreparedTemplate; builtTarget?: Record<string, unknown>; onTarget?: (target: ReturnType<typeof captureDeploymentTarget>) => void } = {},
): Promise<TemplateLaunchResult> {
  throw new ProviderConfigError("Template deployment prepares named resources and does not create dynamic Sandbox instances. Use abx deploy for resources, then create instances explicitly through the CLI or SDK.");
}

/** Read configured FC/SLS logs through the application's pinned component. */
import { ApplicationError, record } from "./config.js";
import { createFcTransport, resolveDeployCredentials, verifyFunction } from "./fc.js";
import { invokeComponent } from "./tools.js";
import type { ApplicationReceipt } from "./types.js";
export const logSeams = { credentials: resolveDeployCredentials, transport: createFcTransport, invoke: invokeComponent };
export async function applicationLogs(receipt: ApplicationReceipt, role: string, lines: number, follow: boolean): Promise<Record<string, unknown>> {
  if (!Number.isInteger(lines) || lines < 1 || lines > 10000) throw new ApplicationError("--lines must be between 1 and 10000.");
  if (follow) throw new ApplicationError("Managed application logs currently support one-shot queries; omit --follow.");
  const item = receipt.functions.find(item => item.role === role);
  if (!item) throw new ApplicationError("This application role has no confirmed function.");
  const credential = await logSeams.credentials(receipt.plan.template.application.deployment.accessRef), region = receipt.plan.template.application.deployment.region;
  if (credential.AccountID !== receipt.accountId) throw new ApplicationError("Current account differs from the application owner.");
  const body = await logSeams.transport(credential, region).describeFunction(item.functionName);
  if (!body) throw new ApplicationError("The application function no longer exists.");
  verifyFunction(body, receipt.accountId, region, item.functionName, item);
  if (!record(body.logConfig) || !body.logConfig.project || !body.logConfig.logstore) throw new ApplicationError("This function has no configured log destination. Enable FC logging for this function before querying application logs.");
  const result = await logSeams.invoke(receipt.plan.toolchain, { command: "logs", resource: role, props: { region, functionName: item.functionName }, credential });
  if (!Array.isArray(result) || !result.every(line => typeof line === "string")) throw new ApplicationError("Component did not return a valid log result.");
  return { application_id: receipt.plan.applicationId ?? receipt.plan.template.name, role, lines: result.slice(-lines), truncated: result.length > lines };
}

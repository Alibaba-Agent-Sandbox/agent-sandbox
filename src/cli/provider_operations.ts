/** Static Provider metadata rendered by the CLI; never imports a plugin entry or validates credentials. */
import { SandboxError } from "../models/errors.js";
import type { ProviderCommand } from "../providers/command_contract.js";
import { listProviderCommands } from "../providers/commands.js";
import { ProviderProtocolError } from "../models/provider_errors.js";
import { resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";

/** One invocation's selected identity and static directory, including a recoverable discovery failure. */
export interface ProviderOperations {
  readonly id: string | null;
  readonly explicit: boolean;
  readonly commands: readonly ProviderCommand[];
  readonly error?: SandboxError;
}

/** Keep help and repair commands usable if the selected Provider cannot be read. */
export function discoverProviderOperations(): ProviderOperations {
  let id: string | null = null;
  const explicit = cliProvider() !== null;
  try {
    id = resolveProviderId(cliProvider());
    return { id, explicit, commands: listProviderCommands(id) };
  } catch (error) {
    return { id, explicit, commands: [], error: error instanceof SandboxError ? error : new ProviderProtocolError("Cannot read the selected provider's operation catalog.") };
  }
}

/** Use process locale for display only; machine descriptors preserve both languages. */
export function providerOperationDescription(entry: ProviderCommand): string {
  const locale = process.env["LC_ALL"] || process.env["LC_MESSAGES"] || process.env["LANG"] || "";
  return /^zh(?:[_-]|$)/i.test(locale) ? entry.description_zh : entry.description;
}

function heading(catalog: ProviderOperations): string {
  return `Provider: ${catalog.id ?? "unavailable"} (${catalog.explicit ? "--provider" : "default"})`;
}

function unavailable(catalog: ProviderOperations): string {
  return `${heading(catalog)}\nOperations unavailable (${catalog.error?.code ?? "E8020"}).\nUse 'abx provider list' to inspect providers; 'abx provider default ID' selects a working default.\nInstallation and update commands remain available.`;
}

/** Compact root overview; the full list and schemas are progressively disclosed below provider. */
export function providerOperationsSummary(catalog: ProviderOperations): string {
  if (catalog.error) return `\n${unavailable(catalog)}\n`;
  const groups = [...new Set(catalog.commands.map((entry) => entry.id.split(".")[0]))];
  const example = catalog.commands[0] ? `\nExample: abx provider run ${catalog.commands[0].id} --help` : "";
  return `\n${heading(catalog)}\n${catalog.commands.length} provider operations${groups.length ? `: ${groups.join(", ")}` : " declared"}.${example}\nUse 'abx provider --help' for the directory and 'abx provider run OPERATION --help' for parameters.\nSelect for one invocation: abx --provider ID provider --help\n`;
}

/** Directory shared by provider help and the isolated run namespace. */
export function providerOperationsDirectory(catalog: ProviderOperations): string {
  if (catalog.error) return `\n${unavailable(catalog)}\n`;
  const rows = catalog.commands.map((entry) => `  abx provider run ${entry.id}  [${entry.effect}]  ${providerOperationDescription(entry)}`);
  return `\n${heading(catalog)}\nProvider operations:\n${rows.length ? rows.join("\n") : "  No custom management operations declared."}\n\nInspect: abx provider run OPERATION --help\nAI/scripts: abx --json provider command list ${catalog.id}\n`;
}

function fieldSummary(schema: unknown): string {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return "see schema";
  const value = schema as Record<string, unknown>;
  const type = Array.isArray(value["type"]) ? value["type"].join(" | ") : String(value["type"] ?? "see schema");
  const enumeration = Array.isArray(value["enum"]) ? `; enum ${JSON.stringify(value["enum"])}` : "";
  return `${type}${enumeration}`;
}

/** Human help is generated from the same bounded schemas used by execution and engine discovery. */
export function providerOperationHelp(provider: string, entry: ProviderCommand): string {
  const properties = entry.input_schema["properties"] as Record<string, unknown> | undefined;
  const required = new Set(entry.input_schema["required"] as string[] | undefined);
  const fields = Object.entries(properties ?? {}).map(([name, schema]) => `  ${name}: ${fieldSummary(schema)}${required.has(name) ? " (required)" : " (optional)"}`);
  return [`[${entry.effect}] ${providerOperationDescription(entry)}`, "", `Provider: ${provider}`, `Effect: ${entry.effect}; idempotent: ${entry.idempotent}.`,
    entry.effect === "read" ? "Read operation; no --yes required." : "Requires --yes to confirm this operation.", "",
    "Input fields (JSON, not individual CLI flags):", ...(fields.length ? fields : ["  See input schema below."]), "",
    "Input schema:", JSON.stringify(entry.input_schema, null, 2), "", "Output schema:", JSON.stringify(entry.output_schema, null, 2), "",
    "Usage:", `  abx --provider ${provider} provider run ${entry.id} --input-file request.json${entry.effect === "read" ? "" : " --yes"}`,
    "  Write a request matching the input schema to request.json. Do not put secrets in command-line arguments.",
  ].join("\n");
}

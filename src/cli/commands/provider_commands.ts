/** Provider management commands share discovery, validation and execution with the engine. */

import { readFile, stat } from "node:fs/promises";

import { getProviderCommand, listProviderCommands, runProviderCommand } from "../../providers/commands.js";
import { validateCommandInput } from "../../providers/command_contract.js";
import { withGuidedConfiguration, canGuideConfiguration } from "../config_guidance.js";
import { providerCliExtension } from "../provider_extensions.js";
import { confirm } from "../prompts.js";
import { ProviderConfigError, ProviderMismatchError, ProviderTrustError } from "../../models/provider_errors.js";
import { getProvider } from "../../providers/registry.js";
import { cliOptions, cliProvider } from "../../providers/selection.js";
import { getFormatter } from "../formatters.js";
import { echo } from "../io.js";
import { argument, command, group, option, type Context } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { providerOperationDescription, providerOperationHelp, providerOperationsSummary, type ProviderOperations } from "../provider_operations.js";
import type { ProviderCommand } from "../../providers/command_contract.js";
import type { Command, Param } from "../kit.js";

type Params = Record<string, unknown>;
const MAX_INPUT_BYTES = 1024 * 1024;

function checkInputSize(bytes: number): void {
  if (bytes > MAX_INPUT_BYTES) throw new ProviderConfigError("Command input must not exceed 1 MiB.");
}

function providerId(params: Params): string {
  const id = String(params["provider_id"]);
  const selected = cliProvider();
  if (selected !== null && selected !== id) {
    throw new ProviderMismatchError(`Provider '${id}' conflicts with --provider ${selected}.`);
  }
  return id;
}

function providerOptions(id: string, params: Params): Record<string, unknown> {
  const options: Record<string, unknown> = cliOptions();
  for (const pair of (params["opt"] as string[] | undefined) ?? []) {
    const index = pair.indexOf("=");
    const key = index > 0 ? pair.slice(0, index).trim() : "";
    if (!key) throw new ProviderConfigError("Invalid --opt: expected KEY=VALUE.");
    options[key] = pair.slice(index + 1);
  }
  const secret = getProvider(id).configFields.find((field) => field.secret && Object.hasOwn(options, field.key));
  if (secret) {
    throw new ProviderConfigError(`Secret option '${secret.key}' must be set through 'abx config set providers.${id}.${secret.key}'.`);
  }
  return options;
}

async function inputOf(params: Params): Promise<unknown> {
  const inline = params["input"] as string | null;
  const file = params["input_file"] as string | null;
  if (inline !== null && file !== null) throw new ProviderConfigError("Use only one of --input and --input-file.");
  let text = inline ?? "{}";
  if (file !== null) {
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new ProviderConfigError("--input-file must name a regular file.");
      checkInputSize(info.size);
      const contents = await readFile(file);
      checkInputSize(contents.length);
      text = contents.toString("utf-8");
    } catch (exc) {
      if (exc instanceof ProviderConfigError) throw exc;
      throw new ProviderConfigError("Cannot read --input-file. Check that the file exists and is readable.");
    }
  }
  checkInputSize(Buffer.byteLength(text, "utf-8"));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderConfigError("Command input must be valid JSON.");
  }
}

/** Fixed namespace for provider-specific control-plane operations. */
export const provider_commands = group("command", {
  help: "Discover and run provider-specific management commands.\n\nCommands manage cloud resources; sandbox application commands use 'abx sandbox command'.",
});

provider_commands.addCommand(command("list", {
  help: "List a provider's management commands without connecting to the backend.",
  params: [argument("provider_id", { metavar: "ID" })],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const commands = listProviderCommands(providerId(params));
    if (fmt.use_json) fmt.printData(commands);
    else if (fmt.quiet) for (const entry of commands) echo(entry.id);
    else fmt.printTable(["Command", "Effect", "Description"], commands.map((entry) => [entry.id, entry.effect, providerOperationDescription(entry)]));
  }),
}));

provider_commands.addCommand(command("info", {
  help: "Show a management command's input/output schemas and effects.",
  params: [argument("provider_id", { metavar: "ID" }), argument("command_id", { metavar: "COMMAND" })],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const id = providerId(params);
    const descriptor = getProviderCommand(id, String(params["command_id"]));
    const fmt = getFormatter(ctx);
    if (fmt.use_json) fmt.printData(descriptor);
    else echo(providerOperationHelp(id, descriptor));
  }),
}));

function operationParams(): Param[] {
  return [
    option("--input", { metavar: "JSON", help: "JSON input object (default: {})" }),
    option("--input-file", { metavar: "FILE", help: "Read JSON input from a file" }),
    option(["--opt", "-o", "opt"], { multiple: true, metavar: "KEY=VALUE", help: "Provider option (repeatable)" }),
    option("--region", { help: "Cloud region for this command" }),
    option("--yes", { is_flag: true, help: "Confirm a write or delete operation" }),
  ];
}

async function executeOperation(id: string, descriptor: ProviderCommand, ctx: Context, params: Params): Promise<void> {
  if (descriptor.effect !== "read" && params["yes"] !== true) {
    if (!canGuideConfiguration(ctx)) throw new ProviderTrustError(`Command '${descriptor.id}' requires --yes (${descriptor.effect}).`);
  }
  const input = await inputOf(params);
  validateCommandInput(descriptor, input, id);
  const options = {
    provider_options: providerOptions(id, params),
    ...(params["region"] !== null ? { region: String(params["region"]) } : {}),
  };
  await withGuidedConfiguration(ctx, { operation: `Provider operation ${descriptor.id}`, provider: id, yes: Boolean(params["yes"]), overrides: options,
    requirements: providerCliExtension(id)?.managementRequirements?.(descriptor.id), validateProvider: id !== "alicloud-express",
  }, async () => {
    if (descriptor.effect !== "read" && !params["yes"]) await confirm(`Run '${descriptor.id}' (${descriptor.effect}) with provider '${id}'?`, { default: false, abort: true, err: true });
    getFormatter(ctx).printData(await runProviderCommand(id, descriptor.id, input, options));
  });
}

/** New trees are invocation-local; legal operation names never overwrite installer commands. */
export function createProviderRun(catalog: ProviderOperations): Command {
  const run = group("run", {
    help: "Run an operation provided by the selected Provider.\n\nUse OPERATION --help for its JSON fields and effects. Help never executes the Provider.",
    helpFooter: () => providerOperationsSummary(catalog),
    callback: handleErrors(() => { if (catalog.error) throw catalog.error; }),
  });
  for (const descriptor of catalog.commands) {
    run.addCommand(command(descriptor.id, {
      help: providerOperationHelp(catalog.id!, descriptor),
      params: operationParams(),
      callback: handleErrors(async (ctx: Context, params: Params) => {
        await executeOperation(catalog.id!, descriptor, ctx, params);
      }),
    }));
  }
  return run;
}

provider_commands.addCommand(command("run", {
  help: "Run a declared management command. Write/delete commands require --yes.\n\nUse --input-file for JSON containing certificates or other sensitive values.",
  params: [
    argument("provider_id", { metavar: "ID" }),
    argument("command_id", { metavar: "COMMAND" }),
    ...operationParams(),
  ],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const id = providerId(params);
    const commandId = String(params["command_id"]);
    const descriptor = getProviderCommand(id, commandId);
    await executeOperation(id, descriptor, ctx, params);
  }),
}));

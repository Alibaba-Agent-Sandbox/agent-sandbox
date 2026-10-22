/** One invocation path shared by CLI and the authenticated local engine. */
import { SandboxError } from "../models/errors.js";
import { loadLayeredConfig, type LayeredConfigInit } from "../transport/config_layers.js";
import { validateCommandInput, validateCommandOutput } from "./command_contract.js";
import type { ProviderCommand, ProviderCommandRunner } from "./command_contract.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError, ProviderProtocolError, ProviderTimeoutError } from "../models/provider_errors.js";
import { BUILTIN_PROVIDER_ID, validateProviderId } from "../utils/config_keys.js";
import { sanitizeText } from "./epp.js";
import { getProvider } from "./registry.js";
import { parseCommandSection } from "./command_contract.js";
import * as store from "./store.js";

export type { ProviderCommand, ProviderCommandHandler, ProviderCommandRunner } from "./command_contract.js";
/** Bound cleanup separately: a plugin's close hook must not defeat the invocation timeout. */
export const commandTuning = { cleanupTimeoutMs: 1000 };

/** Static discovery never builds infrastructure or loads plugin modules. */
export function listProviderCommands(providerId: string): ProviderCommand[] {
  if (typeof providerId !== "string" || (providerId !== BUILTIN_PROVIDER_ID && validateProviderId(providerId) !== null)) {
    throw new ProviderConfigError("A valid explicit provider id is required for management commands.");
  }
  const receipt = store.readReceipt(providerId);
  if (receipt && receipt["trust"] !== "link") store.verifyIntegrity(providerId);
  const provider = getProvider(providerId);
  return structuredClone([...parseCommandSection({ protocol: "provider-commands/1", entries: provider.commands }, provider.kind)]);
}

export function getProviderCommand(providerId: string, commandId: string): ProviderCommand {
  const command = listProviderCommands(providerId).find((item) => item.id === commandId);
  if (!command) throw new ProviderFeatureNotSupportedError(providerId, `command:${commandId}`, {
    suggestion: `Run 'abx --provider ${providerId} provider run --help' to see its operations.`,
  });
  return command;
}

export type ProviderCommandOptions = Omit<LayeredConfigInit, "provider"> & {
  api_key?: string | null;
  api_url?: string | null;
  domain?: string | null;
};

function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return sanitizeText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [sanitizeText(k, secrets), redact(v, secrets)]));
  return value;
}

/** No automatic retry: a failed connection or timeout can leave a mutation's outcome unknown. */
export async function runProviderCommand(providerId: string, commandId: string, input: unknown, options: ProviderCommandOptions = {}): Promise<unknown> {
  const command = getProviderCommand(providerId, commandId);
  validateCommandInput(command, input, providerId);
  const provider = getProvider(providerId);
  const config = loadLayeredConfig({ ...options, provider: providerId,
    ...(options.api_key !== undefined ? { sandbox_api_key: options.api_key } : {}),
    ...(options.api_url !== undefined ? { sandbox_base_url: options.api_url } : {}),
    ...(options.domain !== undefined ? { sandbox_domain: options.domain } : {}),
  });
  const secrets = [options.api_key, options.sandbox_api_key, options.access_key_id, options.access_key_secret,
    config.sandbox_api_key, config.access_key_id, config.access_key_secret,
    ...provider.configFields.filter((f) => f.secret).map((f) => config.provider_options[f.key]),
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  let runner: ProviderCommandRunner | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failure: SandboxError | undefined;
  let result: unknown;
  const disposed = new Set<ProviderCommandRunner>();
  const close = async (target: ProviderCommandRunner): Promise<void> => {
    if (disposed.has(target)) return;
    disposed.add(target);
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => target.close?.()),
        new Promise<never>((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error("cleanup timeout")), commandTuning.cleanupTimeoutMs); }),
      ]);
    } catch {
      throw new ProviderProtocolError("Provider command resource cleanup failed or timed out; resources may remain open.");
    } finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
  };
  const abort = new AbortController();
  try {
    const invocation = (async () => {
      const prepared = await provider.buildCommandRunner(config);
      runner = prepared;
      if (abort.signal.aborted) { await close(prepared); throw new ProviderTimeoutError("Provider command preparation timed out; outcome may be unknown."); }
      return prepared.run(commandId, input, abort.signal);
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new ProviderTimeoutError(`Provider command '${commandId}' timed out; its remote outcome may be unknown. No retry was made.`));
      }, provider.commandTimeoutMs);
    });
    const output = await Promise.race([invocation, timeout]);
    validateCommandOutput(command, output);
    result = redact(output, secrets);
  } catch (exc) {
    if (exc instanceof SandboxError) {
      exc.message = sanitizeText(exc.message, secrets);
      exc.suggestion = sanitizeText(exc.suggestion ?? "", secrets);
      exc.docs_url = sanitizeText(exc.docs_url ?? "", secrets);
      exc.code = sanitizeText(exc.code, secrets);
      exc.name = sanitizeText(exc.name, secrets);
      failure = exc;
    } else {
      // Unstructured exceptions may contain request headers, key material or backend response bodies.
      failure = new ProviderProtocolError(`Provider command '${commandId}' failed. No retry was made.`);
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (runner) {
      try { await close(runner); }
      catch (exc) {
        if (failure) failure.suggestion = `${failure.suggestion} Resource cleanup failed or timed out; resources may remain open.`.trim();
        else failure = exc as SandboxError;
      }
    }
  }
  if (failure) throw failure;
  return result;
}

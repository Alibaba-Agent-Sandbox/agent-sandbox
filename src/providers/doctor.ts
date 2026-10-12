/** Provider health checks: integrity, configuration and the plugin `initialize` handshake. */

import { SandboxError } from "../models/errors.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";
import { ProviderInstallError } from "./errors.js";
import * as registry from "./registry.js";
import * as store from "./store.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  id: string;
  ok: boolean;
  checks: DoctorCheck[];
}

function check(name: string, ok: boolean, detail = ""): DoctorCheck {
  return { name, ok, detail };
}

/** Run every check for `providerId`; never throws for provider failures. Plugin processes start only when the config check passed. */
export async function doctor(providerId: string, opts: { handshake?: boolean; options?: Record<string, unknown> } = {}): Promise<DoctorReport> {
  const handshake = opts.handshake ?? true;
  const checks: DoctorCheck[] = [];
  const finish = (): DoctorReport => ({ id: providerId, ok: checks.every((c) => c.ok), checks });

  let provider;
  try {
    provider = registry.getProvider(providerId);
    checks.push(check("installed", true, `${provider.displayName} ${provider.version}`));
  } catch (exc) {
    if (!(exc instanceof SandboxError)) throw exc;
    checks.push(check("installed", false, exc.message));
    return finish();
  }

  const receipt = providerId !== BUILTIN_PROVIDER_ID ? store.readReceipt(providerId) : null;
  if (receipt !== null && receipt["trust"] !== "link" && provider.kind !== "python") {
    try {
      store.verifyIntegrity(providerId);
      checks.push(check("integrity", true, String(receipt["tree_sha256"] ?? "").slice(0, 16)));
    } catch (exc) {
      if (!(exc instanceof SandboxError)) throw exc;
      checks.push(check("integrity", false, exc.message));
      return finish();
    }
  }

  let config;
  try {
    config = loadLayeredConfig({ provider: providerId, provider_options: opts.options ?? {} });
    provider.validateConfig(config);
    checks.push(check("config", true));
  } catch (exc) {
    if (!(exc instanceof SandboxError)) throw exc;
    checks.push(check("config", false, exc.message));
    return finish();
  }

  if (handshake && providerId !== BUILTIN_PROVIDER_ID) {
    let infra;
    try {
      infra = await provider.buildInfra(config);
    } catch (exc) {
      if (!(exc instanceof SandboxError)) throw exc;
      checks.push(check("handshake", false, exc.message));
      return finish();
    }
    try {
      checks.push(check("handshake", true));
    } finally {
      await infra.close?.();
    }
  }
  return finish();
}

/** `verify` callback for install/update: throws when the plugin fails to start. */
export async function verifyHandshake(providerId: string): Promise<void> {
  registry.forget(providerId);
  const report = await doctor(providerId);
  for (const c of report.checks) {
    if (["installed", "integrity", "handshake"].includes(c.name) && !c.ok) {
      throw new ProviderInstallError(`Provider '${providerId}' failed ${c.name}: ${c.detail}`);
    }
  }
}

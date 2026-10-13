/**
 * Provider errors (E8xxx; port of the provider section of `agent_sandbox/models/errors.py`).
 *
 * Kept next to the provider layer so the legacy `models/errors.ts` (a 1:1 port of the original module) stays
 * untouched. Every class subclasses `SandboxError`, so existing `except`-style handling keeps working.
 */

import {
  AuthenticationError,
  CapabilityNotSupportedError,
  CommandTimeoutError,
  FileNotFoundError_,
  QuotaExceededError,
  SandboxError,
  SandboxNotFoundError,
  TemplateNotFoundError,
  type SandboxErrorOptions,
} from "../models/errors.js";

/** Base for provider (backend plugin) failures. */
export class ProviderError extends SandboxError {
  static override code = "E8000";

  /** `ProviderFeatureNotSupportedError` is a `CapabilityNotSupportedError` *and* a `ProviderError`. */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (Function.prototype[Symbol.hasInstance].call(this, value)) return true;
    return this === ProviderError && value instanceof ProviderFeatureNotSupportedError;
  }
}

/** The provider id is unknown or not installed. */
export class ProviderNotFoundError extends ProviderError {
  static override code = "E8001";
  static override suggestion = "Run 'abx provider list'; install with 'abx provider install <path-or-git-url>'.";
}

/** Unknown or invalid provider option, or a schema violation. */
export class ProviderConfigError extends ProviderError {
  static override code = "E8002";
}

/** Duplicate or reserved provider id. */
export class ProviderConflictError extends ProviderError {
  static override code = "E8003";
}

/** The selected provider does not implement the requested feature. */
export class ProviderFeatureNotSupportedError extends CapabilityNotSupportedError {
  static override code = "E8004";

  provider: string;
  feature: string;

  constructor(provider: string, feature: string, options: SandboxErrorOptions & { message?: string | null } = {}) {
    super(feature, {
      ...options,
      message: options.message || `Provider '${provider}' does not support '${feature}'.`,
      suggestion: options.suggestion || `Run 'abx provider info ${provider}' to see supported features.`,
    });
    this.provider = provider;
    this.feature = feature;
  }
}

/** The provider reports that a sandbox, template or file does not exist. */
export class ProviderResourceNotFoundError extends ProviderError {
  static override code = "E8005";
}

/** Source unreachable, or a size/path/type limit was violated. */
export class ProviderInstallError extends ProviderError {
  static override code = "E8010";
}

/** Digest/pin mismatch, or the files changed since installation. */
export class ProviderIntegrityError extends ProviderError {
  static override code = "E8011";
}

/** Consent, pinning or transport policy was not satisfied. */
export class ProviderTrustError extends ProviderError {
  static override code = "E8012";
}

/** The provider's `requires` or protocol is not supported by this host. */
export class ProviderVersionError extends ProviderError {
  static override code = "E8013";
}

/** `abx-provider.toml` is invalid. */
export class ProviderManifestError extends ProviderError {
  static override code = "E8014";
}

/** Malformed JSON-RPC traffic or a failed handshake with a plugin. */
export class ProviderProtocolError extends ProviderError {
  static override code = "E8020";
  /** JSON-RPC code of the answer (set for standard JSON-RPC errors; `-32601` = method not found). */
  rpc_code?: number;
}

/** The plugin process could not be spawned or crashed (stderr tail attached). */
export class ProviderProcessError extends ProviderError {
  static override code = "E8021";
}

/** A plugin did not start or answer in time. */
export class ProviderTimeoutError extends ProviderError {
  static override code = "E8022";
}

/** A sandbox reference belongs to another provider than the one selected. */
export class ProviderMismatchError extends ProviderError {
  static override code = "E8030";
}

export const PROVIDER_ERROR_CLASSES = [
  ProviderError,
  ProviderNotFoundError,
  ProviderConfigError,
  ProviderConflictError,
  ProviderFeatureNotSupportedError,
  ProviderResourceNotFoundError,
  ProviderInstallError,
  ProviderIntegrityError,
  ProviderTrustError,
  ProviderVersionError,
  ProviderManifestError,
  ProviderProtocolError,
  ProviderProcessError,
  ProviderTimeoutError,
  ProviderMismatchError,
] as const;

/**
 * CLI exit code (0-6) for an error, extended with the E8xxx classes (same order as the Python reference).
 * auth -> 3, not-found family -> 4, timeout -> 5, quota -> 6, config/trust/mismatch -> 2, else 1.
 */
export function exitCodeFor(exc: unknown): number {
  if (exc instanceof AuthenticationError) return 3;
  if (
    exc instanceof TemplateNotFoundError ||
    exc instanceof SandboxNotFoundError ||
    exc instanceof FileNotFoundError_ ||
    exc instanceof ProviderNotFoundError ||
    exc instanceof ProviderResourceNotFoundError
  ) {
    return 4;
  }
  if (exc instanceof CommandTimeoutError || exc instanceof ProviderTimeoutError) return 5;
  if (exc instanceof QuotaExceededError) return 6;
  if (exc instanceof ProviderConfigError || exc instanceof ProviderTrustError || exc instanceof ProviderMismatchError) return 2;
  return 1;
}

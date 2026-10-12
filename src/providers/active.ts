/**
 * Tracks which provider the current invocation selected (set by the API layer). Kept in its own tiny module so the CLI
 * error handler can read it without importing the registry (and with it every provider implementation).
 */

import { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";

let active: string = BUILTIN_PROVIDER_ID;

export function setActiveProvider(providerId: string): void {
  active = providerId;
}

export function activeProviderId(): string {
  return active;
}

export function resetActiveProvider(): void {
  active = BUILTIN_PROVIDER_ID;
}

const openers = new Set<() => Promise<void>>();

/** Register a cleanup that must run before the CLI exits (plugin processes, HTTP clients). Returns the unregister function. */
export function trackOpenInfra(close: () => Promise<void>): () => void {
  openers.add(close);
  return () => openers.delete(close);
}

/** Close everything still registered; called by the CLI entry point on every exit path. */
export async function closeOpenInfra(): Promise<void> {
  const pending = [...openers];
  openers.clear();
  await Promise.allSettled(pending.map((fn) => fn()));
}

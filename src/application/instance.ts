/** Managed-only preflight matching the Worker instance admission boundary. */
import { validateVolumeMounts } from "../models/sandbox.js";

const reservedNames = new Set(["HOME", "PATH", "SHELL", "USER", "LOGNAME", "ANTHROPIC_API_KEY", "DASHSCOPE_API_KEY"]);
const reservedMetadata = new Set(["abx-managed", "abx-session", "abx-revision"]);

/** Values remain private; only reject invalid names/ownership conflicts before any cloud effect. */
export function validateManagedInstance(instance: Record<string, unknown>): void {
  const environment = instance.envs as Record<string, string> | undefined;
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || reservedNames.has(name) || /^(?:ABX_|OPENAI_|QWEN_|CODEX_|PYTHON|LD_)/.test(name)) throw new TypeError("Managed custom environment names cannot override runtime/model controls.");
    if (typeof value !== "string" || value.includes("\0")) throw new TypeError("Managed custom environment values must be strings without NUL bytes.");
  }
  const lifecycle = instance.lifecycle as {onTimeout?: string; autoResume?: boolean} | undefined;
  if (lifecycle && (lifecycle.onTimeout !== "kill" || lifecycle.autoResume === true)) throw new TypeError("Managed Sessions require kill-on-timeout without automatic resume.");
  if (Object.keys(instance.metadata ?? {}).some(key => reservedMetadata.has(key))) throw new TypeError("Managed instance metadata cannot override resource ownership.");
  const mounts = validateVolumeMounts(instance.volume_mounts ?? {});
  for (const mount of Object.keys(mounts ?? {})) for (const protectedPath of ["/workspace", "/home/user/.agent-sandbox"]) {
    if (mount === protectedPath || mount.startsWith(`${protectedPath}/`) || protectedPath.startsWith(`${mount}/`)) throw new TypeError("Managed volume mounts cannot overlap the workspace or private runtime state.");
  }
}

/** Address convention of the explicitly selected E2B/envd wire adapter. */
export const ENVD_PORT = 49983;

export function envdUrl(sandboxId: string, domain: string): string {
  return `https://${ENVD_PORT}-${sandboxId}.${domain}`;
}

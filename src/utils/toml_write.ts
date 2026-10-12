/** Minimal TOML writer for the small, scalar-only documents `config.toml` and `.ebx-install.json` mirrors hold. */

function scalar(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return `[${value.map(scalar).join(", ")}]`;
  return JSON.stringify(String(value));
}

function key(name: string): string {
  return name && /^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name);
}

function isTable(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Serialise nested objects of scalars/arrays to TOML (sub-tables are emitted after scalars). */
export function dumpsToml(doc: Record<string, unknown>): string {
  const lines: string[] = [];
  const emit = (table: Record<string, unknown>, path: string[]): void => {
    const entries = Object.entries(table);
    const scalars = entries.filter(([, v]) => !isTable(v));
    const tables = entries.filter(([, v]) => isTable(v)) as Array<[string, Record<string, unknown>]>;
    if (path.length > 0 && (scalars.length > 0 || tables.length === 0)) {
      if (lines.length > 0) lines.push("");
      lines.push(`[${path.map(key).join(".")}]`);
    }
    for (const [k, v] of scalars) lines.push(`${key(k)} = ${scalar(v)}`);
    for (const [k, v] of tables) emit(v, [...path, k]);
  };
  emit(doc, []);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

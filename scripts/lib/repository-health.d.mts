export function imports(text: string, file?: string): string[];
export function canonicalRepository(value: unknown, issues?: boolean): boolean;
export function productPython(relative: string): boolean;
export function removedCli(text: string, file: string): boolean;
export function historicalContext(manifest: Record<string, { sha256: string; [key: string]: unknown }>, relative: string, bytes: Uint8Array, kind: string, finding: string): boolean;

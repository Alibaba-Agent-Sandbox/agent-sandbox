/** Plain-text table: padded columns, a bold header, no borders and no wrapping (ids stay copyable). */

import stringWidth from "string-width";

/** Width of `text` in terminal cells (wide CJK characters count as two). */
export const cellWidth = (text: string): number => stringWidth(text);

export function renderTable(headers: readonly string[], rows: readonly (readonly string[])[], bold: (text: string) => string = (t) => t): string {
  const flat = (cell: unknown): string => String(cell ?? "").replace(/\s*[\r\n]+\s*/g, " ");
  const grid = [headers.map(flat), ...rows.map((row) => headers.map((_, i) => flat(row[i])))];
  const widths = headers.map((_, i) => Math.max(...grid.map((row) => cellWidth(row[i] as string))));
  const line = (row: readonly string[], paint: (text: string) => string): string =>
    row
      .map((cell, i) => (i === row.length - 1 ? paint(cell) : paint(cell) + " ".repeat(widths[i]! - cellWidth(cell))))
      .join("  ")
      .trimEnd();
  return [line(grid[0] as string[], bold), ...grid.slice(1).map((row) => line(row, (t) => t))].join("\n");
}

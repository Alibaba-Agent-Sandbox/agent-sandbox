/** Terminal colour on picocolors. Colour is always emitted here; `echo` strips it for streams that are not terminals. */

import pc from "picocolors";

const colors = pc.createColors(true);

export type ColorName = "red" | "green" | "yellow" | "blue" | "cyan" | "bold" | "dim" | "bright_black";

const painters: Record<ColorName, (text: string) => string> = {
  red: colors.red,
  green: colors.green,
  yellow: colors.yellow,
  blue: colors.blue,
  cyan: colors.cyan,
  bold: colors.bold,
  dim: colors.dim,
  bright_black: colors.gray,
};

export const paint = (text: string, color: ColorName): string => painters[color](text);

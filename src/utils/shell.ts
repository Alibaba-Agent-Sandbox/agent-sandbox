/** Quote one literal POSIX shell argument, preserving the always-quoted command format. */
export function quoteShellLiteral(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

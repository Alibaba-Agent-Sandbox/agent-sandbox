/** Select the explicitly requested project CLI without changing remote argv. */
export function selectCommandSurface(argv: readonly string[]): { native: boolean; args: string[] } {
  return argv[0] === "--native"
    ? { native: true, args: argv.slice(1) }
    : { native: false, args: [...argv] };
}

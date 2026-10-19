/** Process harness for the project extension command framework, not the standard E2B executable. */

const emitWarning = process.emitWarning;
process.emitWarning = function(warning, ...rest): void {
  if (typeof warning === "string" && warning.startsWith("The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR'")) return;
  Reflect.apply(emitWarning, process, [warning, ...rest]);
} as typeof process.emitWarning;

void (async () => {
  const [{ main }, { drainRealStreams, finalizeStreams }] = await Promise.all([
    import("../../src/cli/main.js"), import("../../src/cli/io.js"),
  ]);
  const code = await main();
  await drainRealStreams();
  process.exit(finalizeStreams(code));
})();

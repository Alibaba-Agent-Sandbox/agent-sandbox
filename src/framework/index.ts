/** `click`-compatible mini framework (Click 8.5 behaviour). Import everything from here. */

export * from "./core.js";
export * from "./decorators.js";
export * from "./exceptions.js";
export * from "./formatting.js";
export { getCurrentContext, resolveColorDefault } from "./globals.js";
export { sys, realStreams, type TextInput, type TextOutput } from "./io.js";
export { OptionParser } from "./parser.js";
export { confirm, prompt, termui } from "./termui.js";
export {
  BOOL,
  BoolParamType,
  Choice,
  FLOAT,
  FloatRange,
  FuncParamType,
  INT,
  IntRange,
  ParamType,
  Path,
  STRING,
  Tuple,
  UNPROCESSED,
  UUID,
  ValueError,
  convertType,
} from "./types.js";
export { EOFError, KeyboardInterrupt, OSError, SystemExit, echo, secho, style, sysExit, unstyle } from "./utils.js";
export { PyFloat } from "./py.js";

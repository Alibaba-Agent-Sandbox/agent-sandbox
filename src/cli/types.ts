/** Value types of options, arguments and prompts: each converts the raw text or throws a {@link ParamError}. */

import * as fs from "node:fs";

import { parseFloatStrict, parseIntStrict, pyStrRepr } from "../utils/_py.js";

/** The text is not a valid value of its parameter. */
export class ParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParamError";
  }
}

export abstract class ParamType {
  abstract readonly name: string;
  /** Placeholder shown in `--help` for options of this type. */
  get metavar(): string | null {
    return null;
  }
  abstract convert(value: string): unknown;
}

class IntType extends ParamType {
  readonly name = "integer";
  override get metavar(): string {
    return "INTEGER";
  }
  convert(value: string): number | bigint {
    const n = parseIntStrict(value);
    if (n === null) throw new ParamError(`${pyStrRepr(value)} is not a valid integer.`);
    return n;
  }
}

class FloatType extends ParamType {
  readonly name = "float";
  override get metavar(): string {
    return "FLOAT";
  }
  convert(value: string): number {
    const n = parseFloatStrict(value);
    if (n === null) throw new ParamError(`${pyStrRepr(value)} is not a valid float.`);
    return n;
  }
}

export const INT: ParamType = new IntType();
export const FLOAT: ParamType = new FloatType();

export class IntRange extends ParamType {
  readonly name = "integer range";
  readonly min: number | null;
  readonly max: number | null;

  constructor(opts: { min?: number | null; max?: number | null } = {}) {
    super();
    this.min = opts.min ?? null;
    this.max = opts.max ?? null;
  }

  convert(value: string): number | bigint {
    const n = INT.convert(value) as number | bigint;
    if ((this.min !== null && n < this.min) || (this.max !== null && n > this.max)) {
      const lo = this.min === null ? "" : `${this.min}<=`;
      const hi = this.max === null ? "" : `<=${this.max}`;
      throw new ParamError(`${n} is not in the range ${lo}x${hi}.`);
    }
    return n;
  }
}

export class Choice extends ParamType {
  readonly name = "choice";
  readonly choices: readonly string[];
  readonly case_sensitive: boolean;

  constructor(choices: readonly string[], opts: { case_sensitive?: boolean } = {}) {
    super();
    this.choices = choices;
    this.case_sensitive = opts.case_sensitive ?? true;
  }

  convert(value: string): string {
    const fold = (s: string): string => (this.case_sensitive ? s : s.toLowerCase());
    const hit = this.choices.find((c) => fold(c) === fold(value));
    if (hit === undefined) {
      throw new ParamError(`${pyStrRepr(value)} is not one of ${this.choices.map((c) => pyStrRepr(c)).join(", ")}.`);
    }
    return hit;
  }
}

export class Path extends ParamType {
  readonly name = "path";
  readonly exists: boolean;

  constructor(opts: { exists?: boolean } = {}) {
    super();
    this.exists = opts.exists ?? false;
  }

  override get metavar(): string {
    return "PATH";
  }

  convert(value: string): string {
    if (this.exists && !fs.existsSync(value)) throw new ParamError(`Path ${pyStrRepr(value)} does not exist.`);
    return value;
  }
}

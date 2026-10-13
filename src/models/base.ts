/**
 * Validated data models on top of zod.
 *
 * A model is a zod object schema (`static schema`, keyed by field name) plus an optional wire-name table
 * (`static aliases`, field -> camelCase name used by the platform API). `new Model(input)` and
 * `Model.modelValidate(input)` accept either spelling of a key, apply the schema (defaults, coercion of the loosely
 * typed API payloads, range checks) and throw a `ZodError` on invalid input.
 */

import { z } from "zod";

/** Input that failed a model's schema; `message` lists every offending field, `issues` are zod's. */
export class ValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(title: string, error: z.ZodError) {
    super(`Invalid ${title}:\n${z.prettifyError(error)}`);
    this.name = "ValidationError";
    this.issues = error.issues;
  }
}

type Input = Record<string, unknown>;

/** The schema builders models use. Numbers and booleans accept the string forms APIs and env files produce. */
export const lax = {
  int: (min?: number, max?: number) => {
    let n = z.number().int();
    if (min !== undefined) n = n.min(min);
    if (max !== undefined) n = n.max(max);
    return z.preprocess(toNumber, n);
  },
  float: (min?: number) => z.preprocess(toNumber, min === undefined ? z.number() : z.number().min(min)),
  bool: () =>
    z.preprocess((v) => {
      if (typeof v === "number") return v === 1 ? true : v === 0 ? false : v;
      if (typeof v !== "string") return v;
      const s = v.trim().toLowerCase();
      return ["1", "on", "t", "true", "y", "yes"].includes(s) ? true : ["0", "off", "f", "false", "n", "no"].includes(s) ? false : v;
    }, z.boolean()),
  /** A string-to-string map; keeps every own key (zod's `record` drops `__proto__`). */
  stringMap: () =>
    z.custom<Record<string, string>>(
      (v) => typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string"),
      "Expected an object whose values are strings",
    ),
  /** ISO text, epoch seconds or epoch milliseconds, or a `Date`. */
  date: () =>
    z.preprocess((v) => {
      if (typeof v === "number") return new Date(Math.abs(v) < 2e10 ? v * 1000 : v);
      if (typeof v === "string") return new Date(v);
      return v;
    }, z.date()),
};

function toNumber(v: unknown): unknown {
  if (typeof v === "object" && v !== null && "value" in v && typeof (v as { value: unknown }).value === "number") return (v as { value: number }).value;
  if (typeof v === "string" && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) return Number(v);
  return v;
}

/** `value` is a model or a plain object for the model class `cls` (nested model field). */
export const nested = <T extends Model>(cls: ModelClass<T>) =>
  z.unknown().transform((v, ctx): T => {
    if (v instanceof cls) return v;
    const r = cls.schema.safeParse(withFieldNames(cls, v));
    if (!r.success) {
      for (const issue of r.error.issues) ctx.addIssue({ ...issue, path: issue.path });
      return z.NEVER;
    }
    return Object.assign(Object.create(cls.prototype) as T, r.data);
  });

export interface ModelClass<T extends Model> {
  new (input?: Input): T;
  schema: z.ZodObject;
  aliases: Readonly<Record<string, string>>;
  prototype: T;
}

function withFieldNames(cls: { aliases: Readonly<Record<string, string>> }, data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const input = data as Input;
  const out: Input = { ...input };
  for (const [name, alias] of Object.entries(cls.aliases)) if (alias in input) out[name] = input[alias];
  return out;
}

export interface DumpOptions {
  mode?: "python" | "json";
  by_alias?: boolean;
  exclude_none?: boolean;
}

export class Model {
  static schema: z.ZodObject = z.object({});
  static aliases: Readonly<Record<string, string>> = {};
  /** Fields kept off the wire (`modelDump` skips them). */
  static internal: readonly string[] = [];

  constructor(input: Input = {}) {
    Object.assign(this, parse(this.constructor as typeof Model, input));
  }

  static modelValidate<T extends Model>(this: ModelClass<T>, data: unknown): T {
    if (data instanceof this) return data;
    const parsed = parse(this as unknown as typeof Model, data);
    return Object.assign(Object.create(this.prototype) as T, parsed);
  }

  static modelValidateJson<T extends Model>(this: ModelClass<T>, raw: string | Uint8Array): T {
    const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
    return Model.modelValidate.call(this, JSON.parse(text)) as T;
  }

  modelDump(opts: DumpOptions = {}): Record<string, unknown> {
    const ctor = this.constructor as typeof Model;
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(ctor.schema.shape)) {
      if (ctor.internal.includes(name)) continue;
      const value = (this as unknown as Input)[name];
      if (opts.exclude_none && (value === null || value === undefined)) continue;
      out[opts.by_alias ? (ctor.aliases[name] ?? name) : name] = dump(value, opts);
    }
    return out;
  }

  modelDumpJson(opts: DumpOptions & { indent?: number } = {}): string {
    return JSON.stringify(this.modelDump({ ...opts, mode: "json" }), null, opts.indent);
  }

  toJSON(): Record<string, unknown> {
    return this.modelDump({ mode: "json" });
  }
}

function parse(cls: typeof Model, data: unknown): Input {
  const r = cls.schema.safeParse(withFieldNames(cls, data));
  if (!r.success) throw new ValidationError(cls.name, r.error);
  return r.data as Input;
}

function dump(value: unknown, opts: DumpOptions): unknown {
  if (value instanceof Model) return value.modelDump(opts);
  if (value instanceof Date) return opts.mode === "json" ? value.toISOString() : value;
  if (Array.isArray(value)) return value.map((v) => dump(v, opts));
  return value;
}

/** The constructor side of a model class: what `defineModel` returns and subclasses inherit. */
export interface ModelBase<D> {
  new (input?: Input): Model & D;
  schema: z.ZodObject;
  aliases: Readonly<Record<string, string>>;
  internal: readonly string[];
  modelValidate<T extends Model>(this: ModelClass<T>, data: unknown): T;
  modelValidateJson<T extends Model>(this: ModelClass<T>, raw: string | Uint8Array): T;
}

/** Base class for a model with the fields of `schema`; `aliases` maps a field to its wire name. */
export function defineModel<S extends z.ZodObject>(
  schema: S,
  opts: { aliases?: Record<string, string>; internal?: readonly string[] } = {},
): ModelBase<z.output<S>> {
  class Defined extends Model {
    static override schema = schema;
    static override aliases = opts.aliases ?? {};
    static override internal = opts.internal ?? [];
  }
  return Defined as unknown as ModelBase<z.output<S>>;
}

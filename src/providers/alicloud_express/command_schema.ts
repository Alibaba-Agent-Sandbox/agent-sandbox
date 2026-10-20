/** Provider-owned conversion to the bounded discovery schema dialect. */
import { z } from "zod";

/** Keep semantic regex/format validation in the provider, outside the host schema dialect. */
export function commandSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "pattern" && key !== "format").map(([key, child]) => [key, strip(child)]));
  };
  return strip(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

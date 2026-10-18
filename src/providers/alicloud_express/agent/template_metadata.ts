/** Static Express template schemas. Does not import credentials, SDKs or cloud code. */
import { z } from "zod";
import type { JsonObject } from "../../../agent/_py.js";
const scope = { team_id: z.string().min(1), region: z.string().min(1).optional() };
export const templateInputs = {
  submit_template_build: z.strictObject({ ...scope, name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), image: z.string().min(1), generation: z.union([z.literal(1), z.literal(2)]).default(2), cpu: z.number().positive().default(2), memory: z.number().int().min(128).default(2048), start_command: z.string().optional(), ready_command: z.string().optional(), envd_inject: z.boolean().default(true) }),
  get_template_build: z.strictObject({ ...scope, template_id: z.string().min(1) }),
};
export const TEMPLATE_SCHEMAS = Object.entries(templateInputs).map(([name, schema]) => ({ name,
  description: name === "submit_template_build" ? "Submit a new, uniquely named OCI template through the Alibaba AK/SK adapter. Submission is not readiness. Existing names are refused to preserve rollback. Other providers require their own adapter."
    : "Query Alibaba template build state; even ready needs runtime validation. Requires AK/SK and explicit Team.",
  inputSchema: z.toJSONSchema(schema, { io: "input" }) as JsonObject,
}));

/** Process execution data models. */

import { z } from "zod";

import { defineModel, lax, nested } from "./base.js";

/** Type of streaming process output chunk. */
export const ProcessChunkType = {
  STDOUT: "stdout",
  STDERR: "stderr",
  EXIT: "exit",
} as const;
export type ProcessChunkType = (typeof ProcessChunkType)[keyof typeof ProcessChunkType];

/** A single chunk of streaming process output. */
export class ProcessChunk extends defineModel(
  z.object({
    type: z.enum(ProcessChunkType),
    data: z.string().default(""),
    exit_code: lax.int().nullable().default(null),
    pid: z.union([z.string(), lax.int()]).nullable().default(null),
    timestamp: lax.float().nullable().default(null),
  }),
) {}

/** Result of a completed process execution. */
export class ProcessResult extends defineModel(
  z.object({
    stdout: z.string().default(""),
    stderr: z.string().default(""),
    exit_code: lax.int().default(0),
    execution_time: lax.float().default(0.0),
  }),
) {
  get success(): boolean {
    return this.exit_code === 0;
  }
}

/**
 * Result of a named command registered on the in-sandbox SandboxServer (`POST /commands/{name}`).
 *
 * `value` is the JSON return value of the registered function; `exit_code` is `0` on success or `1` when the server
 * reported a validation/execution error (then `stderr` carries `<ErrorType>: <message>`).
 */
export class CommandResult extends defineModel(
  z.object({
    value: z.unknown().default(null),
    stderr: z.string().default(""),
    exit_code: lax.int().default(0),
  }),
) {
  get success(): boolean {
    return this.exit_code === 0;
  }
}

/** A file produced by code execution. */
export class OutputFile extends defineModel(
  z.object({
    name: z.string(),
    path: z.string(),
    size: lax.int().default(0),
    mime_type: z.string().default("application/octet-stream"),
  }),
) {}

/** Result of code execution (Code Interpreter). */
export class CodeResult extends defineModel(
  z.object({
    text: z.string().default(""),
    stdout: z.string().default(""),
    stderr: z.string().default(""),
    exit_code: lax.int().default(0),
    output_files: z.array(nested(OutputFile)).default(() => []),
    execution_time: lax.float().default(0.0),
  }),
) {
  get success(): boolean {
    return this.exit_code === 0;
  }
}

/** Information about a running process. */
export class ProcessInfo extends defineModel(
  z.object({
    pid: z.union([z.string(), lax.int()]),
    command: z.string().default(""),
    status: z.string().default("running"),
  }),
) {}

/** Process execution data models (port of `models/process.py`). */

import { BaseModel, type ModelInput, any, enumOf, field, float, int, list, modelOf, optional, str, union } from "./_pydantic.js";

/** Type of streaming process output chunk. */
export const ProcessChunkType = {
  STDOUT: "stdout",
  STDERR: "stderr",
  EXIT: "exit",
} as const;
export type ProcessChunkType = (typeof ProcessChunkType)[keyof typeof ProcessChunkType];

/** A single chunk of streaming process output. */
export class ProcessChunk extends BaseModel {
  static override modelFields = {
    type: field(enumOf(ProcessChunkType)),
    data: field(str(), { default: "" }),
    exit_code: field(optional(int()), { default: null }),
    pid: field(optional(int()), { default: null }),
    timestamp: field(optional(float()), { default: null }),
  };

  declare type: ProcessChunkType;
  declare data: string;
  declare exit_code: number | null;
  declare pid: number | null;
  declare timestamp: number | null;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

/** Result of a completed process execution. */
export class ProcessResult extends BaseModel {
  static override modelFields = {
    stdout: field(str(), { default: "" }),
    stderr: field(str(), { default: "" }),
    exit_code: field(int(), { default: 0 }),
    execution_time: field(float(), { default: 0.0 }),
  };

  declare stdout: string;
  declare stderr: string;
  declare exit_code: number;
  declare execution_time: number;

  constructor(data: ModelInput = {}) {
    super(data);
  }

  get success(): boolean {
    return this.exit_code === 0;
  }
}

/**
 * Unified result of `Sandbox.custom` — template or server command.
 *
 * `custom()` resolves a named command in one of two ways and wraps both outcomes in this single type:
 *
 * - **template** (mechanism A, `template.yaml` `custom_commands`): `value` is `stdout` stripped of surrounding
 *   whitespace and the `stdout`/`stderr`/`exit_code` fields carry the underlying process result.
 * - **server** (mechanism B, `POST /commands/{name}` on SandboxServer): `value` is the JSON return value of the
 *   Python function, `stdout` and `stderr` are empty, and `exit_code` is `0` on success or `1` on failure.
 */
export class CommandResult extends BaseModel {
  static override modelFields = {
    value: field(any(), { default: null }),
    stdout: field(str(), { default: "" }),
    stderr: field(str(), { default: "" }),
    exit_code: field(int(), { default: 0 }),
    execution_time: field(float(), { default: 0.0 }),
    source: field(str(), { default: "" }), // "template" | "server"
  };

  declare value: unknown;
  declare stdout: string;
  declare stderr: string;
  declare exit_code: number;
  declare execution_time: number;
  declare source: string;

  constructor(data: ModelInput = {}) {
    super(data);
  }

  get success(): boolean {
    return this.exit_code === 0;
  }
}

/** A file produced by code execution. */
export class OutputFile extends BaseModel {
  static override modelFields = {
    name: field(str()),
    path: field(str()),
    size: field(int(), { default: 0 }),
    mime_type: field(str(), { default: "application/octet-stream" }),
  };

  declare name: string;
  declare path: string;
  declare size: number;
  declare mime_type: string;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

/** Result of code execution (Code Interpreter). */
export class CodeResult extends BaseModel {
  static override modelFields = {
    text: field(str(), { default: "" }),
    stdout: field(str(), { default: "" }),
    stderr: field(str(), { default: "" }),
    exit_code: field(int(), { default: 0 }),
    output_files: field(list(modelOf(() => OutputFile)), { default_factory: () => [] }),
    execution_time: field(float(), { default: 0.0 }),
  };

  declare text: string;
  declare stdout: string;
  declare stderr: string;
  declare exit_code: number;
  declare output_files: OutputFile[];
  declare execution_time: number;

  constructor(data: ModelInput = {}) {
    super(data);
  }

  get success(): boolean {
    return this.exit_code === 0;
  }
}

/** Information about a running process. */
export class ProcessInfo extends BaseModel {
  static override modelFields = {
    pid: field(union([["str", str()], ["int", int()]])),
    command: field(str(), { default: "" }),
    status: field(str(), { default: "running" }),
  };

  declare pid: number | string;
  declare command: string;
  declare status: string;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

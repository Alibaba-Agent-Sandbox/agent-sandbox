/** Tests for process data models. */

import { describe, expect, it } from "vitest";

import {
  CodeResult,
  OutputFile,
  ProcessChunk,
  ProcessChunkType,
  ProcessInfo,
  ProcessResult,
} from "../../src/models/process.js";

describe("TestProcessResult", () => {
  it("test_success_true", () => {
    const result = new ProcessResult({ stdout: "hello", exit_code: 0 });
    expect(result.success).toBe(true);
  });

  it("test_success_false", () => {
    const result = new ProcessResult({ exit_code: 1, stderr: "error" });
    expect(result.success).toBe(false);
  });

  it("test_defaults", () => {
    const result = new ProcessResult();
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exit_code).toBe(0);
    expect(result.execution_time).toBe(0.0);
  });
});

describe("TestProcessChunk", () => {
  it("test_stdout_chunk", () => {
    const chunk = new ProcessChunk({ type: ProcessChunkType.STDOUT, data: "hello" });
    expect(chunk.type).toBe(ProcessChunkType.STDOUT);
    expect(chunk.data).toBe("hello");
    expect(chunk.exit_code).toBeNull();
  });

  it("test_stderr_chunk", () => {
    const chunk = new ProcessChunk({ type: ProcessChunkType.STDERR, data: "err" });
    expect(chunk.type).toBe(ProcessChunkType.STDERR);
  });

  it("test_exit_chunk", () => {
    const chunk = new ProcessChunk({ type: ProcessChunkType.EXIT, exit_code: 0, timestamp: 1234567890.0 });
    expect(chunk.type).toBe(ProcessChunkType.EXIT);
    expect(chunk.exit_code).toBe(0);
    expect(chunk.timestamp).toBe(1234567890.0);
  });

  it("test_chunk_type_enum", () => {
    expect(ProcessChunkType.STDOUT).toBe("stdout");
    expect(ProcessChunkType.STDERR).toBe("stderr");
    expect(ProcessChunkType.EXIT).toBe("exit");
  });
});

describe("TestOutputFile", () => {
  it("test_serialization", () => {
    const f = new OutputFile({ name: "plot.png", path: "/tmp/plot.png", size: 1024, mime_type: "image/png" });
    const d = f.modelDump();
    expect(d["name"]).toBe("plot.png");
    expect(d["path"]).toBe("/tmp/plot.png");
    expect(d["size"]).toBe(1024);
    expect(d["mime_type"]).toBe("image/png");
  });

  it("test_defaults", () => {
    const f = new OutputFile({ name: "a.txt", path: "/a.txt" });
    expect(f.size).toBe(0);
    expect(f.mime_type).toBe("application/octet-stream");
  });
});

describe("TestCodeResult", () => {
  it("test_with_output_files", () => {
    const files = [new OutputFile({ name: "out.csv", path: "/out.csv" })];
    const result = new CodeResult({
      text: "result",
      stdout: "ok",
      exit_code: 0,
      output_files: files,
      execution_time: 1.5,
    });
    expect(result.success).toBe(true);
    expect(result.output_files.length).toBe(1);
    expect(result.output_files[0]?.name).toBe("out.csv");
    expect(result.execution_time).toBe(1.5);
  });

  it("test_success_false", () => {
    const result = new CodeResult({ exit_code: 1 });
    expect(result.success).toBe(false);
  });

  it("test_defaults", () => {
    const result = new CodeResult();
    expect(result.text).toBe("");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exit_code).toBe(0);
    expect(result.output_files).toEqual([]);
    expect(result.execution_time).toBe(0.0);
  });
});

describe("TestProcessInfo", () => {
  it("test_model", () => {
    const info = new ProcessInfo({ pid: 1234, command: "python main.py" });
    expect(info.pid).toBe(1234);
    expect(info.command).toBe("python main.py");
    expect(info.status).toBe("running");
  });

  it("test_defaults", () => {
    const info = new ProcessInfo({ pid: 1 });
    expect(info.command).toBe("");
    expect(info.status).toBe("running");
  });
});

/**
 * Per-class oracle check of `str(SandboxError)` and friends.
 *
 * The immutable `tests/fixtures/error_str_oracle.json` is generated from the ORIGINAL Python `models/errors.py` by
 * `parity/diff/error_str_gen.py` (every SandboxError subclass x 3 constructor variants). Root cause of an MCP parity bug:
 * The current error_str_contract_e2b.json preserves that baseline with the documented
 * positional-template/--prompt hint updates; its metadata records the source hash.
 * The tool logger / JSON-RPC error text used `exc.message` where Python formats `str(exc)` (`[E2000] msg\n  Suggestion: ...`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { pyExcStr } from "../../src/api/_pyerrors.js";
import { dispatchTool, _formatToolError } from "../../src/agent/tools.js";
import * as errors from "../../src/models/errors.js";
import { getLogger, Handler, type LogRecord } from "../../src/utils/logging.js";

interface Case {
  cls: string;
  variant: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
  expected: {
    str: string;
    message: string;
    code: string;
    suggestion: string;
    docs_url: string;
    to_dict: Record<string, string>;
    args: unknown[];
    attrs: Record<string, unknown>;
  };
}

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "error_str_contract_e2b.json"), "utf8"),
) as { classes: string[]; cases: Case[] };

const registry = errors as unknown as Record<string, new (...args: unknown[]) => errors.SandboxError>;

describe("TestSandboxErrorStrOracle", () => {
  it("test_every_python_error_class_is_exported", () => {
    const missing = fixture.classes.filter((name) => typeof registry[name] !== "function");
    expect(missing).toEqual([]);
    const extra = Object.keys(registry).filter(
      (name) =>
        typeof registry[name] === "function" &&
        registry[name]!.prototype instanceof errors.SandboxError &&
        !fixture.classes.includes(name),
    );
    expect(extra).toEqual([]);
  });

  it.each(fixture.cases.map((c) => [`${c.cls} ${c.variant}`, c] as const))("test_str_matches_python [%s]", (_label, c) => {
    const Cls = registry[c.cls]!;
    const exc = Object.keys(c.kwargs).length ? new Cls(...c.args, c.kwargs) : new Cls(...c.args);
    expect(String(exc)).toBe(c.expected.str);
    expect(exc.__str__()).toBe(c.expected.str);
    expect(pyExcStr(exc)).toBe(c.expected.str);
    expect(exc.message).toBe(c.expected.message);
    expect(exc.code).toBe(c.expected.code);
    expect(exc.suggestion).toBe(c.expected.suggestion);
    expect(exc.docs_url).toBe(c.expected.docs_url);
    expect(exc.toDict()).toEqual(c.expected.to_dict);
    for (const [key, value] of Object.entries(c.expected.attrs)) {
      expect((exc as unknown as Record<string, unknown>)[key]).toEqual(value);
    }
  });

  it.each(fixture.cases.map((c) => [`${c.cls} ${c.variant}`, c] as const))(
    "test_tool_error_payload_and_log_use_str [%s]",
    async (_label, c) => {
      const Cls = registry[c.cls]!;
      const make = () => (Object.keys(c.kwargs).length ? new Cls(...c.args, c.kwargs) : new Cls(...c.args));
      const payload = _formatToolError(make());
      if (c.expected.message) {
        const want: Record<string, string> = { error: `[${c.expected.code}] ${c.expected.message}` };
        if (c.expected.suggestion) want.suggestion = c.expected.suggestion;
        expect(payload).toEqual(want);
      } else {
        expect(payload).toEqual({ error: c.expected.str.trim() || c.cls });
      }

      const records: string[] = [];
      const handler = new (class extends Handler {
        override emit(record: LogRecord): void {
          records.push(record.getMessage());
        }
      })();
      const logger = getLogger("agent.tools");
      logger.addHandler(handler);
      try {
        const manager = {
          getSandbox: async () => {
            throw make();
          },
        } as never;
        await dispatchTool("run_code", { code: "1" }, manager);
      } finally {
        logger.removeHandler(handler);
      }
      expect(records).toContain(`Tool run_code failed: ${c.expected.str}`);
    },
  );
});

/**
 * Adversarial review, area `core`: hand-written pydantic emulation, orjson-style encode, small helpers.
 *
 * Every expected value below was captured from the Python oracle (pydantic 2.14, orjson, python-dotenv 1.2.4,
 * `filelock`/`json`) and is frozen here, so the suite needs no oracle at run time. Tests are written to FAIL while the
 * Node port differs from the oracle. Differential fuzz drivers: `parity/diff/adv_core_{models,codec,helpers}.mjs`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GlobalConfig } from "../../../src/models/config.js";
import { SessionInfo } from "../../../src/models/session.js";
import { WatchEvent } from "../../../src/models/filesystem.js";
import { json_encode } from "../../../src/transport/codec.js";
import { dotenvValues } from "../../../src/utils/_dotenv.js";
import { SecretStore } from "../../../src/utils/keychain.js";

function errText(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return String((e as { __str__?: () => string }).__str__?.() ?? e);
  }
  return "<no error>";
}

const SESSION_BASE = '{"name":"n","sandbox_id":"s"';
const FURTHER = (t: string) => `\n    For further information visit https://errors.pydantic.dev/2.14/v/${t}`;

describe("ADV-core pydantic emulation (model_validate_json)", () => {
  it("ADV-core-01 input_value is truncated by UTF-8 bytes (pydantic-core), not by characters", () => {
    const got = errText(() => GlobalConfig.modelValidateJson(JSON.stringify({ timeout: "é".repeat(40) })));
    expect(got).toBe(
      "1 validation error for GlobalConfig\ntimeout\n  Input should be a valid integer, unable to parse string as an integer " +
        `[type=int_parsing, input_value='${"é".repeat(12)}...${"é".repeat(11)}', input_type=str]` +
        FURTHER("int_parsing"),
    );
  });

  it("ADV-core-02 input_value tail of a long ASCII string keeps 23 chars (closing quote counts)", () => {
    const got = errText(() => GlobalConfig.modelValidateJson(JSON.stringify({ timeout: "a".repeat(60) })));
    expect(got).toContain(`input_value='${"a".repeat(24)}...${"a".repeat(23)}', input_type=str]`);
  });

  it("ADV-core-03 int field rejects the string '5.' (int_parsing)", () => {
    const got = errText(() => GlobalConfig.modelValidateJson('{"timeout":"5."}'));
    expect(got).toBe(
      "1 validation error for GlobalConfig\ntimeout\n  Input should be a valid integer, unable to parse string as an integer " +
        "[type=int_parsing, input_value='5.', input_type=str]" +
        FURTHER("int_parsing"),
    );
  });

  it("ADV-core-04 int field with 1e+21 reports int_parsing_size", () => {
    const got = errText(() => GlobalConfig.modelValidateJson('{"timeout":1e+21}'));
    expect(got).toBe(
      "1 validation error for GlobalConfig\ntimeout\n  Unable to parse input string as an integer, exceeded maximum size " +
        "[type=int_parsing_size, input_value=1e+21, input_type=float]" +
        FURTHER("int_parsing_size"),
    );
  });

  it("ADV-core-05 bool field given a non-0/1 float reports bool_type, not bool_parsing", () => {
    const got = errText(() => GlobalConfig.modelValidateJson('{"secure":2.5}'));
    expect(got).toBe(
      "1 validation error for GlobalConfig\nsecure\n  Input should be a valid boolean " +
        "[type=bool_type, input_value=2.5, input_type=float]" +
        FURTHER("bool_type"),
    );
  });

  it("ADV-core-06 float field accepts underscore digit separators ('1_000' -> 1000.0)", () => {
    const ev = WatchEvent.modelValidateJson('{"type":"created","path":"/a","timestamp":"1_000"}');
    expect(ev.timestamp).toBe(1000);
  });

  it("ADV-core-07 datetime '+5' is accepted (unix seconds 5)", () => {
    const s = SessionInfo.modelValidateJson(`${SESSION_BASE},"createdAt":"+5"}`);
    expect(s.created_at).not.toBeNull();
    expect(String(s.created_at)).toMatch(/^1970-01-01/);
  });

  it.each([
    ["24:00:00Z", "2024-01-01T24:00:00Z"],
    ["T10 (hour only)", "2024-01-01T10"],
    ["+24:00 offset", "2024-01-01T00:00:00+24:00"],
  ])("ADV-core-08 datetime %s -> 'unexpected extra characters at the end of the input'", (_n, value) => {
    const got = errText(() => SessionInfo.modelValidateJson(`${SESSION_BASE},"createdAt":"${value}"}`));
    expect(got).toBe(
      "1 validation error for SessionInfo\ncreatedAt\n  Input should be a valid datetime or date, unexpected extra characters at the end of the input " +
        `[type=datetime_from_date_parsing, input_value='${value}', input_type=str]` +
        FURTHER("datetime_from_date_parsing"),
    );
  });

  it.each([
    ["{", "EOF while parsing an object at line 1 column 1"],
    ['{"name":"x",}', "trailing comma at line 1 column 13"],
    ["[1,2", "EOF while parsing a list at line 1 column 4"],
    ['{"name":"n"} x', "trailing characters at line 1 column 14"],
  ])("ADV-core-09 model_validate_json(%j) reports serde-style text '%s'", (raw, detail) => {
    const got = errText(() => SessionInfo.modelValidateJson(raw));
    expect(got).toContain(`  Invalid JSON: ${detail} [type=json_invalid`);
  });

  it("ADV-core-10 JSON-mode dict_type / model_type say 'object', not 'dictionary'", () => {
    expect(errText(() => SessionInfo.modelValidateJson(`${SESSION_BASE},"metadata":null}`))).toBe(
      "1 validation error for SessionInfo\nmetadata\n  Input should be an object [type=dict_type, input_value=None, input_type=NoneType]" +
        FURTHER("dict_type"),
    );
    expect(errText(() => SessionInfo.modelValidateJson("[]"))).toBe(
      "1 validation error for SessionInfo\n  Input should be an object [type=model_type, input_value=[], input_type=list]" +
        FURTHER("model_type"),
    );
  });
});

describe("ADV-core codec json_encode (orjson.dumps)", () => {
  it("ADV-core-11 small exponents use orjson's '1e-7', not '1e-07'", () => {
    expect(Buffer.from(json_encode({ c: 1e-7 })).toString()).toBe('{"c":1e-7}');
  });

  it("ADV-core-12 non-finite floats serialise as null", () => {
    const enc = (v: unknown) => Buffer.from(json_encode(v)).toString();
    expect(enc(Number.POSITIVE_INFINITY)).toBe("null");
    expect(enc({ a: Number.NEGATIVE_INFINITY })).toBe('{"a":null}');
    expect(enc(Number.NaN)).toBe("null");
  });
});

describe("ADV-core python-dotenv whitespace class (Python re `\\s` != JS `\\s`)", () => {
  function parse(content: string): [string, string | null][] {
    const dir = mkdtempSync(join(tmpdir(), "adv-core-env-"));
    try {
      const p = join(dir, ".env");
      writeFileSync(p, content, "utf8");
      return [...dotenvValues(p).entries()];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    ["\\x85 (NEL) between key and '='", "A\u0085=1", [["A", "1"]]],
    ["\\x1c (FS) leading the key", "\u001cA=1", [["A", "1"]]],
    ["\\x1f (US) before the value", "A=\u001f1", [["A", "1"]]],
    ["U+FEFF inside a key is NOT whitespace", "A\ufeffB=1", [["A\ufeffB", "1"]]],
    ["U+FEFF before '#' is NOT whitespace", "A=x\ufeff#c", [["A", "x\ufeff#c"]]],
  ] as const)("ADV-core-13 %s", (_n, content, expected) => {
    expect(parse(content)).toEqual(expected);
  });
});

describe("ADV-core SecretStore (keychain.py)", () => {
  function withFile(content: Buffer, fn: (s: SecretStore) => unknown): unknown {
    const dir = mkdtempSync(join(tmpdir(), "adv-core-keys-"));
    try {
      const p = join(dir, "secrets.json");
      writeFileSync(p, content);
      return fn(new SecretStore(p));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("ADV-core-14 a JSON list of pairs is accepted by dict(json.loads(...))", () => {
    expect(withFile(Buffer.from('[["a","1"]]'), (s) => s.get("a"))).toBe("1");
    expect(withFile(Buffer.from("[]"), (s) => s.get("a"))).toBeNull();
  });

  it("ADV-core-15 json.loads accepts NaN (the store must not silently drop the file)", () => {
    expect(withFile(Buffer.from('{"a": NaN, "b": "x"}'), (s) => s.listNames())).toEqual(["a", "b"]);
  });

  it("ADV-core-16 a secret literally named '__proto__' round-trips", () => {
    expect(
      withFile(Buffer.from("{}"), (s) => {
        s.set("__proto__", "x");
        return [s.get("__proto__"), s.listNames()];
      }),
    ).toEqual(["x", ["__proto__"]]);
  });

  it("ADV-core-17 a file with invalid UTF-8 raises (UnicodeDecodeError) instead of returning U+FFFD", () => {
    const bad = Buffer.concat([Buffer.from('{"a": "x'), Buffer.from([0xff]), Buffer.from('"}')]);
    expect(() => withFile(bad, (s) => s.get("a"))).toThrow();
  });
});

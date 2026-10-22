/** `decodeBytes` mirrors CPython `bytes.decode(encoding)` error texts (checked against the Python oracle). */

import { describe, expect, it } from "vitest";

import { LookupError, UnicodeDecodeError, decodeBytes } from "../../src/providers/shared/e2b/filesystem.js";

const b = (...bytes: number[]): Uint8Array => Uint8Array.from(bytes);

describe("TestDecodeBytes", () => {
  it("decodes valid utf-8 under every alias, ascii and latin-1", () => {
    expect(decodeBytes(Buffer.from("héllo 😀"), "UTF8")).toBe("héllo 😀");
    expect(decodeBytes(Buffer.from("héllo"), "utf_8")).toBe("héllo");
    expect(decodeBytes(Buffer.from("ab"), "ascii")).toBe("ab");
    expect(decodeBytes(b(0x61, 0xff), "latin-1")).toBe("aÿ");
    expect(decodeBytes(b(0xef, 0xbb, 0xbf, 0x61), "utf-8-sig")).toBe("a");
  });

  it("returns '' for empty input before looking the codec up", () => {
    expect(decodeBytes(b(), "no-such-codec")).toBe("");
  });

  const failures: Array<[string, Uint8Array, string, string]> = [
    ["invalid start byte", b(0xff), "utf-8", "'utf-8' codec can't decode byte 0xff in position 0: invalid start byte"],
    ["overlong start", b(0xc0, 0x80), "utf-8", "'utf-8' codec can't decode byte 0xc0 in position 0: invalid start byte"],
    ["single truncated", b(0x61, 0xc3), "utf-8", "'utf-8' codec can't decode byte 0xc3 in position 1: unexpected end of data"],
    ["double truncated", b(0xe2, 0x82), "utf-8", "'utf-8' codec can't decode bytes in position 0-1: unexpected end of data"],
    ["triple truncated", b(0xf0, 0x9f, 0x98), "utf-8", "'utf-8' codec can't decode bytes in position 0-2: unexpected end of data"],
    ["bad second byte", b(0xe2, 0x28, 0xa1), "utf-8", "'utf-8' codec can't decode byte 0xe2 in position 0: invalid continuation byte"],
    ["surrogate", b(0xed, 0xa0, 0x80), "utf-8", "'utf-8' codec can't decode byte 0xed in position 0: invalid continuation byte"],
    ["above U+10FFFF", b(0xf4, 0x90, 0x80, 0x80), "utf-8", "'utf-8' codec can't decode byte 0xf4 in position 0: invalid continuation byte"],
    ["bad fourth byte", b(0x61, 0x62, 0xf0, 0x9f, 0x98, 0x78), "UTF-8", "'utf-8' codec can't decode bytes in position 2-4: invalid continuation byte"],
    ["ascii", b(0x61, 0xc3), "ascii", "'ascii' codec can't decode byte 0xc3 in position 1: ordinal not in range(128)"],
  ];
  for (const [title, raw, encoding, message] of failures) {
    it(`raises UnicodeDecodeError: ${title}`, () => {
      expect(() => decodeBytes(raw, encoding)).toThrow(UnicodeDecodeError);
      expect(() => decodeBytes(raw, encoding)).toThrow(message);
    });
  }

  it("raises LookupError for unknown codecs and TypeError for non-str encodings", () => {
    expect(() => decodeBytes(b(0x61), "no-such")).toThrow(LookupError);
    expect(() => decodeBytes(b(0x61), "no-such")).toThrow("unknown encoding: no-such");
    expect(() => decodeBytes(b(0x61), "")).toThrow("unknown encoding: ");
    expect(() => decodeBytes(b(0x61), 1)).toThrow("decode() argument 'encoding' must be str, not int");
    expect(() => decodeBytes(b(), null)).toThrow("decode() argument 'encoding' must be str, not None");
    expect(() => decodeBytes(b(0x61), [])).toThrow("decode() argument 'encoding' must be str, not list");
  });
});

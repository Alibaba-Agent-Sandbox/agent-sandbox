import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readProjectDocument } from "../../src/template/project.js";

const fixtures = JSON.parse(fs.readFileSync(new URL("../../src/template/contract-v1/yaml-fixtures.json", import.meta.url), "utf8")) as {
  valid: Array<{ id: string; text: string; expected: unknown }>;
  invalid: Array<{ id: string; text?: string; hex?: string; repeat?: string; count?: number }>;
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-owner-yaml-vectors-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("owner YAML text and byte vectors through the actual CLI file reader", () => {
  for (const vector of fixtures.valid) it(`accepts ${vector.id}`, () => {
    const file = path.join(root, "template.yaml");
    fs.writeFileSync(file, vector.text);
    expect(readProjectDocument(file)).toEqual(vector.expected);
  });
  for (const vector of fixtures.invalid) it(`rejects ${vector.id}`, () => {
    const file = path.join(root, "template.yaml");
    const contents = vector.hex !== undefined ? Buffer.from(vector.hex, "hex")
      : vector.repeat !== undefined ? vector.repeat.repeat(vector.count ?? 0) : vector.text ?? "";
    fs.writeFileSync(file, contents);
    expect(() => readProjectDocument(file)).toThrow();
  });
});

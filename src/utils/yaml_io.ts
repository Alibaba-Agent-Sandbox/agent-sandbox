/**
 * YAML in and out for `template.yaml` and the generated deployment config, on the `yaml` package.
 *
 * Documents load with the YAML 1.1 rules (`yes`/`no` booleans, merge keys, timestamps) that template files have always
 * been read with, and a repeated key keeps its last value. An unknown tag or a control character is an error, so a
 * document never loads as something other than what it says. Dumps keep key order, use block style with unindented
 * sequences, prefer single quotes and fold at 80 columns.
 */

import { YAMLError, parseDocument, stringify } from "yaml";

export { YAMLError } from "yaml";

const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Parse a YAML document into plain data; throws a `YAMLError` (with line and column) on malformed input. */
export function loadYaml(text: string): unknown {
  const control = CONTROL_CHARACTER.exec(text);
  if (control !== null) {
    const code = control[0].charCodeAt(0).toString(16).padStart(4, "0");
    throw new YAMLError("YAMLParseError", [control.index, control.index + 1], "UNEXPECTED_TOKEN", `Unacceptable character #x${code}: special characters are not allowed`);
  }
  const doc = parseDocument(text, { version: "1.1", uniqueKeys: false });
  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem !== undefined) throw problem;
  return doc.toJS();
}

/** A YAML mapping as loaded: a plain object (not a list, set, date or scalar). */
export function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/** Serialize plain data to YAML text. */
export function dumpYaml(data: unknown): string {
  return stringify(data, { version: "1.1", indentSeq: false, lineWidth: 80, sortMapEntries: false, singleQuote: true });
}

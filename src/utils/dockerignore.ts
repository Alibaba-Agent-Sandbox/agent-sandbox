/**
 * .dockerignore matcher (Docker / BuildKit semantics) — port of `utils/dockerignore.py`.
 *
 * `abx template init --adopt` must know whether a file such as `.env` would be sent to `docker build` —
 * `.gitignore` is irrelevant, the build context is the whole directory minus the ignore file. This module
 * reimplements the documented matching rules so the check needs no Docker daemon:
 *
 * - one pattern per line; blank lines and `#` comments are skipped;
 * - patterns are **root-anchored** (a bare `.env` matches only `./.env`; use a leading double-star segment (double-star slash .env) for every directory);
 * - `*` and `?` never cross `/`; `**` matches any number of directories; `[...]` is a character class; `\` escapes;
 * - a pattern that matches a directory also excludes everything below it;
 * - a leading `!` re-includes, and the **last** matching line wins.
 *
 * Fail closed: a line this matcher cannot compile is recorded in `DockerIgnore.unparseable`. An unparseable
 * *exclusion* excludes nothing; an unparseable *re-include* makes `DockerIgnore.excludes` answer `false` for every
 * path, i.e. "assume it would be sent".
 *
 * Python → TS: `from_text` -> `fromText`, `from_file` -> `fromFile`, `has_negation` -> `has_negation` getter.
 */

import * as fs from "node:fs";

import { posixNormpath } from "./_pypath.js";
import { pySplitlines, pyStrip } from "./_pyformat.js";

export const __all__ = ["DockerIgnore"] as const;

export interface _Rule {
  readonly regex: RegExp;
  readonly negate: boolean;
}

function reEscape(ch: string): string {
  return /[\\^$.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch;
}

/** Translate one cleaned ignore pattern into a regex source (no anchors). */
export function _translate(pattern: string): string {
  const out: string[] = [];
  let i = 0;
  const chars = [...pattern];
  const n = chars.length;
  while (i < n) {
    const ch = chars[i] as string;
    const atSegmentStart = i === 0 || chars[i - 1] === "/";
    if (ch === "*" && chars.slice(i, i + 2).join("") === "**" && atSegmentStart) {
      const after = chars.slice(i + 2, i + 3).join("");
      if (after === "/") {
        out.push("(?:.*/)?");
        i += 3;
        continue;
      }
      if (after === "") {
        out.push(".*");
        i += 2;
        continue;
      }
    }
    if (ch === "*") {
      out.push("[^/]*");
      i += 1;
    } else if (ch === "?") {
      out.push("[^/]");
      i += 1;
    } else if (ch === "\\") {
      if (i + 1 >= n) throw new Error("ValueError: dangling escape");
      out.push(reEscape(chars[i + 1] as string));
      i += 2;
    } else if (ch === "[") {
      let j = i + 1;
      if (j < n && "!^".includes(chars[j] as string)) j += 1;
      if (j < n && chars[j] === "]") j += 1;
      while (j < n && chars[j] !== "]") j += 1;
      if (j >= n) throw new Error("ValueError: unterminated character class");
      let body = chars.slice(i + 1, j).join("");
      if (body.slice(0, 1) === "!" || body.slice(0, 1) === "^") body = `^${body.slice(1)}`;
      out.push(`[${body.replaceAll("\\", "\\\\")}]`);
      i = j + 1;
    } else {
      out.push(reEscape(ch));
      i += 1;
    }
  }
  return out.join("");
}

/** Compiled ignore rules for one build context. */
export class DockerIgnore {
  rules: readonly _Rule[];
  unparseable: readonly string[];
  _distrust: boolean;

  constructor(rules: readonly _Rule[] = [], unparseable: readonly string[] = [], distrust = false) {
    this.rules = rules;
    this.unparseable = unparseable;
    this._distrust = distrust;
  }

  static fromText(text: string): DockerIgnore {
    const rules: _Rule[] = [];
    const bad: string[] = [];
    let distrust = false;
    for (const raw of pySplitlines(text)) {
      let line = pyStrip(raw);
      if (!line || line.startsWith("#")) continue;
      const negate = line.startsWith("!");
      if (negate) line = pyStrip(line.slice(1));
      line = line !== "" && line !== "." ? posixNormpath(line) : "";
      line = line.replace(/^\/+/, "");
      if (!line || line === ".") {
        // A pattern that names the context root itself: not meaningful.
        if (negate) {
          bad.push(pyStrip(raw));
          distrust = true;
        }
        continue;
      }
      let regex: RegExp;
      try {
        regex = new RegExp(`^${_translate(line)}$`, "u");
      } catch {
        bad.push(pyStrip(raw));
        if (negate) distrust = true;
        continue;
      }
      rules.push({ regex, negate });
    }
    return new DockerIgnore(rules, bad, distrust);
  }

  /** `from_file`: read as UTF-8 with replacement characters for undecodable bytes. */
  static fromFile(path: string): DockerIgnore {
    return DockerIgnore.fromText(new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(fs.readFileSync(path)));
  }

  /** Whether any `!` line exists (directory pruning is then unsafe). */
  get has_negation(): boolean {
    return this._distrust || this.rules.some((r) => r.negate);
  }

  /**
   * Return whether `relPath` (POSIX, relative to the context) is ignored.
   *
   * `true` means Docker would not send the file. Any doubt answers `false`.
   */
  excludes(relPath: string): boolean {
    if (this._distrust) return false;
    const path = posixNormpath(relPath.replaceAll("\\", "/")).replace(/^\/+/, "");
    if (path === "" || path === ".") return false;
    const parts = path.split("/");
    const prefixes = parts.map((_, k) => parts.slice(0, k + 1).join("/"));
    let ignored = false;
    for (const rule of this.rules) {
      // Docker skips a rule unless it can flip the current state.
      if (rule.negate !== ignored) continue;
      if (prefixes.some((prefix) => rule.regex.test(prefix))) ignored = !rule.negate;
    }
    return ignored;
  }
}

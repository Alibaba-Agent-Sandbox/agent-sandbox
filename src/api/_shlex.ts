/**
 * Faithful port of CPython's `shlex` (3.11/3.12): `shlex.shlex` (posix mode, `punctuation_chars`),
 * `shlex.split`, `shlex.quote` and `shlex.join`.
 *
 * Not a mirror of a Python package module: shared seam so that command quoting/splitting in the Node port is
 * byte-for-byte identical to the Python CLI (`abx exec` argv quoting, `sh -c` auto-wrapping, ...).
 */

import { ValueError } from "./_pyerrors.js";

const WORDCHARS_BASE = "abcdfeghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
const WORDCHARS_POSIX_EXTRA =
  "ßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ";

export interface ShlexOptions {
  posix?: boolean;
  /** `true` => `();<>|&`, or an explicit string of punctuation characters. */
  punctuation_chars?: boolean | string;
}

/** Python `shlex.shlex` (string input only). */
export class Shlex implements Iterable<string> {
  readonly posix: boolean;
  readonly eof: string | null;
  commenters = "#";
  wordchars: string;
  whitespace = " \t\r\n";
  whitespace_split = false;
  quotes = "'\"";
  escape = "\\";
  escapedquotes = '"';
  state: string | null = " ";
  token = "";
  lineno = 1;
  readonly punctuation_chars: string;

  private readonly chars: string[];
  private pos = 0;
  private readonly pushbackChars: string[] = [];
  private readonly pushback: string[] = [];

  constructor(instream: string, opts: ShlexOptions = {}) {
    this.chars = Array.from(instream);
    this.posix = opts.posix ?? false;
    this.eof = this.posix ? null : "";
    this.wordchars = WORDCHARS_BASE + (this.posix ? WORDCHARS_POSIX_EXTRA : "");
    let punct = opts.punctuation_chars ?? false;
    if (punct === false) punct = "";
    else if (punct === true) punct = "();<>|&";
    this.punctuation_chars = punct;
    if (punct) {
      this.wordchars += "~-./*?=";
      const drop = new Set(Array.from(punct));
      this.wordchars = Array.from(this.wordchars)
        .filter((c) => !drop.has(c))
        .join("");
    }
  }

  private readChar(): string {
    return this.pos < this.chars.length ? (this.chars[this.pos++] as string) : "";
  }

  private readLine(): void {
    while (this.pos < this.chars.length) {
      const c = this.chars[this.pos++];
      if (c === "\n") break;
    }
  }

  pushToken(tok: string): void {
    this.pushback.unshift(tok);
  }

  getToken(): string | null {
    if (this.pushback.length) return this.pushback.shift() as string;
    return this.readToken();
  }

  readToken(): string | null {
    let quoted = false;
    let escapedstate = " ";
    const hasPunct = this.punctuation_chars.length > 0;
    for (;;) {
      let nextchar: string;
      if (hasPunct && this.pushbackChars.length) {
        nextchar = this.pushbackChars.pop() as string;
      } else {
        nextchar = this.readChar();
      }
      if (nextchar === "\n") this.lineno += 1;
      if (this.state === null) {
        this.token = "";
        break;
      } else if (this.state === " ") {
        if (!nextchar) {
          this.state = null;
          break;
        } else if (this.whitespace.includes(nextchar)) {
          if (this.token || (this.posix && quoted)) break;
          continue;
        } else if (this.commenters.includes(nextchar)) {
          this.readLine();
          this.lineno += 1;
        } else if (this.posix && this.escape.includes(nextchar)) {
          escapedstate = "a";
          this.state = nextchar;
        } else if (this.wordchars.includes(nextchar)) {
          this.token = nextchar;
          this.state = "a";
        } else if (this.punctuation_chars.includes(nextchar)) {
          this.token = nextchar;
          this.state = "c";
        } else if (this.quotes.includes(nextchar)) {
          if (!this.posix) this.token = nextchar;
          this.state = nextchar;
        } else if (this.whitespace_split) {
          this.token = nextchar;
          this.state = "a";
        } else {
          this.token = nextchar;
          if (this.token || (this.posix && quoted)) break;
          continue;
        }
      } else if (this.quotes.includes(this.state)) {
        quoted = true;
        if (!nextchar) throw new ValueError("No closing quotation");
        if (nextchar === this.state) {
          if (!this.posix) {
            this.token += nextchar;
            this.state = " ";
            break;
          } else {
            this.state = "a";
          }
        } else if (this.posix && this.escape.includes(nextchar) && this.escapedquotes.includes(this.state)) {
          escapedstate = this.state;
          this.state = nextchar;
        } else {
          this.token += nextchar;
        }
      } else if (this.escape.includes(this.state)) {
        if (!nextchar) throw new ValueError("No escaped character");
        if (this.quotes.includes(escapedstate) && nextchar !== this.state && nextchar !== escapedstate) {
          this.token += this.state;
        }
        this.token += nextchar;
        this.state = escapedstate;
      } else if (this.state === "a" || this.state === "c") {
        if (!nextchar) {
          this.state = null;
          break;
        } else if (this.whitespace.includes(nextchar)) {
          this.state = " ";
          if (this.token || (this.posix && quoted)) break;
          continue;
        } else if (this.commenters.includes(nextchar)) {
          this.readLine();
          this.lineno += 1;
          if (this.posix) {
            this.state = " ";
            if (this.token || (this.posix && quoted)) break;
            continue;
          }
        } else if (this.state === "c") {
          if (this.punctuation_chars.includes(nextchar)) {
            this.token += nextchar;
          } else {
            if (!this.whitespace.includes(nextchar)) this.pushbackChars.push(nextchar);
            this.state = " ";
            break;
          }
        } else if (this.posix && this.quotes.includes(nextchar)) {
          this.state = nextchar;
        } else if (this.posix && this.escape.includes(nextchar)) {
          escapedstate = "a";
          this.state = nextchar;
        } else if (
          this.wordchars.includes(nextchar) ||
          this.quotes.includes(nextchar) ||
          (this.whitespace_split && !this.punctuation_chars.includes(nextchar))
        ) {
          this.token += nextchar;
        } else {
          if (hasPunct) this.pushbackChars.push(nextchar);
          else this.pushback.unshift(nextchar);
          this.state = " ";
          if (this.token || (this.posix && quoted)) break;
          continue;
        }
      }
    }
    let result: string | null = this.token;
    this.token = "";
    if (this.posix && !quoted && result === "") result = null;
    return result;
  }

  [Symbol.iterator](): Iterator<string> {
    return {
      next: (): IteratorResult<string> => {
        const token = this.getToken();
        if (token === this.eof) return { done: true, value: undefined };
        return { done: false, value: token as string };
      },
    };
  }
}

/** Python `shlex.split(s, comments=False, posix=True)`. */
export function shlexSplit(s: string, comments = false, posix = true): string[] {
  if (s === null || s === undefined) throw new ValueError("s argument must not be None");
  const lex = new Shlex(s, { posix });
  lex.whitespace_split = true;
  if (!comments) lex.commenters = "";
  return Array.from(lex);
}

const UNSAFE = /[^A-Za-z0-9_@%+=:,./-]/;

/** Python `shlex.quote`. */
export function shlexQuote(s: string): string {
  if (!s) return "''";
  if (!UNSAFE.test(s)) return s;
  return "'" + s.replaceAll("'", "'\"'\"'") + "'";
}

/** Python `shlex.join`. */
export function shlexJoin(parts: Iterable<string>): string {
  return Array.from(parts, shlexQuote).join(" ");
}

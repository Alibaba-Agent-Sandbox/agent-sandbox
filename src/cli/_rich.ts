/**
 * "Rich-lite": the subset of the Python `rich` library (15.0.0) that `cli/output.py` and `cli/formatters.py` use,
 * ported so the byte output is identical:
 *
 *  - `Console` (colour-system / terminal / width detection, `print`, `render_str`, `render_lines`, control codes,
 *    `status`), `Table` (HEAVY_HEAD box, padding, width fitting / collapse, wrapping, ellipsis),
 *    `Text` (+ markup, emoji codes, spans, word wrap, truncation), `Style`/`Color` (SGR rendering with colour-system
 *    downgrade), `Segment` line ops, `Padding`, `Measurement`, and `Live`/`Status`/`Spinner` (cursor control, refresh
 *    timer, stdout/stderr redirection through `FileProxy`).
 *  - The data tables (cell widths, colour names, palettes, theme styles, emoji codes) are generated from Rich itself
 *    (`_rich_cells.ts`, `_rich_data.ts`).
 *
 * Deliberately NOT ported (never reached by the CLI): highlighters (tables run with `highlight=False`, status text is a
 * pre-built `Text`), `Table` titles / captions / footers / ratios / vertical alignment other than header-bottom,
 * links/meta (`[link=...]`, `[@click]` markup), Windows legacy console, Jupyter, pagers, `Console.log`, Pretty/Syntax.
 * See parity/KNOWN-GAPS.md.
 */

import { DEFAULT_STYLES, EIGHT_BIT_PALETTE, EMOJI, ANSI_COLOR_NAMES, STANDARD_PALETTE } from "./_rich_data.js";
import { NARROW_TO_WIDE, WIDTHS } from "./_rich_cells.js";
import { PY_WHITESPACE, splitlines, splitWhitespace } from "../framework/py.js";
import { sys as pySys } from "../framework/io.js";

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------

const cps = (s: string): string[] => Array.from(s);
const cpLen = (s: string): number => {
  let n = 0;
  for (const _ of s) {
    void _;
    n++;
  }
  return n;
};

/** Python `round()` (banker's rounding). */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

const pickBool = (...values: Array<boolean | null | undefined>): boolean => {
  for (const v of values) if (v !== null && v !== undefined) return v;
  return false;
};

const WS = `[${PY_WHITESPACE}]`;
const NWS = `[^${PY_WHITESPACE}]`;
const RE_WORD = new RegExp(`${WS}*${NWS}+${WS}*`, "uy");
const RE_TRAILING_WS = new RegExp(`${WS}+$`, "u");

// ---------------------------------------------------------------------------------------------------------------------
// cells
// ---------------------------------------------------------------------------------------------------------------------

const SINGLE_CELL_RANGES: Array<[number, number]> = [
  [0x20, 0x7e],
  [0xa0, 0xac],
  [0xae, 0x2ff],
  [0x370, 0x482],
  [0x2500, 0x25fc],
  [0x2800, 0x28ff],
];
const NARROW_TO_WIDE_SET = new Set(NARROW_TO_WIDE);
const cellSizeCache = new Map<number, number>();

function isSingleCell(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    let ok = false;
    for (const [a, b] of SINGLE_CELL_RANGES) {
      if (c >= a && c <= b) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

function charCellSize(cp: number): number {
  const cached = cellSizeCache.get(cp);
  if (cached !== undefined) return cached;
  let result = 1;
  if ((cp && cp < 32) || (cp >= 0x7f && cp < 0xa0)) result = 0;
  else {
    const n = WIDTHS.length / 3;
    if (cp <= (WIDTHS[(n - 1) * 3 + 1] as number)) {
      let lo = 0;
      let hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const start = WIDTHS[mid * 3] as number;
        const end = WIDTHS[mid * 3 + 1] as number;
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else {
          result = WIDTHS[mid * 3 + 2] as number;
          break;
        }
      }
    }
  }
  cellSizeCache.set(cp, result);
  return result;
}

/** `rich.cells.cell_len`. */
export function cellLen(text: string): number {
  if (isSingleCell(text)) return cpLen(text);
  if (!text.includes("\u200d") && !text.includes("\ufe0f")) {
    let total = 0;
    for (const ch of text) total += charCellSize(ch.codePointAt(0) as number);
    return total;
  }
  const chars = cps(text);
  let total = 0;
  let last: number | null = null;
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i] as string;
    if (ch === "\u200d" || ch === "\ufe0f") {
      if (ch === "\u200d") i += 1;
      else if (last !== null) {
        total += NARROW_TO_WIDE_SET.has(last) ? 1 : 0;
        last = null;
      }
    } else {
      const w = charCellSize(ch.codePointAt(0) as number);
      if (w) {
        last = ch.codePointAt(0) as number;
        total += w;
      }
    }
    i += 1;
  }
  return total;
}

type CellSpan = [number, number, number];

function splitGraphemes(text: string): [CellSpan[], number] {
  const chars = cps(text);
  const n = chars.length;
  let index = 0;
  let last: number | null = null;
  let total = 0;
  const spans: CellSpan[] = [];
  while (index < n) {
    const ch = chars[index] as string;
    if (ch === "\u200d" || ch === "\ufe0f") {
      if (!spans.length) {
        spans.push([index, index + 1, 0]);
        index += 1;
        continue;
      }
      if (ch === "\u200d") {
        index += index < n - 1 ? 2 : 1;
        const [start, , cl] = spans[spans.length - 1] as CellSpan;
        spans[spans.length - 1] = [start, index, cl];
      } else {
        index += 1;
        const [start, , cl0] = spans[spans.length - 1] as CellSpan;
        let cl = cl0;
        if (last !== null) {
          if (NARROW_TO_WIDE_SET.has(last)) {
            last = null;
            cl += 1;
            total += 1;
          }
        }
        spans[spans.length - 1] = [start, index, cl];
      }
      continue;
    }
    const w = charCellSize(ch.codePointAt(0) as number);
    if (w) {
      last = ch.codePointAt(0) as number;
      spans.push([index, index + 1, w]);
      index += 1;
      total += w;
    } else if (spans.length) {
      const [start, , cl] = spans[spans.length - 1] as CellSpan;
      index += 1;
      spans[spans.length - 1] = [start, index, cl];
    } else {
      spans.push([index, index + 1, 0]);
      index += 1;
    }
  }
  return [spans, total];
}

function splitTextInner(text: string, cellPosition: number): [string, string] {
  if (cellPosition <= 0) return ["", text];
  const chars = cps(text);
  const [spans, cellLength] = splitGraphemes(text);
  let offset = Math.trunc((cellPosition / cellLength) * spans.length);
  let leftSize = 0;
  for (let i = 0; i < offset; i++) leftSize += (spans[i] as CellSpan)[2];
  for (;;) {
    if (leftSize === cellPosition) {
      if (offset >= spans.length) return [text, ""];
      const idx = (spans[offset] as CellSpan)[0];
      return [chars.slice(0, idx).join(""), chars.slice(idx).join("")];
    }
    if (leftSize < cellPosition) {
      const [start, end, size] = spans[offset] as CellSpan;
      if (leftSize + size > cellPosition) return [`${chars.slice(0, start).join("")} `, ` ${chars.slice(end).join("")}`];
      offset += 1;
      leftSize += size;
    } else {
      const [start, end, size] = spans[offset - 1] as CellSpan;
      if (leftSize - size < cellPosition) return [`${chars.slice(0, start).join("")} `, ` ${chars.slice(end).join("")}`];
      offset -= 1;
      leftSize -= size;
    }
  }
}

/** `rich.cells.set_cell_size`. */
export function setCellSize(text: string, total: number): string {
  if (isSingleCell(text)) {
    const size = cpLen(text);
    if (size < total) return text + " ".repeat(total - size);
    return cps(text).slice(0, Math.max(total, 0)).join("");
  }
  if (total <= 0) return "";
  const size = cellLen(text);
  if (size === total) return text;
  if (size < total) return text + " ".repeat(total - size);
  return splitTextInner(text, total)[0];
}

/** `rich.cells.chop_cells`. */
export function chopCells(text: string, width: number): string[] {
  if (isSingleCell(text)) {
    const chars = cps(text);
    const out: string[] = [];
    for (let i = 0; i < chars.length; i += width) out.push(chars.slice(i, i + width).join(""));
    return out;
  }
  const chars = cps(text);
  const [spans] = splitGraphemes(text);
  let lineSize = 0;
  const lines: string[] = [];
  let lineOffset = 0;
  for (const [start, , size] of spans) {
    if (lineSize + size > width) {
      lines.push(chars.slice(lineOffset, start).join(""));
      lineOffset = start;
      lineSize = 0;
    }
    lineSize += size;
  }
  if (lineSize) lines.push(chars.slice(lineOffset).join(""));
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------
// colours and styles
// ---------------------------------------------------------------------------------------------------------------------

export enum ColorSystem {
  STANDARD = 1,
  EIGHT_BIT = 2,
  TRUECOLOR = 3,
}
enum ColorType {
  DEFAULT = 0,
  STANDARD = 1,
  EIGHT_BIT = 2,
  TRUECOLOR = 3,
}
type Triplet = [number, number, number];

export class StyleSyntaxError extends Error {}
export class ColorParseError extends Error {}
export class MarkupError extends Error {}
export class MissingStyle extends Error {}

class Color {
  constructor(
    readonly name: string,
    readonly type: ColorType,
    readonly number: number | null = null,
    readonly triplet: Triplet | null = null,
  ) {}

  get system(): ColorSystem {
    return this.type === ColorType.DEFAULT ? ColorSystem.STANDARD : (this.type as number as ColorSystem);
  }

  static parse(input: string): Color {
    const color = input.toLowerCase().trim();
    if (color === "default") return new Color(color, ColorType.DEFAULT);
    const named = ANSI_COLOR_NAMES[color];
    if (named !== undefined) return new Color(color, named < 16 ? ColorType.STANDARD : ColorType.EIGHT_BIT, named);
    const m = /^(?:#([0-9a-f]{6})$|color\(([0-9]{1,3})\)$|rgb\(([\d\s,]+)\)$)/.exec(color);
    if (!m) throw new ColorParseError(`${pyReprStr(input)} is not a valid color`);
    if (m[1]) {
      const h = m[1];
      return new Color(color, ColorType.TRUECOLOR, null, [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ]);
    }
    if (m[2]) {
      const number = parseInt(m[2], 10);
      if (number > 255) throw new ColorParseError(`color number must be <= 255 in ${pyReprStr(color)}`);
      return new Color(color, number < 16 ? ColorType.STANDARD : ColorType.EIGHT_BIT, number);
    }
    const comps = (m[3] as string).split(",");
    if (comps.length !== 3) throw new ColorParseError(`expected three components in ${pyReprStr(input)}`);
    const t = comps.map((c) => parseInt(c, 10)) as Triplet;
    if (t.some((c) => !(c <= 255))) throw new ColorParseError(`color components must be <= 255 in ${pyReprStr(input)}`);
    return new Color(color, ColorType.TRUECOLOR, null, t);
  }

  getAnsiCodes(foreground = true): string[] {
    switch (this.type) {
      case ColorType.DEFAULT:
        return [foreground ? "39" : "49"];
      case ColorType.STANDARD: {
        const n = this.number as number;
        const [fore, back] = n < 8 ? [30, 40] : [82, 92];
        return [String(foreground ? fore + n : back + n)];
      }
      case ColorType.EIGHT_BIT:
        return [foreground ? "38" : "48", "5", String(this.number)];
      default: {
        const [r, g, b] = this.triplet as Triplet;
        return [foreground ? "38" : "48", "2", String(r), String(g), String(b)];
      }
    }
  }

  downgrade(system: ColorSystem): Color {
    if (this.type === ColorType.DEFAULT || (this.type as number) === (system as number)) return this;
    if (system === ColorSystem.EIGHT_BIT && this.system === ColorSystem.TRUECOLOR) {
      const trip = this.triplet as Triplet;
      const [r, g, b] = [trip[0] / 255, trip[1] / 255, trip[2] / 255];
      const maxc = Math.max(r, g, b);
      const minc = Math.min(r, g, b);
      const sumc = maxc + minc;
      const rangec = maxc - minc;
      const l = sumc / 2;
      let s = 0;
      if (minc !== maxc) s = l <= 0.5 ? rangec / sumc : rangec / (2 - maxc - minc);
      if (s < 0.15) {
        const gray = pyRound(l * 25);
        const n = gray === 0 ? 16 : gray === 25 ? 231 : 231 + gray;
        return new Color(this.name, ColorType.EIGHT_BIT, n);
      }
      const six = (v: number): number => (v < 95 ? v / 95 : 1 + (v - 95) / 40);
      const n = 16 + 36 * pyRound(six(trip[0])) + 6 * pyRound(six(trip[1])) + pyRound(six(trip[2]));
      return new Color(this.name, ColorType.EIGHT_BIT, n);
    }
    if (system === ColorSystem.STANDARD) {
      let t: Triplet;
      if (this.system === ColorSystem.TRUECOLOR) t = this.triplet as Triplet;
      else {
        const n = this.number as number;
        t = [EIGHT_BIT_PALETTE[n * 3] as number, EIGHT_BIT_PALETTE[n * 3 + 1] as number, EIGHT_BIT_PALETTE[n * 3 + 2] as number];
      }
      return new Color(this.name, ColorType.STANDARD, paletteMatch(STANDARD_PALETTE, t));
    }
    return this;
  }
}

function paletteMatch(palette: readonly number[], color: Triplet): number {
  const [r1, g1, b1] = color;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length / 3; i++) {
    const r2 = palette[i * 3] as number;
    const g2 = palette[i * 3 + 1] as number;
    const b2 = palette[i * 3 + 2] as number;
    const redMean = Math.floor((r1 + r2) / 2);
    const red = r1 - r2;
    const green = g1 - g2;
    const blue = b1 - b2;
    const dist = Math.sqrt(
      Math.floor(((512 + redMean) * red * red) / 256) + 4 * green * green + Math.floor(((767 - redMean) * blue * blue) / 256),
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function pyReprStr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  return `${q}${s.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`)}${q}`;
}

const ATTR_NAMES = [
  "bold",
  "dim",
  "italic",
  "underline",
  "blink",
  "blink2",
  "reverse",
  "conceal",
  "strike",
  "underline2",
  "frame",
  "encircle",
  "overline",
] as const;
const SGR_MAP = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "21", "51", "52", "53"];
const STYLE_ATTRIBUTES: Record<string, (typeof ATTR_NAMES)[number]> = {
  dim: "dim",
  d: "dim",
  bold: "bold",
  b: "bold",
  italic: "italic",
  i: "italic",
  underline: "underline",
  u: "underline",
  blink: "blink",
  blink2: "blink2",
  reverse: "reverse",
  r: "reverse",
  conceal: "conceal",
  c: "conceal",
  strike: "strike",
  s: "strike",
  underline2: "underline2",
  uu: "underline2",
  frame: "frame",
  encircle: "encircle",
  overline: "overline",
  o: "overline",
};

export class Style {
  private ansiCache = new Map<number, string>();
  private def: string | null = null;

  constructor(
    readonly color: Color | null = null,
    readonly bgcolor: Color | null = null,
    readonly attributes = 0,
    readonly setAttributes = 0,
    readonly link: string | null = null,
  ) {}

  static readonly NULL = new Style();

  get isNull(): boolean {
    return !(this.setAttributes || this.color || this.bgcolor || this.link);
  }

  private static parseCache = new Map<string, Style>();

  static parse(definition: string): Style {
    const hit = Style.parseCache.get(definition);
    if (hit) return hit;
    const style = Style.parseUncached(definition);
    Style.parseCache.set(definition, style);
    return style;
  }

  private static parseUncached(definition: string): Style {
    if (definition.trim() === "none" || !definition) return Style.NULL;
    let color: string | null = null;
    let bgcolor: string | null = null;
    let link: string | null = null;
    const attrs = new Map<(typeof ATTR_NAMES)[number], boolean>();
    const words = splitWhitespace(definition);
    for (let i = 0; i < words.length; i++) {
      const original = words[i] as string;
      let word = original.toLowerCase();
      if (word === "on") {
        word = words[++i] ?? "";
        if (!word) throw new StyleSyntaxError("color expected after 'on'");
        try {
          Color.parse(word);
        } catch (e) {
          throw new StyleSyntaxError(`unable to parse ${pyReprStr(word)} as background color; ${(e as Error).message}`);
        }
        bgcolor = word;
      } else if (word === "not") {
        word = words[++i] ?? "";
        const attribute = STYLE_ATTRIBUTES[word];
        if (attribute === undefined) throw new StyleSyntaxError(`expected style attribute after 'not', found ${pyReprStr(word)}`);
        attrs.set(attribute, false);
      } else if (word === "link") {
        word = words[++i] ?? "";
        if (!word) throw new StyleSyntaxError("URL expected after 'link'");
        link = word;
      } else if (Object.prototype.hasOwnProperty.call(STYLE_ATTRIBUTES, word)) {
        attrs.set(STYLE_ATTRIBUTES[word] as (typeof ATTR_NAMES)[number], true);
      } else {
        try {
          Color.parse(word);
        } catch (e) {
          throw new StyleSyntaxError(`unable to parse ${pyReprStr(word)} as color; ${(e as Error).message}`);
        }
        color = word;
      }
    }
    let attributes = 0;
    let set = 0;
    for (const [name, on] of attrs) {
      const bit = 1 << ATTR_NAMES.indexOf(name);
      set |= bit;
      if (on) attributes |= bit;
    }
    return new Style(color ? Color.parse(color) : null, bgcolor ? Color.parse(bgcolor) : null, attributes, set, link);
  }

  static normalize(style: string): string {
    try {
      return Style.parse(style).toString();
    } catch (e) {
      if (e instanceof StyleSyntaxError) return style.trim().toLowerCase();
      throw e;
    }
  }

  add(other: Style | null | undefined): Style {
    if (!other || other.isNull) return this;
    if (this.isNull) return other;
    return new Style(
      other.color ?? this.color,
      other.bgcolor ?? this.bgcolor,
      (this.attributes & ~other.setAttributes) | (other.attributes & other.setAttributes),
      this.setAttributes | other.setAttributes,
      other.link ?? this.link,
    );
  }

  get withoutColor(): Style {
    if (this.isNull) return Style.NULL;
    return new Style(null, null, this.attributes, this.setAttributes, this.link);
  }

  toString(): string {
    if (this.def === null) {
      const parts: string[] = [];
      for (let bit = 0; bit < ATTR_NAMES.length; bit++) {
        if (this.setAttributes & (1 << bit)) {
          const name = ATTR_NAMES[bit] as string;
          parts.push(this.attributes & (1 << bit) ? name : `not ${name}`);
        }
      }
      if (this.color) parts.push(this.color.name);
      if (this.bgcolor) parts.push("on", this.bgcolor.name);
      if (this.link) parts.push("link", this.link);
      this.def = parts.join(" ") || "none";
    }
    return this.def;
  }

  private ansiCodes(system: ColorSystem): string {
    let cached = this.ansiCache.get(system);
    if (cached === undefined) {
      const sgr: string[] = [];
      const attributes = this.attributes & this.setAttributes;
      for (let bit = 0; bit < 13; bit++) if (attributes & (1 << bit)) sgr.push(SGR_MAP[bit] as string);
      if (this.color) sgr.push(...this.color.downgrade(system).getAnsiCodes());
      if (this.bgcolor) sgr.push(...this.bgcolor.downgrade(system).getAnsiCodes(false));
      cached = sgr.join(";");
      this.ansiCache.set(system, cached);
    }
    return cached;
  }

  render(text: string, colorSystem: ColorSystem | null): string {
    if (!text || colorSystem === null) return text;
    const attrs = this.ansiCodes(colorSystem);
    let rendered = attrs ? `\x1b[${attrs}m${text}\x1b[0m` : text;
    if (this.link) rendered = `\x1b]8;id=0;${this.link}\x1b\\${rendered}\x1b]8;;\x1b\\`;
    return rendered;
  }

  static combine(styles: Style[]): Style {
    let out = styles[0] as Style;
    for (const s of styles.slice(1)) out = out.add(s);
    return out;
  }
}

export type StyleType = string | Style;

const themeCache = new Map<string, Style>();

/** `Console.get_style(name)` against the default theme. */
export function getStyle(name: StyleType, dflt?: StyleType): Style {
  if (name instanceof Style) return name;
  const cached = themeCache.get(name);
  if (cached) return cached;
  try {
    const def = DEFAULT_STYLES[name];
    const style = def !== undefined ? Style.parse(def) : Style.parse(name);
    themeCache.set(name, style);
    return style;
  } catch (e) {
    if (e instanceof StyleSyntaxError) {
      if (dflt !== undefined) return getStyle(dflt);
      throw new MissingStyle(`Failed to get style ${pyReprStr(name)}; ${e.message}`);
    }
    throw e;
  }
}

const truthyStyle = (s: StyleType | null | undefined): boolean => (s instanceof Style ? !s.isNull : Boolean(s));

// ---------------------------------------------------------------------------------------------------------------------
// segments
// ---------------------------------------------------------------------------------------------------------------------

export interface Segment {
  text: string;
  style: Style | null;
  control: boolean;
}

const seg = (text: string, style: Style | null = null, control = false): Segment => ({ text, style, control });
const NEWLINE = (): Segment => seg("\n");
const segLen = (s: Segment): number => (s.control ? 0 : cellLen(s.text));
const styleTruthy = (s: Style | null): s is Style => s !== null && !s.isNull;

function applyStyle(segments: Segment[], style: Style | null): Segment[] {
  if (!styleTruthy(style)) return segments;
  return segments.map((s) => seg(s.text, s.control ? null : style.add(s.style), s.control));
}

function adjustLineLength(line: Segment[], length: number, style: Style | null, pad: boolean): Segment[] {
  let lineLength = 0;
  for (const s of line) lineLength += segLen(s);
  if (lineLength < length) return pad ? [...line, seg(" ".repeat(length - lineLength), style)] : [...line];
  if (lineLength > length) {
    const out: Segment[] = [];
    lineLength = 0;
    for (const s of line) {
      const l = segLen(s);
      if (lineLength + l < length || s.control) {
        out.push(s);
        lineLength += l;
      } else {
        out.push(seg(setCellSize(s.text, length - lineLength), s.style));
        break;
      }
    }
    return out;
  }
  return [...line];
}

function splitAndCropLines(segments: Segment[], length: number, style: Style | null, pad: boolean, includeNewLines: boolean): Segment[][] {
  const result: Segment[][] = [];
  let line: Segment[] = [];
  for (const s of segments) {
    if (s.text.includes("\n") && !s.control) {
      let text = s.text;
      while (text) {
        const idx = text.indexOf("\n");
        const part = idx < 0 ? text : text.slice(0, idx);
        const hasNl = idx >= 0;
        text = idx < 0 ? "" : text.slice(idx + 1);
        if (part) line.push(seg(part, s.style));
        if (hasNl) {
          const cropped = adjustLineLength(line, length, style, pad);
          if (includeNewLines) cropped.push(NEWLINE());
          result.push(cropped);
          line = [];
        }
      }
    } else line.push(s);
  }
  if (line.length) result.push(adjustLineLength(line, length, style, pad));
  return result;
}

const lineWidth = (line: Segment[]): number => line.reduce((n, s) => n + (s.control ? 0 : cellLen(s.text)), 0);

function setShape(lines: Segment[][], width: number, height: number | null): Segment[][] {
  const h = height || lines.length;
  const shaped = lines.map((l) => adjustLineLength(l, width, null, true));
  const out = shaped.slice(0, h);
  while (out.length < h) out.push([seg(" ".repeat(width), null)]);
  return out;
}

function alignVertical(lines: Segment[][], width: number, height: number, style: Style, how: "top" | "bottom"): Segment[][] {
  const extra = height - lines.length;
  if (!extra) return [...lines];
  const kept = lines.slice(0, height);
  const blank = seg(" ".repeat(width), style);
  const pad = Array.from({ length: extra }, () => [blank]);
  return how === "top" ? [...kept, ...pad] : [...pad, ...kept];
}

// ---------------------------------------------------------------------------------------------------------------------
// text + markup
// ---------------------------------------------------------------------------------------------------------------------

export interface Span {
  start: number;
  end: number;
  style: StyleType;
}

type Justify = "default" | "left" | "center" | "right" | "full";
type Overflow = "fold" | "crop" | "ellipsis" | "ignore";

const CONTROL_STRIP = /[\x07\x08\x0b\x0c\x0d]/g;
const stripControlCodes = (s: string): string => s.replace(CONTROL_STRIP, "");

export class Text {
  cps: string[];
  spans: Span[];

  constructor(
    text = "",
    public style: StyleType = "",
    public opts: { justify?: Justify | null; overflow?: Overflow | null; no_wrap?: boolean | null; end?: string; tab_size?: number | null; spans?: Span[] } = {},
  ) {
    this.cps = cps(stripControlCodes(text));
    this.spans = opts.spans ?? [];
  }

  get justify(): Justify | null {
    return this.opts.justify ?? null;
  }
  set justify(v: Justify | null) {
    this.opts.justify = v;
  }
  get overflow(): Overflow | null {
    return this.opts.overflow ?? null;
  }
  set overflow(v: Overflow | null) {
    this.opts.overflow = v;
  }
  get end(): string {
    return this.opts.end ?? "\n";
  }

  get plain(): string {
    return this.cps.join("");
  }
  set plain(value: string) {
    const next = cps(stripControlCodes(value));
    if (next.length < this.cps.length) {
      this.cps = next;
      this.trimSpans();
    } else this.cps = next;
  }
  get length(): number {
    return this.cps.length;
  }

  private trimSpans(): void {
    const maxOffset = this.cps.length;
    this.spans = this.spans
      .filter((s) => s.start < maxOffset)
      .map((s) => (s.end < maxOffset ? s : { start: s.start, end: Math.min(maxOffset, s.end), style: s.style }));
  }

  static assemble(parts: Array<string | Text | [string, StyleType]>, opts: Text["opts"] & { style?: StyleType } = {}): Text {
    const text = new Text("", opts.style ?? "", { ...opts, tab_size: opts.tab_size ?? 8 });
    for (const part of parts) {
      if (typeof part === "string" || part instanceof Text) text.append(part);
      else text.append(part[0], part[1]);
    }
    return text;
  }

  append(text: string | Text, style?: StyleType | null): this {
    if (typeof text === "string") {
      const sanitized = cps(stripControlCodes(text));
      if (sanitized.length) {
        const offset = this.cps.length;
        this.cps.push(...sanitized);
        if (truthyStyle(style)) this.spans.push({ start: offset, end: offset + sanitized.length, style: style as StyleType });
      }
    } else if (text.length) {
      if (style !== undefined && style !== null) throw new Error("style must not be set when appending Text instance");
      const base = this.cps.length;
      if (truthyStyle(text.style)) this.spans.push({ start: base, end: base + text.length, style: text.style });
      this.cps.push(...text.cps);
      for (const s of text.spans) this.spans.push({ start: s.start + base, end: s.end + base, style: s.style });
    }
    return this;
  }

  copy(): Text {
    return new Text(this.plain, this.style, { ...this.opts, spans: this.spans.map((s) => ({ ...s })) });
  }

  blankCopy(plain = ""): Text {
    return new Text(plain, this.style, { justify: this.justify, overflow: this.overflow, no_wrap: this.opts.no_wrap, end: this.end, tab_size: this.opts.tab_size });
  }

  rstripEnd(size: number): void {
    const length = this.length;
    if (length > size) {
      const excess = length - size;
      const m = RE_TRAILING_WS.exec(this.plain);
      if (m) this.rightCrop(Math.min(cpLen(m[0]), excess));
    }
  }

  rstrip(): void {
    this.plain = this.plain.replace(new RegExp(`${WS}+$`, "u"), "");
  }

  rightCrop(amount = 1): void {
    const maxOffset = this.cps.length - amount;
    this.spans = this.spans
      .filter((s) => s.start < maxOffset)
      .map((s) => (s.end < maxOffset ? s : { start: s.start, end: Math.min(maxOffset, s.end), style: s.style }));
    this.cps = this.cps.slice(0, this.cps.length - amount);
  }

  padLeft(count: number, ch = " "): void {
    if (count > 0) {
      this.cps = [...Array<string>(count).fill(ch), ...this.cps];
      this.spans = this.spans.map((s) => ({ start: s.start + count, end: s.end + count, style: s.style }));
    }
  }

  padRight(count: number, ch = " "): void {
    if (count > 0) this.cps.push(...Array<string>(count).fill(ch));
  }

  truncate(maxWidth: number, opts: { overflow?: Overflow | null; pad?: boolean } = {}): void {
    const overflow = opts.overflow || this.overflow || "fold";
    if (overflow !== "ignore") {
      const plain = this.plain;
      const length = cellLen(plain);
      if (length > maxWidth) {
        this.plain = overflow === "ellipsis" ? `${setCellSize(plain, maxWidth - 1)}…` : setCellSize(plain, maxWidth);
      }
      if (opts.pad && length < maxWidth) {
        this.cps = cps(`${this.plain}${" ".repeat(maxWidth - length)}`);
      }
    }
  }

  expandTabs(tabSize = 8): void {
    if (!this.plain.includes("\t")) return;
    const pieces: Text[] = [];
    for (const line of this.split("\n", true, false)) {
      if (!line.plain.includes("\t")) pieces.push(line);
      else {
        let cellPosition = 0;
        for (const part of line.split("\t", true, false)) {
          if (part.plain.endsWith("\t")) {
            part.cps[part.cps.length - 1] = " ";
            cellPosition += cellLen(part.plain);
            const rem = cellPosition % tabSize;
            if (rem) {
              const spaces = tabSize - rem;
              if (part.spans.length) {
                // `extend_style`: widen the spans touching the end, then pad.
                const end = part.length;
                part.spans = part.spans.map((s) => (s.end >= end ? { ...s, end: s.end + spaces } : s));
              }
              part.cps.push(...Array<string>(spaces).fill(" "));
              cellPosition += spaces;
            }
          } else cellPosition += cellLen(part.plain);
          pieces.push(part);
        }
      }
    }
    const result = new Text("").join(pieces);
    this.cps = result.cps;
    this.spans = result.spans;
  }

  join(lines: Text[]): Text {
    const out = this.blankCopy();
    let offset = 0;
    const iter: Text[] = [];
    if (this.plain) {
      lines.forEach((l, i) => {
        iter.push(l);
        if (i < lines.length - 1) iter.push(this);
      });
    } else iter.push(...lines);
    for (const t of iter) {
      out.cps.push(...t.cps);
      if (truthyStyle(t.style)) out.spans.push({ start: offset, end: offset + t.length, style: t.style });
      for (const s of t.spans) out.spans.push({ start: offset + s.start, end: offset + s.end, style: s.style });
      offset += t.length;
    }
    return out;
  }

  divide(offsets: number[]): Text[] {
    if (!offsets.length) return [this.copy()];
    const length = this.cps.length;
    const bounds = [0, ...offsets, length];
    const ranges: Array<[number, number]> = [];
    for (let i = 0; i < bounds.length - 1; i++) ranges.push([bounds[i] as number, bounds[i + 1] as number]);
    const lines = ranges.map(([a, b]) => {
      const t = new Text("", this.style, { justify: this.justify, overflow: this.overflow });
      t.cps = this.cps.slice(a, b);
      return t;
    });
    if (!this.spans.length) return lines;
    const lineCount = ranges.length;
    for (const { start: spanStart, end: spanEnd, style } of this.spans) {
      let lower = 0;
      let upper = lineCount;
      let startLine = Math.floor((lower + upper) / 2);
      let lineStart = 0;
      let lineEnd = 0;
      for (;;) {
        [lineStart, lineEnd] = ranges[startLine] as [number, number];
        if (spanStart < lineStart) upper = startLine - 1;
        else if (spanStart > lineEnd) lower = startLine + 1;
        else break;
        startLine = Math.floor((lower + upper) / 2);
      }
      let endLine: number;
      if (spanEnd < lineEnd) endLine = startLine;
      else {
        endLine = lower = startLine;
        upper = lineCount;
        for (;;) {
          [lineStart, lineEnd] = ranges[endLine] as [number, number];
          if (spanEnd < lineStart) upper = endLine - 1;
          else if (spanEnd > lineEnd) lower = endLine + 1;
          else break;
          endLine = Math.floor((lower + upper) / 2);
        }
      }
      for (let n = startLine; n <= endLine; n++) {
        const [ls, le] = ranges[n] as [number, number];
        const newStart = Math.max(0, spanStart - ls);
        const newEnd = Math.min(spanEnd - ls, le - ls);
        if (newEnd > newStart) (lines[n] as Text).spans.push({ start: newStart, end: newEnd, style });
      }
    }
    return lines;
  }

  split(separator = "\n", includeSeparator = false, allowBlank = false): Text[] {
    const text = this.plain;
    if (!text.includes(separator)) return [this.copy()];
    const sepLen = cpLen(separator);
    const found: Array<[number, number]> = [];
    const chars = this.cps;
    for (let i = 0; i + sepLen <= chars.length; ) {
      if (chars.slice(i, i + sepLen).join("") === separator) {
        found.push([i, i + sepLen]);
        i += sepLen;
      } else i++;
    }
    let lines: Text[];
    if (includeSeparator) lines = this.divide(found.map((f) => f[1]));
    else lines = this.divide(found.flatMap((f) => f)).filter((l) => l.plain !== separator);
    if (!allowBlank && text.endsWith(separator)) lines.pop();
    return lines;
  }

  wrap(width: number, opts: { justify?: Justify | null; overflow?: Overflow | null; tab_size?: number; no_wrap?: boolean | null }): Text[] {
    const wrapJustify = opts.justify || this.justify || "default";
    const wrapOverflow = opts.overflow || this.overflow || "fold";
    const noWrap = pickBool(opts.no_wrap, this.opts.no_wrap, false) || opts.overflow === "ignore";
    const lines: Text[] = [];
    for (const line of this.split("\n", false, true)) {
      if (line.plain.includes("\t")) line.expandTabs(opts.tab_size ?? 8);
      let newLines: Text[];
      if (noWrap) {
        if (opts.overflow === "ignore") {
          lines.push(line);
          continue;
        }
        newLines = [line];
      } else {
        const offsets = divideLine(line.plain, width, wrapOverflow === "fold");
        newLines = line.divide(offsets);
        for (const l of newLines) l.rstripEnd(width);
      }
      if (wrapJustify) justifyLines(newLines, width, wrapJustify, wrapOverflow);
      for (const l of newLines) l.truncate(width, { overflow: wrapOverflow });
      lines.push(...newLines);
    }
    return lines;
  }

  richMeasure(): Measurement {
    return this.measure();
  }

  measure(): Measurement {
    const plain = this.plain;
    const lines = splitlines(plain);
    const maxText = lines.length ? Math.max(...lines.map(cellLen)) : 0;
    const words = splitWhitespace(plain);
    const minText = words.length ? Math.max(...words.map(cellLen)) : maxText;
    return new Measurement(minText, maxText);
  }

  richConsole(console: Console, options: ConsoleOptions): Segment[] {
    const tabSize = this.opts.tab_size ?? console.tab_size;
    const justify = this.justify || options.justify || "default";
    const overflow = this.overflow || options.overflow || "fold";
    const lines = this.wrap(options.max_width, {
      justify,
      overflow,
      tab_size: tabSize || 8,
      no_wrap: pickBool(this.opts.no_wrap, options.no_wrap, false),
    });
    return new Text("\n").join(lines).render(this.end);
  }

  render(end = ""): Segment[] {
    const text = this.plain;
    const out: Segment[] = [];
    if (!this.spans.length) {
      out.push(seg(text));
      if (end) out.push(seg(end));
      return out;
    }
    const dflt = Style.NULL;
    const styleMap = new Map<number, Style>();
    this.spans.forEach((s, i) => styleMap.set(i + 1, getStyle(s.style, dflt)));
    styleMap.set(0, getStyle(this.style, dflt));
    const bounds: Array<[number, boolean, number]> = [[0, false, 0]];
    this.spans.forEach((s, i) => bounds.push([s.start, false, i + 1]));
    this.spans.forEach((s, i) => bounds.push([s.end, true, i + 1]));
    bounds.push([this.cps.length, true, 0]);
    bounds.sort((a, b) => a[0] - b[0] || Number(a[1]) - Number(b[1]));
    const stack: number[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const [offset, leaving, id] = bounds[i] as [number, boolean, number];
      const next = (bounds[i + 1] as [number, boolean, number])[0];
      if (leaving) {
        const at = stack.indexOf(id);
        if (at >= 0) stack.splice(at, 1);
      } else stack.push(id);
      if (next > offset) {
        const styles = [...stack].sort((a, b) => a - b).map((n) => styleMap.get(n) as Style);
        out.push(seg(this.cps.slice(offset, next).join(""), Style.combine(styles)));
      }
    }
    void text;
    if (end) out.push(seg(end));
    return out;
  }
}

function divideLine(text: string, width: number, fold: boolean): number[] {
  const breaks: number[] = [];
  let cellOffset = 0;
  const chars = cps(text);
  let cpPos = 0;
  RE_WORD.lastIndex = 0;
  // Walk words by code-point position; the sticky regex works on UTF-16, so keep both in step.
  let utf16Pos = 0;
  for (;;) {
    RE_WORD.lastIndex = utf16Pos;
    const m = RE_WORD.exec(text);
    if (!m) break;
    const word = m[0];
    let start = cpPos;
    const wordCp = cpLen(word);
    const wordLength = cellLen(word.replace(new RegExp(`${WS}+$`, "u"), ""));
    const remaining = width - cellOffset;
    if (remaining >= wordLength) cellOffset += cellLen(word);
    else if (wordLength > width) {
      if (fold) {
        const folded = chopCells(word, width);
        folded.forEach((line, idx) => {
          const last = idx === folded.length - 1;
          if (start) breaks.push(start);
          if (last) cellOffset = cellLen(line);
          else start += cpLen(line);
        });
      } else {
        if (start) breaks.push(start);
        cellOffset = cellLen(word);
      }
    } else if (cellOffset && start) {
      breaks.push(start);
      cellOffset = cellLen(word);
    }
    cpPos += wordCp;
    utf16Pos += word.length;
  }
  void chars;
  return breaks;
}

function justifyLines(lines: Text[], width: number, justify: Justify, overflow: Overflow): void {
  if (justify === "left") for (const l of lines) l.truncate(width, { overflow, pad: true });
  else if (justify === "center")
    for (const l of lines) {
      l.rstrip();
      l.truncate(width, { overflow });
      l.padLeft(Math.floor((width - cellLen(l.plain)) / 2));
      l.padRight(width - cellLen(l.plain));
    }
  else if (justify === "right")
    for (const l of lines) {
      l.rstrip();
      l.truncate(width, { overflow });
      l.padLeft(width - cellLen(l.plain));
    }
}

// markup -------------------------------------------------------------------------------------------------------------

const EMOJI_RE = /(:(\S*?)(?:(?:-)(emoji|text))?:)/g;
function emojiReplace(text: string, defaultVariant: string | null = null): string {
  const variants: Record<string, string> = { text: "\ufe0e", emoji: "\ufe0f" };
  const dflt = defaultVariant ? (variants[defaultVariant] ?? "") : "";
  return text.replace(EMOJI_RE, (full, _all: string, name: string, variant: string | undefined) => {
    const e = Object.prototype.hasOwnProperty.call(EMOJI, name.toLowerCase()) ? EMOJI[name.toLowerCase()] : undefined;
    if (e === undefined) return full;
    return e + (variant ? (variants[variant] ?? dflt) : dflt);
  });
}

interface Tag {
  name: string;
  parameters: string | null;
}
const tagStr = (t: Tag): string => (t.parameters === null ? t.name : `${t.name} ${t.parameters}`);
const tagMarkup = (t: Tag): string => (t.parameters === null ? `[${t.name}]` : `[${t.name}=${t.parameters}]`);

function* parseMarkup(markup: string): Generator<[number, string | null, Tag | null]> {
  const re = /((\\*)\[([a-z#/@][^[]*?)])/g;
  let position = 0;
  const chars = cps(markup);
  const cpIndex = (utf16: number): number => cpLen(markup.slice(0, utf16));
  void chars;
  for (const match of markup.matchAll(re)) {
    const full = match[1] as string;
    const escapes = match[2] as string;
    const tagText = match[3] as string;
    let start = match.index as number;
    const end = start + full.length;
    if (start > position) yield [cpIndex(start), markup.slice(position, start), null];
    if (escapes) {
      const backslashes = Math.floor(escapes.length / 2);
      const escaped = escapes.length % 2;
      if (backslashes) {
        yield [cpIndex(start), "\\".repeat(backslashes), null];
        start += backslashes * 2;
      }
      if (escaped) {
        yield [cpIndex(start), full.slice(escapes.length), null];
        position = end;
        continue;
      }
    }
    const eq = tagText.indexOf("=");
    const tag: Tag = eq < 0 ? { name: tagText, parameters: null } : { name: tagText.slice(0, eq), parameters: tagText.slice(eq + 1) };
    yield [cpIndex(start), null, tag];
    position = end;
  }
  if (position < markup.length) yield [cpIndex(position), markup.slice(position), null];
}

export function renderMarkup(markup: string, style: StyleType = "", emoji = true): Text {
  if (!markup.includes("[")) return new Text(emoji ? emojiReplace(markup) : markup, style);
  const text = new Text("", style);
  const stack: Array<[number, Tag]> = [];
  const spans: Span[] = [];
  const popStyle = (name: string): [number, Tag] => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if ((stack[i] as [number, Tag])[1].name === name) return stack.splice(i, 1)[0] as [number, Tag];
    }
    throw new KeyError(name);
  };
  for (const [position, plain, tag] of parseMarkup(markup)) {
    if (plain !== null) {
      const p = plain.replace(/\\\[/g, "[");
      text.append(emoji ? emojiReplace(p) : p);
    } else if (tag !== null) {
      if (tag.name.startsWith("/")) {
        let styleName = tag.name.slice(1).trim();
        let start: number;
        let open: Tag;
        if (styleName) {
          styleName = Style.normalize(styleName);
          try {
            [start, open] = popStyle(styleName);
          } catch (e) {
            if (e instanceof KeyError) throw new MarkupError(`closing tag '${tagMarkup(tag)}' at position ${position} doesn't match any open tag`);
            throw e;
          }
        } else {
          const top = stack.pop();
          if (!top) throw new MarkupError(`closing tag '[/]' at position ${position} has nothing to close`);
          [start, open] = top;
        }
        if (open.name.startsWith("@")) {
          // Meta handlers carry no output; Rich parses their parameters (and can raise) - see KNOWN-GAPS.md.
        } else spans.push({ start, end: text.length, style: tagStr(open) });
      } else stack.push([text.length, { name: Style.normalize(tag.name), parameters: tag.parameters }]);
    }
  }
  const textLength = text.length;
  while (stack.length) {
    const [start, tag] = stack.pop() as [number, Tag];
    const s = tagStr(tag);
    if (s) spans.push({ start, end: textLength, style: s });
  }
  text.spans = spans
    .reverse()
    .map((s, i) => [s, i] as const)
    .sort((a, b) => a[0].start - b[0].start || a[1] - b[1])
    .map((x) => x[0]);
  return text;
}

class KeyError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// measurement / options / renderables
// ---------------------------------------------------------------------------------------------------------------------

export class Measurement {
  constructor(
    readonly minimum: number,
    readonly maximum: number,
  ) {}

  normalize(): Measurement {
    const min = Math.min(Math.max(0, this.minimum), this.maximum);
    return new Measurement(Math.max(0, min), Math.max(0, Math.max(min, this.maximum)));
  }
  withMaximum(width: number): Measurement {
    return new Measurement(Math.min(this.minimum, width), Math.min(this.maximum, width));
  }
  withMinimum(width: number): Measurement {
    const w = Math.max(0, width);
    return new Measurement(Math.max(this.minimum, w), Math.max(this.maximum, w));
  }
  clamp(minWidth: number | null = null, maxWidth: number | null = null): Measurement {
    let m: Measurement = this;
    if (minWidth !== null) m = m.withMinimum(minWidth);
    if (maxWidth !== null) m = m.withMaximum(maxWidth);
    return m;
  }

  static get(console: Console, options: ConsoleOptions, renderable: Renderable | string): Measurement {
    const maxWidth = options.max_width;
    if (maxWidth < 1) return new Measurement(0, 0);
    let r: Renderable;
    if (typeof renderable === "string") r = console.renderStr(renderable, { markup: options.markup, highlight: false });
    else r = renderable;
    if (r.richMeasure) {
      const w = r.richMeasure(console, options).normalize().withMaximum(maxWidth);
      if (w.maximum < 1) return new Measurement(0, 0);
      return w.normalize();
    }
    return new Measurement(0, maxWidth);
  }
}

export interface ConsoleOptions {
  size: { width: number; height: number };
  min_width: number;
  max_width: number;
  is_terminal: boolean;
  encoding: string;
  max_height: number;
  justify: Justify | null;
  overflow: Overflow | null;
  no_wrap: boolean | null;
  highlight: boolean | null;
  markup: boolean | null;
  height: number | null;
}

const NO_CHANGE = Symbol("NO_CHANGE");
type Opt<T> = T | typeof NO_CHANGE;

function updateOptions(
  o: ConsoleOptions,
  u: { width?: Opt<number>; justify?: Opt<Justify | null>; overflow?: Opt<Overflow | null>; no_wrap?: Opt<boolean | null>; highlight?: Opt<boolean | null>; height?: Opt<number | null> },
): ConsoleOptions {
  const n = { ...o };
  if (u.width !== undefined && u.width !== NO_CHANGE) n.min_width = n.max_width = Math.max(0, u.width);
  if (u.justify !== undefined && u.justify !== NO_CHANGE) n.justify = u.justify;
  if (u.overflow !== undefined && u.overflow !== NO_CHANGE) n.overflow = u.overflow;
  if (u.no_wrap !== undefined && u.no_wrap !== NO_CHANGE) n.no_wrap = u.no_wrap;
  if (u.highlight !== undefined && u.highlight !== NO_CHANGE) n.highlight = u.highlight;
  if (u.height !== undefined && u.height !== NO_CHANGE) {
    if (u.height !== null) n.max_height = u.height;
    n.height = u.height === null ? null : Math.max(0, u.height);
  }
  return n;
}
const updateWidth = (o: ConsoleOptions, width: number): ConsoleOptions => ({ ...o, min_width: Math.max(0, width), max_width: Math.max(0, width) });
const asciiOnly = (o: ConsoleOptions): boolean => !o.encoding.startsWith("utf");

export interface Renderable {
  richConsole(console: Console, options: ConsoleOptions): Segment[];
  richMeasure?(console: Console, options: ConsoleOptions): Measurement;
}

class Control implements Renderable {
  readonly segment: Segment;
  constructor(text = "") {
    this.segment = seg(text, null, true);
  }
  richConsole(): Segment[] {
    return this.segment.text ? [this.segment] : [];
  }
  static showCursor(show: boolean): Control {
    return new Control(show ? "\x1b[?25h" : "\x1b[?25l");
  }
}

// padding -------------------------------------------------------------------------------------------------------------

class Padding implements Renderable {
  constructor(
    readonly renderable: Renderable | string,
    readonly top: number,
    readonly right: number,
    readonly bottom: number,
    readonly left: number,
    readonly expand = true,
  ) {}

  richConsole(console: Console, options: ConsoleOptions): Segment[] {
    const style = Style.NULL;
    const width = this.expand ? options.max_width : Math.min(Measurement.get(console, options, this.renderable).maximum + this.left + this.right, options.max_width);
    let renderOptions = updateWidth(options, width - this.left - this.right);
    if (renderOptions.height !== null) renderOptions = { ...renderOptions, max_height: renderOptions.height - this.top - this.bottom, height: renderOptions.height - this.top - this.bottom };
    const lines = console.renderLines(this.renderable, renderOptions, { style, pad: true });
    const out: Segment[] = [];
    const left = this.left ? seg(" ".repeat(this.left), style) : null;
    const right = this.right ? [seg(" ".repeat(this.right), style), NEWLINE()] : [NEWLINE()];
    const blank = (): Segment => seg(`${" ".repeat(width)}\n`, style);
    for (let i = 0; i < this.top; i++) out.push(blank());
    for (const line of lines) {
      if (left) out.push(left);
      out.push(...line, ...right);
    }
    for (let i = 0; i < this.bottom; i++) out.push(blank());
    return out;
  }

  richMeasure(console: Console, options: ConsoleOptions): Measurement {
    const maxWidth = options.max_width;
    const extra = this.left + this.right;
    if (maxWidth - extra < 1) return new Measurement(maxWidth, maxWidth);
    const m = Measurement.get(console, options, this.renderable);
    return new Measurement(m.minimum + extra, m.maximum + extra).withMaximum(maxWidth);
  }
}

// box ----------------------------------------------------------------------------------------------------------------

class Box {
  readonly rows: string[][];
  constructor(
    box: string,
    readonly ascii = false,
  ) {
    this.rows = box.split("\n").filter((l) => l !== "").map((l) => cps(l));
  }
  getTop(widths: number[]): string {
    return this.line(0, widths, true);
  }
  getBottom(widths: number[]): string {
    return this.line(7, widths, true);
  }
  getRow(widths: number[], level: "head" | "row" | "foot" | "mid", edge = true): string {
    const idx = { head: 2, row: 4, foot: 5, mid: 3 }[level];
    const r = this.rows[idx] as string[];
    const [left, horizontal0, cross, right] = r as [string, string, string, string];
    const horizontal = level === "mid" ? " " : horizontal0;
    let out = edge ? left : "";
    widths.forEach((w, i) => {
      out += horizontal.repeat(w);
      if (i < widths.length - 1) out += cross;
    });
    return out + (edge ? right : "");
  }
  private line(idx: number, widths: number[], _edge: boolean): string {
    const [l, h, d, r] = this.rows[idx] as [string, string, string, string];
    let out = l;
    widths.forEach((w, i) => {
      out += h.repeat(w);
      if (i < widths.length - 1) out += d;
    });
    return out + r;
  }
  cell(row: number, col: 0 | 1 | 2 | 3): string {
    return (this.rows[row] as string[])[col] as string;
  }
  substitute(options: ConsoleOptions): Box {
    return asciiOnly(options) && !this.ascii ? ASCII_BOX : this;
  }
  getPlainHeadedBox(): Box {
    return this === HEAVY_HEAD ? SIMPLE_PLAIN_FOR_HEAVY_HEAD : this;
  }
}

export const HEAVY_HEAD = new Box("┏━┳┓\n┃ ┃┃\n┡━╇┩\n│ ││\n├─┼┤\n├─┼┤\n│ ││\n└─┴┘\n");
const ASCII_BOX = new Box("+--+\n| ||\n|-+|\n| ||\n|-+|\n|-+|\n| ||\n+--+\n", true);
const SIMPLE_PLAIN_FOR_HEAVY_HEAD = new Box("┌─┬┐\n│ ││\n├─┼┤\n│ ││\n├─┼┤\n├─┼┤\n│ ││\n└─┴┘\n");

// table --------------------------------------------------------------------------------------------------------------

export interface ColumnOptions {
  header_style?: StyleType | null;
  style?: StyleType | null;
  justify?: Justify;
  overflow?: Overflow;
  width?: number | null;
  min_width?: number | null;
  max_width?: number | null;
  no_wrap?: boolean;
  highlight?: boolean | null;
}

interface Column {
  index: number;
  header: string;
  header_style: StyleType;
  style: StyleType;
  justify: Justify;
  overflow: Overflow;
  width: number | null;
  min_width: number | null;
  max_width: number | null;
  no_wrap: boolean;
  highlight: boolean;
  cells: string[];
}

interface TableCell {
  style: Style;
  renderable: Padding | string;
}

function ratioReduce(total: number, ratios: number[], maximums: number[], values: number[]): number[] {
  const r = ratios.map((ratio, i) => ((maximums[i] as number) ? ratio : 0));
  let totalRatio = r.reduce((a, b) => a + b, 0);
  if (!totalRatio) return [...values];
  let remaining = total;
  const out: number[] = [];
  r.forEach((ratio, i) => {
    if (ratio && totalRatio > 0) {
      const distributed = Math.min(maximums[i] as number, pyRound((ratio * remaining) / totalRatio));
      out.push((values[i] as number) - distributed);
      remaining -= distributed;
      totalRatio -= ratio;
    } else out.push(values[i] as number);
  });
  return out;
}

export class Table implements Renderable {
  columns: Column[] = [];
  rows: Array<{ end_section: boolean }> = [];
  readonly box: Box | null;
  readonly padding: [number, number, number, number];
  readonly pad_edge = true;
  readonly show_header = true;
  readonly show_edge = true;
  readonly show_lines = false;
  readonly leading = 0;
  readonly highlight = false;
  readonly header_style: StyleType = "table.header";

  constructor() {
    this.box = HEAVY_HEAD;
    this.padding = [0, 1, 0, 1];
  }

  addColumn(header = "", opts: ColumnOptions = {}): void {
    this.columns.push({
      index: this.columns.length,
      header,
      header_style: opts.header_style || "",
      style: opts.style || "",
      justify: opts.justify ?? "left",
      overflow: opts.overflow ?? "ellipsis",
      width: opts.width ?? null,
      min_width: opts.min_width ?? null,
      max_width: opts.max_width ?? null,
      no_wrap: opts.no_wrap ?? false,
      highlight: opts.highlight ?? this.highlight,
      cells: [],
    });
  }

  addRow(...cells: Array<string | null>): void {
    const list = [...cells];
    while (list.length < this.columns.length) list.push(null);
    list.forEach((cell, index) => {
      let column = this.columns[index];
      if (!column) {
        this.addColumn("");
        column = this.columns[index] as Column;
        for (let i = 0; i < this.rows.length; i++) column.cells.push("");
      }
      column.cells.push(cell === null ? "" : cell);
    });
    this.rows.push({ end_section: false });
  }

  private get extraWidth(): number {
    let w = 0;
    if (this.box && this.show_edge) w += 2;
    if (this.box) w += this.columns.length - 1;
    return w;
  }

  private paddingWidth(): number {
    return this.padding[1] + this.padding[3];
  }

  private getCells(column: Column): TableCell[] {
    const [top, right, bottom, left] = this.padding;
    const raw: Array<[Style, string]> = [];
    if (this.show_header) raw.push([getStyle(this.header_style || "").add(getStyle(column.header_style)), column.header]);
    const cellStyle = getStyle(column.style || "");
    for (const c of column.cells) raw.push([cellStyle, c]);
    return raw.map(([style, renderable]) => ({ style, renderable: new Padding(renderable, top, right, bottom, left) }));
  }

  private measureColumn(console: Console, options: ConsoleOptions, column: Column): Measurement {
    const maxWidth = options.max_width;
    if (maxWidth < 1) return new Measurement(0, 0);
    const pw = this.paddingWidth();
    if (column.width !== null) return new Measurement(column.width + pw, column.width + pw).withMaximum(maxWidth);
    const mins: number[] = [];
    const maxs: number[] = [];
    for (const cell of this.getCells(column)) {
      const m = Measurement.get(console, options, cell.renderable);
      mins.push(m.minimum);
      maxs.push(m.maximum);
    }
    let m = new Measurement(mins.length ? Math.max(...mins) : 1, maxs.length ? Math.max(...maxs) : maxWidth).withMaximum(maxWidth);
    m = m.clamp(column.min_width === null ? null : column.min_width + pw, column.max_width === null ? null : column.max_width + pw);
    return m;
  }

  private static collapseWidths(widths0: number[], wrapable: boolean[], maxWidth: number): number[] {
    let widths = widths0;
    let total = widths.reduce((a, b) => a + b, 0);
    let excess = total - maxWidth;
    if (wrapable.some(Boolean)) {
      while (total && excess > 0) {
        const maxColumn = Math.max(...widths.filter((_, i) => wrapable[i]));
        const second = Math.max(...widths.map((w, i) => (wrapable[i] && w !== maxColumn ? w : 0)));
        const diff = maxColumn - second;
        const ratios = widths.map((w, i) => (w === maxColumn && wrapable[i] ? 1 : 0));
        if (!ratios.some(Boolean) || !diff) break;
        const maxReduce = widths.map(() => Math.min(excess, diff));
        widths = ratioReduce(excess, ratios, maxReduce, widths);
        total = widths.reduce((a, b) => a + b, 0);
        excess = total - maxWidth;
      }
    }
    return widths;
  }

  private calculateColumnWidths(console: Console, options: ConsoleOptions): number[] {
    const maxWidth = options.max_width;
    const ranges = this.columns.map((c) => this.measureColumn(console, options, c));
    let widths = ranges.map((r) => r.maximum || 1);
    let tableWidth = widths.reduce((a, b) => a + b, 0);
    if (tableWidth > maxWidth) {
      widths = Table.collapseWidths(
        widths,
        this.columns.map((c) => c.width === null && !c.no_wrap),
        maxWidth,
      );
      tableWidth = widths.reduce((a, b) => a + b, 0);
      if (tableWidth > maxWidth) {
        const excess = tableWidth - maxWidth;
        widths = ratioReduce(excess, widths.map(() => 1), widths, widths);
        tableWidth = widths.reduce((a, b) => a + b, 0);
      }
      const remeasured = this.columns.map((c, i) => this.measureColumn(console, updateWidth(options, widths[i] as number), c));
      widths = remeasured.map((r) => r.maximum || 0);
    }
    return widths;
  }

  richMeasure(console: Console, options: ConsoleOptions): Measurement {
    const maxWidth0 = options.max_width;
    if (maxWidth0 < 0) return new Measurement(0, 0);
    const extra = this.extraWidth;
    const maxWidth = this.calculateColumnWidths(console, updateWidth(options, maxWidth0 - extra)).reduce((a, b) => a + b, 0);
    const measurements = this.columns.map((c) => this.measureColumn(console, updateWidth(options, maxWidth), c));
    return new Measurement(
      measurements.reduce((a, m) => a + m.minimum, 0) + extra,
      measurements.reduce((a, m) => a + m.maximum, 0) + extra,
    );
  }

  richConsole(console: Console, options: ConsoleOptions): Segment[] {
    if (!this.columns.length) return [seg("\n")];
    const extra = this.extraWidth;
    const widths = this.calculateColumnWidths(console, updateWidth(options, options.max_width - extra));
    const tableWidth = widths.reduce((a, b) => a + b, 0) + extra;
    const renderOptions = updateOptions(options, { width: tableWidth, highlight: this.highlight, height: null });
    return this.renderBody(console, renderOptions, widths);
  }

  private renderBody(console: Console, options: ConsoleOptions, widths: number[]): Segment[] {
    const out: Segment[] = [];
    const tableStyle = getStyle("");
    const borderStyle = tableStyle.add(getStyle(""));
    const columnCells = this.columns.map((c) => this.getCells(c));
    const rowCells: TableCell[][] = [];
    for (let r = 0; r < columnCells[0]!.length; r++) rowCells.push(columnCells.map((cc) => cc[r] as TableCell));
    let box = this.box ? this.box.substitute(options) : null;
    if (box && !this.show_header) box = box.getPlainHeadedBox();
    const newLine = NEWLINE();
    const border = (text: string): Segment => seg(text, borderStyle);
    let boxSegments: Array<[Segment, Segment, Segment]> = [];
    if (box) {
      const triple = (row: number): [Segment, Segment, Segment] => [border(box!.cell(row, 0)), border(box!.cell(row, 3)), border(box!.cell(row, 2))];
      boxSegments = [triple(1), triple(3), triple(6)];
      if (this.show_edge) {
        out.push(border(box.getTop(widths)), newLine);
      }
    }
    rowCells.forEach((rowCell, index) => {
      const first = index === 0;
      const last = index === rowCells.length - 1;
      const headerRow = first && this.show_header;
      const row = !headerRow ? (this.rows[index - (this.show_header ? 1 : 0)] ?? null) : null;
      let maxHeight = 1;
      let cells: Segment[][][] = [];
      const rowStyle = Style.NULL;
      rowCell.forEach((cell, ci) => {
        const column = this.columns[ci] as Column;
        const renderOptions = updateOptions(options, {
          width: widths[ci] as number,
          justify: column.justify,
          no_wrap: column.no_wrap,
          overflow: column.overflow,
          height: null,
          highlight: column.highlight,
        });
        const lines = console.renderLines(cell.renderable, renderOptions, { style: cell.style.add(rowStyle) });
        maxHeight = Math.max(maxHeight, lines.length);
        cells.push(lines);
      });
      const rowHeight = Math.max(...cells.map((c) => c.length));
      cells = cells.map((cell, ci) => {
        const aligned = alignVertical(cell, widths[ci] as number, rowHeight, (rowCell[ci] as TableCell).style.add(rowStyle), headerRow ? "bottom" : "top");
        return setShape(aligned, widths[ci] as number, maxHeight);
      });
      if (box) {
        const [left, right, dividerSeg] = boxSegments[first ? 0 : last ? 2 : 1] as [Segment, Segment, Segment];
        const divider = dividerSeg.text.trim() ? dividerSeg : seg(dividerSeg.text, rowStyle.add(dividerSeg.style));
        for (let lineNo = 0; lineNo < maxHeight; lineNo++) {
          if (this.show_edge) out.push(left);
          cells.forEach((rendered, ci) => {
            out.push(...(rendered[lineNo] as Segment[]));
            if (ci < cells.length - 1) out.push(divider);
          });
          if (this.show_edge) out.push(right);
          out.push(newLine);
        }
      } else {
        for (let lineNo = 0; lineNo < maxHeight; lineNo++) {
          for (const rendered of cells) out.push(...(rendered[lineNo] as Segment[]));
          out.push(newLine);
        }
      }
      if (box && first && this.show_header) out.push(border(box.getRow(widths, "head", this.show_edge)), newLine);
      const endSection = row?.end_section ?? false;
      if (box && (this.show_lines || this.leading || endSection)) {
        if (!last && !(this.show_header && headerRow)) {
          if (this.leading) out.push(border(box.getRow(widths, "mid", this.show_edge).repeat(this.leading)));
          else out.push(border(box.getRow(widths, "row", this.show_edge)));
          out.push(newLine);
        }
      }
    });
    if (box && this.show_edge) out.push(border(box.getBottom(widths)), newLine);
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// console
// ---------------------------------------------------------------------------------------------------------------------

export interface WritableFile {
  write(text: string): unknown;
  flush?(): unknown;
  isatty?(): boolean;
  encoding?: string;
}

export interface ConsoleOptionsInit {
  color_system?: "auto" | "standard" | "256" | "truecolor" | null;
  force_terminal?: boolean | null;
  stderr?: boolean;
  file?: WritableFile | null;
  width?: number | null;
  height?: number | null;
  no_color?: boolean | null;
  markup?: boolean;
  emoji?: boolean;
  highlight?: boolean;
  tab_size?: number;
  environ?: Record<string, string | undefined>;
}

interface RenderHook {
  processRenderables(renderables: Renderable[]): Renderable[];
}

/** Console-wide terminal-size probe; tests override it through {@link richSeams}. */
export const richSeams = {
  terminalSize: (fd: number): [number, number] | null => {
    try {
      const stream = fd === 0 ? process.stdin : fd === 1 ? process.stdout : process.stderr;
      const s = stream as unknown as { isTTY?: boolean; getWindowSize?: () => [number, number] };
      if (s.isTTY && typeof s.getWindowSize === "function") {
        const [w, h] = s.getWindowSize();
        return [w, h];
      }
    } catch {
      /* not a terminal */
    }
    return null;
  },
  monotonic: (): number => performance.now() / 1000,
};

const TERM_COLORS: Record<string, ColorSystem> = { kitty: ColorSystem.EIGHT_BIT, "256color": ColorSystem.EIGHT_BIT, "16color": ColorSystem.STANDARD };

export class Console {
  readonly tab_size: number;
  readonly stderr: boolean;
  no_color: boolean;
  private readonly _file: WritableFile | null;
  private readonly _width: number | null;
  private readonly _height: number | null;
  private readonly _markup: boolean;
  private readonly _emoji: boolean;
  private readonly _highlight: boolean;
  private readonly _force_terminal: boolean | null;
  private readonly env: Record<string, string | undefined>;
  private _colorSystem: ColorSystem | null;
  private buffer: Segment[] = [];
  private bufferIndex = 0;
  private renderHooks: RenderHook[] = [];
  private live: Live | null = null;
  readonly is_interactive: boolean;

  constructor(init: ConsoleOptionsInit = {}) {
    this.env = init.environ ?? process.env;
    this.tab_size = init.tab_size ?? 8;
    this._markup = init.markup ?? true;
    this._emoji = init.emoji ?? true;
    this._highlight = init.highlight ?? true;
    let width = init.width ?? null;
    let height = init.height ?? null;
    if (width === null) {
      const columns = this.env["COLUMNS"];
      if (columns !== undefined && /^\d+$/.test(columns)) width = parseInt(columns, 10);
    }
    if (height === null) {
      const lines = this.env["LINES"];
      if (lines !== undefined && /^\d+$/.test(lines)) height = parseInt(lines, 10);
    }
    this._width = width;
    this._height = height;
    this._force_terminal = init.force_terminal ?? null;
    this._file = init.file ?? null;
    this.stderr = init.stderr ?? false;
    const cs = init.color_system === undefined ? "auto" : init.color_system;
    if (cs === null) this._colorSystem = null;
    else if (cs === "auto") this._colorSystem = this.detectColorSystem();
    else this._colorSystem = cs === "standard" ? ColorSystem.STANDARD : cs === "256" ? ColorSystem.EIGHT_BIT : ColorSystem.TRUECOLOR;
    this.no_color = init.no_color ?? (this.env["NO_COLOR"] ?? "") !== "";
    let forceInteractive: boolean | null = null;
    const ti = this.env["TTY_INTERACTIVE"];
    if (ti === "0") forceInteractive = false;
    else if (ti === "1") forceInteractive = true;
    this.is_interactive = forceInteractive ?? (this.is_terminal && !this.is_dumb_terminal);
  }

  get file(): WritableFile {
    let f: WritableFile = this._file ?? (this.stderr ? pySys.stderr : pySys.stdout);
    const proxied = (f as { rich_proxied_file?: WritableFile }).rich_proxied_file;
    if (proxied) f = proxied;
    return f;
  }

  get encoding(): string {
    return (this.file.encoding ?? "utf-8").toLowerCase();
  }

  get is_terminal(): boolean {
    if (this._force_terminal !== null) return this._force_terminal;
    const tc = this.env["TTY_COMPATIBLE"] ?? "";
    if (tc === "0") return false;
    if (tc === "1") return true;
    const fc = this.env["FORCE_COLOR"];
    if (fc !== undefined) return fc !== "";
    try {
      const f = this.file;
      return typeof f.isatty === "function" ? Boolean(f.isatty()) : false;
    } catch {
      return false;
    }
  }

  get is_dumb_terminal(): boolean {
    const term = (this.env["TERM"] ?? "").toLowerCase();
    return this.is_terminal && (term === "dumb" || term === "unknown");
  }

  get colorSystem(): ColorSystem | null {
    return this._colorSystem;
  }

  private detectColorSystem(): ColorSystem | null {
    if (!this.is_terminal || this.is_dumb_terminal) return null;
    const colorTerm = (this.env["COLORTERM"] ?? "").trim().toLowerCase();
    if (colorTerm === "truecolor" || colorTerm === "24bit") return ColorSystem.TRUECOLOR;
    const term = (this.env["TERM"] ?? "").trim().toLowerCase();
    const colors = term.slice(term.lastIndexOf("-") + 1);
    return (term.includes("-") ? TERM_COLORS[colors] : TERM_COLORS[term]) ?? ColorSystem.STANDARD;
  }

  get size(): { width: number; height: number } {
    if (this._width !== null && this._height !== null) return { width: this._width, height: this._height };
    if (this.is_dumb_terminal) return { width: 80, height: 25 };
    let width: number | null = null;
    let height: number | null = null;
    for (const fd of [0, 1, 2]) {
      const s = richSeams.terminalSize(fd);
      if (s) {
        [width, height] = s;
        break;
      }
    }
    const columns = this.env["COLUMNS"];
    if (columns !== undefined && /^\d+$/.test(columns)) width = parseInt(columns, 10);
    const lines = this.env["LINES"];
    if (lines !== undefined && /^\d+$/.test(lines)) height = parseInt(lines, 10);
    return { width: this._width ?? (width || 80), height: this._height ?? (height || 25) };
  }

  get width(): number {
    return this.size.width;
  }

  get options(): ConsoleOptions {
    const size = this.size;
    return {
      size,
      min_width: 1,
      max_width: size.width,
      is_terminal: this.is_terminal,
      encoding: this.encoding,
      max_height: size.height,
      justify: null,
      overflow: null,
      no_wrap: false,
      highlight: null,
      markup: null,
      height: null,
    };
  }

  renderStr(
    text: string,
    opts: { style?: StyleType; justify?: Justify | null; overflow?: Overflow | null; emoji?: boolean | null; markup?: boolean | null; highlight?: boolean | null } = {},
  ): Text {
    const emojiEnabled = opts.emoji || (opts.emoji === undefined || opts.emoji === null ? this._emoji : false);
    const markupEnabled = opts.markup || (opts.markup === undefined || opts.markup === null ? this._markup : false);
    let rich: Text;
    if (markupEnabled) {
      rich = renderMarkup(text, opts.style ?? "", Boolean(emojiEnabled));
      rich.justify = opts.justify ?? null;
      rich.overflow = opts.overflow ?? null;
    } else {
      rich = new Text(emojiEnabled ? emojiReplace(text) : text, opts.style ?? "", { justify: opts.justify, overflow: opts.overflow });
    }
    return rich;
  }

  render(renderable: Renderable | string, options?: ConsoleOptions): Segment[] {
    const opts = options ?? this.options;
    if (opts.max_width < 1) return [];
    let r: Renderable;
    if (typeof renderable === "string") r = this.renderStr(renderable, { highlight: opts.highlight, markup: opts.markup });
    else r = renderable;
    return r.richConsole(this, { ...opts, height: null });
  }

  renderLines(renderable: Renderable | string, options: ConsoleOptions, opts: { style?: Style | null; pad?: boolean; newLines?: boolean } = {}): Segment[][] {
    const style = opts.style ?? null;
    const pad = opts.pad ?? true;
    let rendered = this.render(renderable, options);
    if (styleTruthy(style)) rendered = applyStyle(rendered, style);
    const renderHeight = options.height === null ? null : Math.max(0, options.height);
    let lines = splitAndCropLines(rendered, options.max_width, style, pad, Boolean(opts.newLines));
    if (renderHeight !== null) lines = lines.slice(0, renderHeight);
    if (options.height !== null) {
      const extra = options.height - lines.length;
      if (extra > 0) {
        const padLine = opts.newLines ? [seg(" ".repeat(options.max_width), style), seg("\n")] : [seg(" ".repeat(options.max_width), style)];
        for (let i = 0; i < extra; i++) lines.push(padLine);
      }
    }
    return lines;
  }

  print(...objects: Array<Renderable | string>): void {
    this.printWith({}, ...objects);
  }

  printWith(opts: { end?: string; sep?: string }, ...objects: Array<Renderable | string>): void {
    const end = opts.end ?? "\n";
    const sep = opts.sep ?? " ";
    this.enter();
    try {
      let renderables = this.collectRenderables(objects.length ? objects : end === "\n" ? [new NewLine()] : [""], sep, end);
      for (const hook of [...this.renderHooks]) renderables = hook.processRenderables(renderables);
      const renderOptions = updateOptions(this.options, { width: NO_CHANGE, justify: null, overflow: null, no_wrap: null, highlight: null, height: null });
      const segments: Segment[] = [];
      for (const r of renderables) segments.push(...this.render(r, renderOptions));
      for (const line of splitAndCropLines(segments, this.width, null, false, true)) this.buffer.push(...line);
    } finally {
      this.exit();
    }
  }

  private collectRenderables(objects: Array<Renderable | string>, sep: string, end: string): Renderable[] {
    const out: Renderable[] = [];
    let texts: Text[] = [];
    const flush = (): void => {
      if (texts.length) {
        out.push(new Text(sep, "", { justify: null, end }).join(texts));
        texts = [];
      }
    };
    for (const o of objects) {
      if (typeof o === "string") texts.push(this.renderStr(o, { highlight: false }));
      else if (o instanceof Text) texts.push(o);
      else {
        flush();
        out.push(o);
      }
    }
    flush();
    return out;
  }

  enter(): void {
    this.bufferIndex += 1;
  }

  exit(): void {
    this.bufferIndex -= 1;
    this.checkBuffer();
  }

  private checkBuffer(): void {
    if (this.bufferIndex !== 0) return;
    const text = this.renderBuffer(this.buffer);
    this.buffer = [];
    if (!text) {
      this.file.flush?.();
      return;
    }
    this.file.write(text);
    this.file.flush?.();
  }

  private renderBuffer(buffer: Segment[]): string {
    const colorSystem = this._colorSystem;
    const notTerminal = !this.is_terminal;
    let segs = buffer;
    if (this.no_color && colorSystem !== null) segs = segs.map((s) => (styleTruthy(s.style) ? seg(s.text, s.style.withoutColor, s.control) : seg(s.text, null, s.control)));
    const out: string[] = [];
    for (const s of segs) {
      if (styleTruthy(s.style)) out.push(s.style.render(s.text, colorSystem));
      else if (!(notTerminal && s.control)) out.push(s.text);
    }
    return out.join("");
  }

  control(...controls: Control[]): void {
    if (!this.is_dumb_terminal) {
      this.enter();
      this.buffer.push(...controls.map((c) => c.segment));
      this.exit();
    }
  }

  showCursor(show = true): boolean {
    if (this.is_terminal) {
      this.control(Control.showCursor(show));
      return true;
    }
    return false;
  }

  line(count = 1): void {
    this.print(new NewLine(count));
  }

  setLive(live: Live): boolean {
    if (this.live !== null) return false;
    this.live = live;
    return true;
  }

  clearLive(): void {
    this.live = null;
  }

  pushRenderHook(hook: RenderHook): void {
    this.renderHooks.push(hook);
  }

  popRenderHook(): void {
    this.renderHooks.pop();
  }

  status(status: Text, opts: { spinner?: string; refresh_per_second?: number } = {}): Status {
    return new Status(status, this, opts);
  }
}

class NewLine implements Renderable {
  constructor(readonly count = 1) {}
  richConsole(): Segment[] {
    return [seg("\n".repeat(this.count))];
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// live / status / spinner
// ---------------------------------------------------------------------------------------------------------------------

const SPINNERS: Record<string, { interval: number; frames: string }> = {
  dots: { interval: 80, frames: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏" },
};

class Spinner implements Renderable {
  text: Text;
  private startTime: number | null = null;
  private readonly frames: string[];
  private readonly interval: number;

  constructor(
    name: string,
    text: Text,
    private style: StyleType | null,
    private readonly speed = 1.0,
  ) {
    const spinner = SPINNERS[name];
    if (!spinner) throw new Error(`KeyError: no spinner called ${pyReprStr(name)}`);
    this.text = text;
    this.frames = cps(spinner.frames);
    this.interval = spinner.interval;
  }

  update(text: Text): void {
    if (text.length) this.text = text;
  }

  richConsole(console: Console, options: ConsoleOptions): Segment[] {
    return console.render(this.renderAt(richSeams.monotonic()), options);
  }

  richMeasure(): Measurement {
    return this.renderAt(0).measure();
  }

  renderAt(time: number): Text {
    if (this.startTime === null) this.startTime = time;
    const frameNo = ((time - this.startTime) * this.speed) / (this.interval / 1000.0);
    const frame = new Text(this.frames[Math.floor(frameNo) % this.frames.length] as string, this.style ?? "");
    if (!this.text.length) return frame;
    return Text.assemble([frame, " ", this.text]);
  }
}

class LiveRender implements Renderable {
  shape: [number, number] | null = null;
  verticalOverflow: "crop" | "ellipsis" | "visible" = "ellipsis";
  constructor(public renderable: Renderable) {}

  get lastRenderHeight(): number {
    return this.shape === null ? 0 : (this.shape[1] as number);
  }

  positionCursor(): Control {
    if (this.shape === null) return new Control();
    const height = this.shape[1];
    return new Control("\r\x1b[2K" + "\x1b[1A\x1b[2K".repeat(height - 1));
  }

  restoreCursor(): Control {
    if (this.shape === null) return new Control();
    return new Control("\r" + "\x1b[1A\x1b[2K".repeat(this.shape[1]));
  }

  richConsole(console: Console, options: ConsoleOptions): Segment[] {
    let lines = console.renderLines(this.renderable, options, { style: getStyle(""), pad: false });
    let width = lines.length ? Math.max(...lines.map(lineWidth)) : 0;
    let height = lines.length;
    if (height > options.size.height) {
      if (this.verticalOverflow === "crop") {
        lines = lines.slice(0, options.size.height);
        width = lines.length ? Math.max(...lines.map(lineWidth)) : 0;
        height = lines.length;
      } else if (this.verticalOverflow === "ellipsis") {
        lines = lines.slice(0, options.size.height - 1);
        const t = new Text("...", "live.ellipsis", { overflow: "crop", justify: "center", end: "" });
        lines.push(console.render(t));
        width = lines.length ? Math.max(...lines.map(lineWidth)) : 0;
        height = lines.length;
      }
    }
    this.shape = [width, height];
    const out: Segment[] = [];
    lines.forEach((line, i) => {
      out.push(...line);
      if (i < lines.length - 1) out.push(NEWLINE());
    });
    return out;
  }
}

class FileProxy implements WritableFile {
  private buf: string[] = [];
  readonly encoding: string;
  constructor(
    private readonly console: Console,
    private readonly file: WritableFile,
  ) {
    this.encoding = file.encoding ?? "utf-8";
  }
  get rich_proxied_file(): WritableFile {
    return this.file;
  }
  isatty(): boolean {
    return this.file.isatty?.() ?? false;
  }
  write(text: string): number {
    const lines: string[] = [];
    let rest = text;
    while (rest) {
      const idx = rest.indexOf("\n");
      if (idx >= 0) {
        lines.push(this.buf.join("") + rest.slice(0, idx));
        this.buf = [];
        rest = rest.slice(idx + 1);
      } else {
        this.buf.push(rest);
        break;
      }
    }
    if (lines.length) {
      this.console.enter();
      try {
        this.console.print(new Text("\n").join(lines.map((l) => new Text(l))));
      } finally {
        this.console.exit();
      }
    }
    return text.length;
  }
  flush(): void {
    const output = this.buf.join("");
    if (output) this.console.print(output);
    this.buf = [];
  }
}

export class Live implements RenderHook {
  private started = false;
  private nested = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly liveRender: LiveRender;
  private restoreStdout: WritableFile | null = null;
  private restoreStderr: WritableFile | null = null;
  vertical_overflow: "crop" | "ellipsis" | "visible" = "ellipsis";

  constructor(
    private renderable: Renderable,
    private readonly console: Console,
    private readonly refreshPerSecond = 4,
    private readonly transient = true,
  ) {
    this.liveRender = new LiveRender(renderable);
  }

  start(refresh = false): void {
    if (this.started) return;
    this.started = true;
    if (!this.console.setLive(this)) {
      this.nested = true;
      return;
    }
    this.console.showCursor(false);
    this.enableRedirectIo();
    this.console.pushRenderHook(this);
    if (refresh) {
      try {
        this.refresh();
      } catch (e) {
        this.stop();
        throw e;
      }
    }
    this.timer = setInterval(() => {
      if (this.started) this.refresh();
    }, 1000 / this.refreshPerSecond);
    this.timer.unref();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.console.clearLive();
    if (this.nested) {
      if (!this.transient) this.console.print(this.renderable);
      return;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.vertical_overflow = "visible";
    this.console.enter();
    try {
      try {
        this.refresh();
      } finally {
        this.disableRedirectIo();
        this.console.popRenderHook();
        if (this.console.is_terminal && this.liveRender.lastRenderHeight) this.console.line();
        this.console.showCursor(true);
        if (this.transient) this.console.control(this.liveRender.restoreCursor());
      }
    } finally {
      this.console.exit();
    }
  }

  update(renderable: Renderable, refresh = false): void {
    this.renderable = renderable;
    if (refresh) this.refresh();
  }

  refresh(): void {
    this.liveRender.renderable = this.renderable;
    if (this.nested) return;
    if (this.console.is_terminal && !this.console.is_dumb_terminal) {
      this.console.enter();
      try {
        this.console.print(new Control());
      } finally {
        this.console.exit();
      }
    } else if (!this.started && !this.transient) {
      this.console.enter();
      try {
        this.console.print(new Control());
      } finally {
        this.console.exit();
      }
    }
  }

  processRenderables(renderables: Renderable[]): Renderable[] {
    this.liveRender.verticalOverflow = this.vertical_overflow;
    if (this.console.is_interactive) return [this.liveRender.positionCursor(), ...renderables, this.liveRender];
    if (!this.started && !this.transient) return [...renderables, this.liveRender];
    return renderables;
  }

  private enableRedirectIo(): void {
    if (this.console.is_terminal) {
      if (!(pySys.stdout as unknown as { rich_proxied_file?: unknown }).rich_proxied_file) {
        this.restoreStdout = pySys.stdout as unknown as WritableFile;
        pySys.stdout = new FileProxy(this.console, pySys.stdout as unknown as WritableFile) as never;
      }
      if (!(pySys.stderr as unknown as { rich_proxied_file?: unknown }).rich_proxied_file) {
        this.restoreStderr = pySys.stderr as unknown as WritableFile;
        pySys.stderr = new FileProxy(this.console, pySys.stderr as unknown as WritableFile) as never;
      }
    }
  }

  private disableRedirectIo(): void {
    if (this.restoreStdout) {
      pySys.stdout = this.restoreStdout as never;
      this.restoreStdout = null;
    }
    if (this.restoreStderr) {
      pySys.stderr = this.restoreStderr as never;
      this.restoreStderr = null;
    }
  }
}

export class Status {
  private readonly spinner: Spinner;
  private readonly live: Live;

  constructor(
    status: Text,
    console: Console,
    opts: { spinner?: string; refresh_per_second?: number } = {},
  ) {
    this.spinner = new Spinner(opts.spinner ?? "dots", status, "status.spinner", 1.0);
    this.live = new Live(this.spinner, console, opts.refresh_per_second ?? 12.5, true);
  }

  update(status: Text): void {
    this.spinner.update(status);
  }

  start(): void {
    this.live.start();
  }

  stop(): void {
    this.live.stop();
  }
}

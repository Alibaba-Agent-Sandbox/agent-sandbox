/**
 * Port of the parts of CPython's `difflib` used by the CLI: `SequenceMatcher` (with the `autojunk` heuristic) and
 * `get_close_matches`. Strings are compared by Unicode code point like Python does.
 */

interface Match {
  a: number;
  b: number;
  size: number;
}

export class SequenceMatcher {
  private a: string[] = [];
  private b: string[] = [];
  private b2j = new Map<string, number[]>();
  private bjunk = new Set<string>();
  private bpopular = new Set<string>();
  private fullbcount: Map<string, number> | null = null;
  private matchingBlocks: Match[] | null = null;
  private readonly autojunk: boolean;

  constructor(
    private readonly isjunk: ((x: string) => boolean) | null = null,
    a: string | string[] = "",
    b: string | string[] = "",
    autojunk = true,
  ) {
    this.autojunk = autojunk;
    this.setSeqs(a, b);
  }

  setSeqs(a: string | string[], b: string | string[]): void {
    this.setSeq1(a);
    this.setSeq2(b);
  }

  setSeq1(a: string | string[]): void {
    this.a = typeof a === "string" ? Array.from(a) : a;
    this.matchingBlocks = null;
  }

  setSeq2(b: string | string[]): void {
    this.b = typeof b === "string" ? Array.from(b) : b;
    this.matchingBlocks = null;
    this.fullbcount = null;
    this.chainB();
  }

  private chainB(): void {
    const b = this.b;
    this.b2j = new Map();
    const b2j = this.b2j;
    b.forEach((elt, i) => {
      const indices = b2j.get(elt);
      if (indices) indices.push(i);
      else b2j.set(elt, [i]);
    });
    this.bjunk = new Set();
    if (this.isjunk) {
      for (const elt of b2j.keys()) {
        if (this.isjunk(elt)) this.bjunk.add(elt);
      }
      for (const elt of this.bjunk) b2j.delete(elt);
    }
    this.bpopular = new Set();
    const n = b.length;
    if (this.autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of b2j) {
        if (idxs.length > ntest) this.bpopular.add(elt);
      }
      for (const elt of this.bpopular) b2j.delete(elt);
    }
  }

  findLongestMatch(alo = 0, ahi?: number, blo = 0, bhi?: number): Match {
    const a = this.a;
    const b = this.b;
    const b2j = this.b2j;
    const isbjunk = (x: string): boolean => this.bjunk.has(x);
    const ahiN = ahi ?? a.length;
    const bhiN = bhi ?? b.length;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahiN; i++) {
      const newj2len = new Map<number, number>();
      const indices = b2j.get(a[i] as string) ?? [];
      for (const j of indices) {
        if (j < blo) continue;
        if (j >= bhiN) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && !isbjunk(b[bestj - 1] as string) && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (
      besti + bestsize < ahiN &&
      bestj + bestsize < bhiN &&
      !isbjunk(b[bestj + bestsize] as string) &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize++;
    }
    while (besti > alo && bestj > blo && isbjunk(b[bestj - 1] as string) && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (
      besti + bestsize < ahiN &&
      bestj + bestsize < bhiN &&
      isbjunk(b[bestj + bestsize] as string) &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize++;
    }
    return { a: besti, b: bestj, size: bestsize };
  }

  getMatchingBlocks(): Match[] {
    if (this.matchingBlocks) return this.matchingBlocks;
    const la = this.a.length;
    const lb = this.b.length;
    const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]];
    const matchingBlocks: Match[] = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop() as [number, number, number, number];
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const { a: i, b: j, size: k } = x;
      if (k) {
        matchingBlocks.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    matchingBlocks.sort((p, q) => p.a - q.a || p.b - q.b || p.size - q.size);
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent: Match[] = [];
    for (const { a: i2, b: j2, size: k2 } of matchingBlocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
    nonAdjacent.push({ a: la, b: lb, size: 0 });
    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  ratio(): number {
    let matches = 0;
    for (const m of this.getMatchingBlocks()) matches += m.size;
    return calculateRatio(matches, this.a.length + this.b.length);
  }

  quickRatio(): number {
    if (this.fullbcount === null) {
      this.fullbcount = new Map();
      for (const elt of this.b) this.fullbcount.set(elt, (this.fullbcount.get(elt) ?? 0) + 1);
    }
    const fullbcount = this.fullbcount;
    const avail = new Map<string, number>();
    let matches = 0;
    for (const elt of this.a) {
      const numb = avail.has(elt) ? (avail.get(elt) as number) : (fullbcount.get(elt) ?? 0);
      avail.set(elt, numb - 1);
      if (numb > 0) matches++;
    }
    return calculateRatio(matches, this.a.length + this.b.length);
  }

  realQuickRatio(): number {
    const la = this.a.length;
    const lb = this.b.length;
    return calculateRatio(Math.min(la, lb), la + lb);
  }
}

function calculateRatio(matches: number, length: number): number {
  if (length) return (2.0 * matches) / length;
  return 1.0;
}

/** `difflib.get_close_matches(word, possibilities, n, cutoff)`. */
export function getCloseMatches(word: string, possibilities: Iterable<string>, n = 3, cutoff = 0.6): string[] {
  if (!(n > 0)) throw new Error(`n must be > 0: ${n}`);
  if (!(cutoff >= 0.0 && cutoff <= 1.0)) throw new Error(`cutoff must be in [0.0, 1.0]: ${cutoff}`);
  const result: Array<[number, string]> = [];
  const s = new SequenceMatcher();
  s.setSeq2(word);
  for (const x of possibilities) {
    s.setSeq1(x);
    if (s.realQuickRatio() >= cutoff && s.quickRatio() >= cutoff && s.ratio() >= cutoff) {
      result.push([s.ratio(), x]);
    }
  }
  // heapq.nlargest(n, result): descending by (score, candidate) tuple comparison.
  result.sort((p, q) => {
    if (p[0] !== q[0]) return q[0] - p[0];
    if (p[1] === q[1]) return 0;
    return p[1] < q[1] ? 1 : -1;
  });
  return result.slice(0, n).map(([, x]) => x);
}

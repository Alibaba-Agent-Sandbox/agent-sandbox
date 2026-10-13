/** Spelling suggestions: the candidates closest to a word by edit-distance similarity. */

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Similarity in [0, 1]: 1 for equal strings, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}

/** Up to `n` candidates with a similarity of at least `cutoff`, best first (ties keep input order). */
export function closeMatches(word: string, candidates: Iterable<string>, n = 3, cutoff = 0.6): string[] {
  return [...candidates]
    .map((c, i) => ({ c, i, score: similarity(word, c) }))
    .filter((m) => m.score >= cutoff)
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .slice(0, n)
    .map((m) => m.c);
}

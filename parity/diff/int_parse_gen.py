#!/usr/bin/env python3
"""Generate `int_parse_cases.json` (consumed by `tests/test_cli/test_parse_int_strict.test.ts`): what CPython's `int(str)`
answers for curated + seeded random strings (Unicode digits, underscores, whitespace, signs).

    HOME=$(mktemp -d) /path/to/oracle-venv/bin/python parity/diff/int_parse_gen.py [--count N] [--seed S] [--out FILE]

Expected value: the decimal text of the result (so huge ints are exact) or null when `int()` raises ValueError.
"""
import argparse
import json
import random
import sys
import unicodedata

CURATED = [
    "0", "-0", "+0", "7", "-7", "+7", "007", "1_000", "1__0", "_1", "1_", "-_1", "+_1", "1_0_0", "", " ", "  12  ",
    "\t12\n", "\u00a012\u00a0", "\u200b12", "\u180e12", "\x1c12\x1f", "1 2", "+ 1", "- 1", "--1", "+-1", "1e3", "0x10",
    "0b1", "0o7", "1.0", "1.", ".1", "\u0661\u0662", "\u0661_\u0662", "\u0661\u0662x", "\uff11\uff12", "-\uff11",
    "\u0967\u0968", "\u1d7ce\u1d7cf", "\U0001d7ce\U0001d7cf", "\u00b2", "\u2082", "\u2460", "\u0bf0", "\u096610",
    "9" * 30, "-" + "9" * 400, "9" * 4300, "9" * 4301, "1_" * 5 + "1", "\U00011f50", "\U0001e4f0", "\U00010d40",
]
ATOMS = ["0", "1", "9", "_", "-", "+", " ", "\t", "x", "e", ".", "\u0661", "\u0669", "\uff10", "\uff19", "\u0967",
         "\u09ea", "\U0001d7d8", "\U0001d7ff", "\u00a0", "\u3000", "\u2003", "\x1f", "\x85", "\u00b2", "\u0be6", "a"]


def expect(s):
    try:
        return str(int(s))
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=3000)
    ap.add_argument("--seed", type=int, default=20261012)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    docs = list(CURATED)
    while len(docs) < a.count:
        docs.append("".join(rnd.choice(ATOMS) for _ in range(rnd.randint(0, 7))))
    # every decimal digit CPython knows, alone, signed and underscored
    for cp in range(sys.maxunicode + 1):
        if unicodedata.category(chr(cp)) == "Nd":
            c = chr(cp)
            docs += [c, "-" + c + c, c + "_" + c]
    seen, cases = set(), []
    for s in docs:
        if s in seen:
            continue
        seen.add(s)
        cases.append([s, expect(s)])
    out = json.dumps({"cases": cases}, ensure_ascii=True)
    (open(a.out, "w") if a.out else sys.stdout).write(out)


if __name__ == "__main__":
    main()

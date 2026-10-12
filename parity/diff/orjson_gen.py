#!/usr/bin/env python3
"""Generate the orjson differential fixture `orjson_cases.json` (consumed by `tests/test_cli/test_orjson_dumps.test.ts`).

    HOME=$(mktemp -d) /path/to/oracle-venv/bin/python parity/diff/orjson_gen.py [--count N] [--seed S] [--out FILE]

Every case is a random (seeded, deterministic) JSON-like Python value, encoded with a small tagging scheme so that the
Node side can rebuild the exact Python types, plus what the oracle's `orjson` produced for it:

    value tags : JSON null/bool/str/array as themselves   {"i": "<decimal>"} int       {"f": "<16 hex digits>"} float (IEEE bits)
                 {"d": [[key, value], ...]} dict (keys are tagged values, so non-str keys are covered)
                 {"x": "set"} an unserialisable object
    expect     : {"ok": "<text>"} or {"err": "<exception type>: <message>"}  -- for OPT_INDENT_2 (`indent`) and bare dumps (`compact`)
"""

from __future__ import annotations

import argparse
import json
import math
import random
import struct
import sys

import orjson

OPT = orjson.OPT_INDENT_2


def run(value, option=0):
    try:
        return {"ok": orjson.dumps(value, option=option).decode()}
    except Exception as exc:  # noqa: BLE001 - the error text is the thing under test
        return {"err": f"{type(exc).__name__}: {exc}"}


def tag(value):
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return {"i": str(value)}
    if isinstance(value, float):
        return {"f": struct.pack(">d", value).hex()}
    if isinstance(value, list):
        return [tag(v) for v in value]
    if isinstance(value, dict):
        return {"d": [[tag(k), tag(v)] for k, v in value.items()]}
    if isinstance(value, set):
        return {"x": "set"}
    raise TypeError(type(value))


STR_POOL = (
    ["", "a", "plain text", "é", "日本語", "😀", "a\u2028b", "\x7f", "\x00", "\x1f", "\x0b", "\"", "\\", "/", "\b\f\n\r\t", "\u0085", "\ufeff", "\uffff", "中文 mixed 😀 text"]
    + [chr(c) for c in range(0, 0x30)]
)


def rand_str(rng: random.Random) -> str:
    n = rng.choice([0, 1, 1, 2, 3, 5, 12])
    parts = []
    for _ in range(n):
        r = rng.random()
        if r < 0.45:
            parts.append(rng.choice(STR_POOL))
        elif r < 0.75:
            parts.append(chr(rng.randrange(0x20, 0x7F)))
        elif r < 0.95:
            c = rng.randrange(0x80, 0x110000)
            if 0xD800 <= c <= 0xDFFF:
                c = 0x3042
            parts.append(chr(c))
        else:
            parts.append(chr(rng.randrange(0xD800, 0xE000)))  # lone surrogate -> orjson raises
    out = list("".join(parts))
    # A high surrogate directly followed by a low one is two code points in Python but one character in a JS string.
    for i in range(len(out) - 1):
        if "\ud800" <= out[i] <= "\udbff" and "\udc00" <= out[i + 1] <= "\udfff":
            out[i + 1] = "x"
    return "".join(out)


def rand_float(rng: random.Random) -> float:
    r = rng.random()
    if r < 0.2:
        return struct.unpack(">d", rng.getrandbits(64).to_bytes(8, "big"))[0]  # any bit pattern (incl. nan/inf/subnormal)
    if r < 0.55:
        e = rng.randint(-30, 30)
        return float(f"{rng.choice(['1', '9.5', '1.5', str(rng.randint(1, 99999)), repr(rng.random())])}e{e}")
    if r < 0.7:
        return float(rng.choice([1e15, 1e16, 9999999999999998.0, 1e-5, 1e-6, 9.999e-6, 0.00001, 123456789012345678.0, 5e-324, 1.7976931348623157e308, -0.0, 0.0, 1.0, 100.0, 0.1]))
    if r < 0.8:
        return rng.choice([math.nan, math.inf, -math.inf])
    return rng.uniform(-1e6, 1e6) * 10 ** rng.randint(-12, 22)


def rand_int(rng: random.Random) -> int:
    r = rng.random()
    if r < 0.4:
        return rng.randint(-1000, 100000)
    if r < 0.6:
        return rng.randint(-(2**53) - 5, 2**53 + 5)
    if r < 0.85:
        edge = rng.choice([2**63, 2**64, -(2**63), 2**31, 2**32, 2**53, 2**64 - 1])
        return edge + rng.randint(-2, 2)
    return rng.randint(-(10**40), 10**40)


def rand_value(rng: random.Random, depth: int):
    leaf = depth <= 0 or rng.random() < 0.35
    if leaf:
        r = rng.random()
        if r < 0.1:
            return None
        if r < 0.2:
            return rng.random() < 0.5
        if r < 0.45:
            return rand_str(rng)
        if r < 0.7:
            return rand_int(rng)
        if r < 0.99:
            return rand_float(rng)
        return {1, 2}
    if rng.random() < 0.5:
        return [rand_value(rng, depth - 1) for _ in range(rng.choice([0, 1, 2, 3, 4]))]
    d = {}
    for _ in range(rng.choice([0, 1, 2, 3, 4])):
        r = rng.random()
        key = rand_str(rng) if r < 0.96 else rand_int(rng)
        if isinstance(key, str) and any(0xD800 <= ord(ch) <= 0xDFFF for ch in key) and rng.random() < 0.5:
            key = "k"
        d[key] = rand_value(rng, depth - 1)
    return d


def nested(kind: str, n: int, leaf=1):
    value = leaf
    for _ in range(n):
        value = [value] if kind == "list" else {"a": value}
    return value


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=20261012)
    ap.add_argument("--out", default="parity/diff/orjson_cases.json")
    args = ap.parse_args()
    rng = random.Random(args.seed)

    values = []
    for e in range(-30, 31):
        for m in (1.0, 1.5, 9.5, 1.2345678901234567, 7.0):
            values.append(float(f"{m}e{e}"))
    values += [5e-324, 1.7976931348623157e308, math.nan, math.inf, -math.inf, -0.0, 0.0, 1.0, 2**63, 2**64 - 1, 2**64, -(2**63), -(2**63) - 1, 10**30, "\ud800", "\udfff", "\ude00\ud83d"]
    for n in (1, 2, 100, 250, 252, 253, 254, 255, 256, 300):
        values.append(nested("list", n))
        values.append(nested("dict", n))
        values.append(nested("list", n, leaf=None))
        values.append(nested("list", n, leaf=[]))
        values.append(nested("dict", n, leaf={}))
    values += [{"k": float("nan"), "j": [2**64, "\ud800"]}, {1: 2}, {"a": {1, 2}}, [{"a": 2**70}, {1: 1}]]
    for _ in range(args.count):
        values.append(rand_value(rng, rng.choice([1, 2, 3, 4, 5])))

    cases = [{"value": tag(v), "indent": run(v, OPT), "compact": run(v)} for v in values]
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"orjson": orjson.__version__, "seed": args.seed, "cases": cases}, fh, ensure_ascii=True, separators=(",", ":"))
        fh.write("\n")
    errs = sum(1 for c in cases if "err" in c["indent"])
    print(f"{len(cases)} cases ({errs} raise), orjson {orjson.__version__} -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

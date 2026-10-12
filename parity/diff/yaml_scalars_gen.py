#!/usr/bin/env python3
"""Generate the PyYAML scalar-resolution fixture `yaml_scalars_cases.json` (consumed by
`tests/test_utils/test_pyyaml_scalars.test.ts`).

    HOME=$(mktemp -d) /path/to/oracle-venv/bin/python parity/diff/yaml_scalars_gen.py [--count N] [--seed S] [--out FILE]

Each case is a YAML document (curated edge cases plus seeded random scalars, placed in block mapping / block sequence /
flow / bare-document / merge-key contexts) and what `yaml.safe_load` (pure-Python SafeLoader, as the CLI uses) produced,
encoded with a small type-tagging scheme:

    {"n": null} {"b": true} {"s": "text"} {"i": "<decimal>"} {"f": "<repr(float)>"}
    {"t": <epoch milliseconds>}  (date / datetime, naive treated as UTC)
    {"l": [...]}  {"d": [[key, value], ...]}  {"err": "<exception class>"}
"""

from __future__ import annotations

import argparse
import datetime
import json
import random
import sys

import yaml

CURATED = [
    # booleans / nulls
    "y", "Y", "n", "N", "yes", "Yes", "YES", "yEs", "no", "No", "NO", "nO", "true", "True", "TRUE", "tRue", "false",
    "False", "FALSE", "fAlse", "on", "On", "ON", "oN", "off", "Off", "OFF", "oFf", "t", "f", "T", "F", "~", "null",
    "Null", "NULL", "nULL", "", "none", "None", "nil", "=", "<<", "!", "-", "?",
    # ints
    "0", "-0", "+0", "1", "-1", "+1", "00", "007", "0o7", "0o17", "017", "018", "08", "09", "0_7", "07_7", "0b101",
    "0B101", "-0b11", "+0b11", "0b", "0b2", "0b1_0", "0x1F", "0X1f", "0xFF", "-0xff", "0x", "0xg", "1_000", "1__000",
    "_1", "1_", "1_0_0", "-1_0", "+1_0", "9007199254740993", "123456789012345678901234567890", "-9223372036854775809",
    "0x7FFFFFFFFFFFFFFF", "0xFFFFFFFFFFFFFFFFFFFF", "1:30", "1:30:00", "-1:30", "+1:30", "1:60", "190:20:30", "1:1:1",
    "1:30_0", "01:30", "0:30", "1:3", "1:030", "12345678901234567890:00",
    # floats
    ".5", "5.", "-.5", "+.5", "1.5", "-1.5", "1.5e3", "1.5E3", "1e3", "1E3", "1.0e+3", "1.0e-3", "1.0e3", "1.e3",
    ".5e3", ".5e+3", "1_0.5", "1.5_5", "1._5", "_1.5", "1.5_", ".inf", ".Inf", ".INF", "-.inf", "+.inf", "-.INF",
    ".iNf", ".nan", ".NaN", ".NAN", "-.nan", "+.nan", ".nAn", "inf", "nan", "NaN", "Infinity", "-Infinity", "1:30.5",
    "1:30:00.25", "-1:30.5", "1:60.5", "0.0", "-0.0", "0.", "00.5", "1e400", "1.0e400", "1e-400", "1e+3", "1e3.5",
    "1.7976931348623157e308", "5e-324", "123456789012345678.0", "1,000", "1,5",
    # timestamps
    "2001-12-14", "2001-12-14t21:59:43.10-05:00", "2001-12-14T21:59:43.10-05:00", "2001-12-14 21:59:43.10",
    "2001-12-14 21:59:43.10 -5", "2001-12-14 21:59:43.10 +5:30", "2001-12-14 21:59:43.10 Z", "2001-12-14 21:59:43Z",
    "2001-12-14 21:59:43", "2001-12-14T21:59:43", "2001-12-14T21:59:43.", "2001-12-14T21:59:43.123456789",
    "2001-1-1", "2001-1-1 1:00:00", "2001-01-01T1:00:00", "2001-13-01", "2001-02-30", "2001-12-14T25:00:00",
    "2001-12-14 21:59:43.10 -05:00", "2001-12-14T21:59:43+0530", "2001-12-14T21:59:43 +05", "0001-01-01", "9999-12-31",
    "12001-12-14", "2001-12-14x", "20011214", "2001/12/14",
    # strings that look special
    "1 2", "0x 1", "1e", "e1", ".", "..", "+", "1+", "--1", "1.2.3", "0.5.5", "1.5f", "0b1_", "0o", "0o8", "-.", "-",
    "- 1", "--- 1", "@x", "`x", "%x", "&a", "*a", "!!int 5", "!!float 5", "!!str 5", "!!bool yes", "!!null ''",
    "!!binary aGVsbG8=", "!!set {a, b}", "!!omap [a: 1]", "!!pairs [a: 1]", "'yes'", '"yes"', "'1'", '"1.5"',
    "'2001-12-14'", "yes # c", "1 # c", "|\n  1", ">\n  yes", "[1, y, yes, n, ~]", "{a: y, b: n, c: .inf}",
    "[1, 2.0, 0x10, 010, 1:30]", "{? a : 1}", "[a: 1]", "- 1\n- y\n- n", "a: 1\na: 2", "a: &x y\nb: *x", "a: *x",
    "&a [1]\n", "? [1]\n: v", "? {a: 1}\n: v", "1: a\n1.0: b\ntrue: c\n", "1: a\n0x1: b\n", "y: 1\nn: 2", "yes: 1\nno: 2",
    "~: 1", "null: 1", "2001-12-14: x", ".inf: x", ".nan: a\n.nan: b", "1e3: x", "0b1: x", "? 1\n? 01\n",
    "<<: {a: 1}", "<<: {a: 1}\na: 2", "a: 2\n<<: {a: 1}", "<<: [{a: 1}, {a: 2, b: 3}]", "<<: [{a: 1}]\n<<: {a: 9}",
    "<<: 1", "<<: [1]", "<<: [{a: 1}, 2]", "<<: ~", "x: &m {a: 1}\ny:\n  <<: *m\n  b: 2", "'<<': {a: 1}", "<<: *m",
    "base: &b {a: 1, b: 2}\nd:\n  <<: *b\n  b: 3\n", "base: &b {a: 1}\nd: {<<: *b, a: 2}", "- &a x\n- *a", "a: !!str\nb: !!int",
    "a: !!int abc", "a: !!float abc", "a: !!bool maybe", "a: !!null x", "a: !!timestamp x", "a: !unknown 1",
    "!!python/object:os.system x", "a: [", "a: {", "a: 'x", "a:\n\t- 1", "- a\nb: 1", "a: b: c", "a: 1\n---\nb: 2",
    "---\na: 1\n...\n", "--- 1\n--- 2\n", "# only comment", "\n\n", " ", "a:", "a: |\n x\n", "a: >-\n x\n y\n",
]

SCALAR_ATOMS = [
    "y", "n", "yes", "no", "Y", "N", "on", "off", "true", "false", "null", "~", "t", "f", "0", "1", "7", "9", "10",
    "_", ".", ":", "-", "+", "e", "E", "x", "b", "o", "0x", "0b", "0o", "inf", "nan", ".inf", ".nan", "T", "Z", " ",
    "2001", "12", "14", "-5", "05", "1_0", "00", "1e3", "1.5", "0.5", "a", "B", "A", "F", "f0", "ff", "<<",
]

CONTEXTS = [
    "{s}", "k: {s}", "- {s}", "[{s}]", "{{k: {s}}}", "k: [{s}, {s}]", "{s}: v", "[{s}: v]", "? {s}\n: v", "k: {s} # c",
]


def encode(value):
    if value is None:
        return {"n": None}
    if isinstance(value, bool):
        return {"b": value}
    if isinstance(value, str):
        return {"s": value}
    if isinstance(value, int):
        return {"i": str(value)}
    if isinstance(value, float):
        return {"f": repr(value)}
    if isinstance(value, datetime.datetime):
        if value.tzinfo is not None:
            value = value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        delta = value - datetime.datetime(1970, 1, 1)
        return {"t": (delta.days * 86400 + delta.seconds) * 1000 + delta.microseconds // 1000}
    if isinstance(value, datetime.date):
        return {"t": (value - datetime.date(1970, 1, 1)).days * 86400000}
    if isinstance(value, list):
        return {"l": [encode(v) for v in value]}
    if isinstance(value, dict):
        return {"d": [[encode(k), encode(v)] for k, v in value.items()]}
    if isinstance(value, (set, frozenset)):
        return {"x": "set:" + json.dumps(sorted(map(str, value)))}
    if isinstance(value, (bytes, bytearray)):
        return {"x": "bytes:" + value.hex()}
    return {"x": type(value).__name__}


def load(doc):
    try:
        return encode(yaml.safe_load(doc))
    except RecursionError:
        return {"err": "RecursionError"}
    except yaml.YAMLError:
        return {"err": "YAMLError"}
    except Exception as exc:  # noqa: BLE001
        return {"err": type(exc).__name__}


def random_scalar(rnd):
    return "".join(rnd.choice(SCALAR_ATOMS) for _ in range(rnd.randint(1, 4)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=2500)
    ap.add_argument("--seed", type=int, default=20261012)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    rnd = random.Random(args.seed)
    docs = list(CURATED)
    for s in CURATED:
        if "\n" not in s:
            docs.append(f"k: {s}")
            docs.append(f"- {s}")
    while len(docs) < args.count:
        s = random_scalar(rnd)
        docs.append(rnd.choice(CONTEXTS).format(s=s))
    seen = set()
    cases = []
    for doc in docs:
        if doc in seen:
            continue
        seen.add(doc)
        cases.append({"doc": doc, "expect": load(doc)})
    out = json.dumps({"yaml_version": yaml.__version__, "cases": cases}, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(out)
    else:
        sys.stdout.write(out)


if __name__ == "__main__":
    main()

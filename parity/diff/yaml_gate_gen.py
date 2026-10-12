"""Record PyYAML `yaml.safe_load` outcomes for the YAML gate corpus (`yaml_gate_cases.json`).

    node --import tsx parity/diff/adv_agent_template_yaml.mjs --dump-corpus /tmp/corpus.json
    python parity/diff/yaml_gate_gen.py /tmp/corpus.json > parity/diff/yaml_gate_cases.json

Each case is {"doc": text, "expect": enc} where enc is {"err": ExceptionClass, "msg": str(exc)} or an encoded value
(`n b s i f t x set tup l d`, see tests/test_utils/test_pyyaml_gate.test.ts). Requires PyYAML 6.0.x (pure-Python loader).
"""

import datetime
import json
import os
import sys
import tempfile

import yaml


def enc(v, depth=0):
    if depth > 30:
        return {"rec": 1}
    if v is None:
        return {"n": None}
    if isinstance(v, bool):
        return {"b": v}
    if isinstance(v, int):
        return {"i": str(v)}
    if isinstance(v, float):
        return {"f": repr(v)}
    if isinstance(v, str):
        return {"s": v}
    if isinstance(v, datetime.datetime):
        return {"t": v.isoformat(" ")}
    if isinstance(v, datetime.date):
        return {"t": v.isoformat()}
    if isinstance(v, bytes):
        return {"x": v.hex()}
    if isinstance(v, set):
        return {"set": sorted(json.dumps(enc(i, depth + 1), sort_keys=True, separators=(",", ":")) for i in v)}
    if isinstance(v, tuple):
        return {"tup": [enc(i, depth + 1) for i in v]}
    if isinstance(v, list):
        return {"l": [enc(i, depth + 1) for i in v]}
    if isinstance(v, dict):
        return {"d": [[enc(k, depth + 1), enc(x, depth + 1)] for k, x in v.items()]}
    return {"?": type(v).__name__}


# Documents that matter only for file streams: PyYAML validates and reads a stream in 4096-character chunks.
EXTRA = [
    "a: 1\n" * 1500 + "\0\n",
    "a: 1\n" * 1500 + "\x01\n",
    "a: [\n" + "a: 1\n" * 1500 + "\0\n",
    "a: 1\n" * 820 + "b: [\n" + "c: 1\n" * 40 + "\0\n",
    "a: 1\n" * 819 + "\0\n",
    "a: 1\n" * 819 + "a: 12\0\n",
    "x" * 4094 + "\0",
    "x" * 4095 + "\0",
    "x" * 4096 + "\0",
    "x" * 4097 + "\0",
    "[" + "a, " * 1500 + "\0]",
    "\ufeff" + "a: 1\n" * 3000,
    "key: value\n" + "# c\n" * 2000 + "\x7f\n",
    "a: |\n" + "  text\n" * 1500 + "\x85\n  \0\n",
    "- a\n" * 2000 + "b: c\n",
    "- a\n" * 2000 + "- b: c: d\n",
]


def run_stream(doc, tmp):
    path = os.path.join(tmp, "template.yaml")
    try:
        data = doc.encode("utf-8")
    except UnicodeEncodeError:
        return None
    with open(path, "wb") as fh:
        fh.write(data)
    try:
        with open(path, encoding="utf-8") as fh:
            return enc(yaml.safe_load(fh))
    except RecursionError:
        return {"err": "RecursionError", "msg": ""}
    except Exception as exc:  # noqa: BLE001
        return {"err": type(exc).__name__, "msg": str(exc).replace(tmp, "/T")}


def main():
    with open(sys.argv[1], encoding="utf-8") as fh:
        docs = json.load(fh)
    docs = docs + [d for d in EXTRA if d not in docs]
    cases = []
    with tempfile.TemporaryDirectory() as tmp:
        for doc in docs:
            try:
                expect = enc(yaml.safe_load(doc))
            except RecursionError:
                expect = {"err": "RecursionError", "msg": ""}
            except Exception as exc:  # noqa: BLE001
                expect = {"err": type(exc).__name__, "msg": str(exc)}
            cases.append({"doc": doc, "expect": expect, "stream": run_stream(doc, tmp)})
    json.dump({"pyyaml": yaml.__version__, "cases": cases}, sys.stdout, ensure_ascii=True, separators=(",", ":"))
    sys.stdout.write("\n")


main()

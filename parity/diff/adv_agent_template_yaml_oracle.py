"""Read a JSON array of YAML texts on stdin, print per text the PyYAML safe_load outcome as JSON lines.

Each output item: {"ok": true, "v": <canonical>} or {"ok": false, "err": "<ExceptionClass>"}.
Canonical form: ["s", str] ["i", int-as-str] ["f", repr] ["b", bool] ["n"] ["l", [...]] ["d", [[k, v], ...]]
["t", iso] (date/datetime) ["x", "bytes", hex] ["set", [...]]
"""

import datetime
import json
import sys

import yaml


def canon(v, depth=0):
    if depth > 40:
        return ["rec"]
    if v is None:
        return ["n"]
    if isinstance(v, bool):
        return ["b", v]
    if isinstance(v, int):
        return ["num", repr(float(v)) if abs(v) < 2**53 else str(v)]
    if isinstance(v, float):
        if v != v:
            return ["num", "nan"]
        if v in (float("inf"), float("-inf")):
            return ["num", "inf" if v > 0 else "-inf"]
        return ["num", repr(v)]
    if isinstance(v, str):
        return ["s", v]
    if isinstance(v, (datetime.datetime, datetime.date)):
        return ["t", v.isoformat(" ") if isinstance(v, datetime.datetime) else v.isoformat()]
    if isinstance(v, bytes):
        return ["x", v.hex()]
    if isinstance(v, set):
        return ["set", sorted(json.dumps(canon(i, depth + 1), separators=(",", ":")) for i in v)]
    if isinstance(v, (list, tuple)):
        return ["l", [canon(i, depth + 1) for i in v]]
    if isinstance(v, dict):
        return ["d", [[canon(k, depth + 1), canon(x, depth + 1)] for k, x in v.items()]]
    return ["?", type(v).__name__]


out = []
for text in json.load(sys.stdin):
    try:
        out.append({"ok": True, "v": canon(yaml.safe_load(text))})
    except Exception as exc:  # noqa: BLE001
        out.append({"ok": False, "err": type(exc).__name__, "msg": str(exc)})
print(json.dumps(out))

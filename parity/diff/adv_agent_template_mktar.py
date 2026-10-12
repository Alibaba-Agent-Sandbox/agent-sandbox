"""Build a (possibly hostile) .tar.gz from a JSON spec on stdin; bytes go to stdout.

Spec: {"members": [{"name": str, "type": "file|dir|sym|hard|chr|fifo", "data": str, "b64": str,
                    "linkname": str, "mode": int}], "format": "gnu|pax|ustar", "compress": "gz|none|trunc|bz2"}
"""

import base64
import gzip
import io
import json
import sys
import tarfile

spec = json.load(sys.stdin)
fmt = {"gnu": tarfile.GNU_FORMAT, "pax": tarfile.PAX_FORMAT, "ustar": tarfile.USTAR_FORMAT}[spec.get("format", "gnu")]
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w", format=fmt) as tf:
    for m in spec["members"]:
        info = tarfile.TarInfo(m["name"])
        kind = m.get("type", "file")
        info.mode = m.get("mode", 0o644 if kind == "file" else 0o755)
        info.mtime = 1767225600
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        data = None
        if kind == "file":
            data = base64.b64decode(m["b64"]) if "b64" in m else m.get("data", "").encode()
            info.size = len(data)
        elif kind == "dir":
            info.type = tarfile.DIRTYPE
        elif kind == "sym":
            info.type = tarfile.SYMTYPE
            info.linkname = m["linkname"]
        elif kind == "hard":
            info.type = tarfile.LNKTYPE
            info.linkname = m["linkname"]
        elif kind == "chr":
            info.type = tarfile.CHRTYPE
        elif kind == "fifo":
            info.type = tarfile.FIFOTYPE
        tf.addfile(info, io.BytesIO(data) if data is not None else None)
raw = buf.getvalue()
mode = spec.get("compress", "gz")
if mode == "gz":
    out = gzip.compress(raw, mtime=0)
elif mode == "none":
    out = raw
elif mode == "trunc":
    out = gzip.compress(raw, mtime=0)
    out = out[: max(10, len(out) // 2)]
elif mode == "bz2":
    import bz2

    out = bz2.compress(raw)
else:
    raise SystemExit("bad compress")
sys.stdout.buffer.write(out)

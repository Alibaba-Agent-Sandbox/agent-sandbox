#!/usr/bin/env bash
# Regenerate every machine inventory of the completeness review into ./out (offline, path independent).
# Usage: ORIG_REPO=/path/to/original-repo ORACLE_VENV=/path/to/venv bash run_all.sh   (needs `npm run build` for the click tree)
# Skips the oracle-dependent steps cleanly when ORIG_REPO / ORACLE_VENV are not set.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
cli="$(cd "$here/../../.." && pwd)"
out="$here/out"
mkdir -p "$out"
home="$(mktemp -d)"
export HOME="$home" EBX_NO_KEYCHAIN=1 NO_COLOR=1
unset PYTHONPATH

if [ -z "${ORIG_REPO:-}" ] || [ ! -d "$ORIG_REPO/src" ]; then
  echo "SKIP: ORIG_REPO not set (original Python repo)"; exit 0
fi

tmp="$(mktemp -d)"
python3 "$here/py_inventory.py" "$ORIG_REPO/src" > "$tmp/py-inventory.json"
node "$here/ts_inventory.mjs" "$cli/src" > "$tmp/ts-inventory.json"
python3 "$here/cli_compare.py" "$tmp/py-inventory.json" "$tmp/ts-inventory.json" --json "$tmp/cli-compare.json" > "$out/cli-compare.txt"
python3 - "$tmp/cli-compare.json" "$out" <<'PY'
import json, sys
c = json.load(open(sys.argv[1])); out = sys.argv[2]
with open(out + "/literals-missing.tsv", "w") as f:
    for l in c["literals"]:
        f.write("\t".join([l["module"], str(l["line"]), l["kind"], l["context"], json.dumps(l["text"], ensure_ascii=False)]) + "\n")
with open(out + "/symbols-missing.tsv", "w") as f:
    for s in c["symbols"]:
        if s[3] != "present":
            f.write("\t".join(map(str, s)) + "\n")
with open(out + "/modules.tsv", "w") as f:
    for m in c["modules"]:
        f.write("\t".join(m) + "\n")
with open(out + "/relocated-literals.tsv", "w") as f:
    for l in c["relocated"]:
        f.write("\t".join([l["module"], str(l["line"]), json.dumps(l["text"], ensure_ascii=False)]) + "\n")
PY
python3 "$here/exit_sites.py" > "$out/exit-sites.txt" 2>&1
python3 "$here/split_files.py" > "$out/split-files.tsv"
python3 "$here/py_symbols_split.py" > "$out/sdk-symbols.txt" 2>&1
python3 "$here/py_test_bodies.py" > "$out/test-bodies.txt" 2>&1
python3 "$here/ledger_param_check.py" > "$out/ledger-params.txt" 2>&1
if [ -n "${ORACLE_VENV:-}" ] && [ -f "$cli/dist/cli/main.js" ]; then
  python3 "$here/click_tree.py" > "$tmp/click-py.json"
  node "$here/click_tree.mjs" > "$tmp/click-node.json"
  python3 "$here/click_tree_diff.py" "$tmp/click-py.json" "$tmp/click-node.json" | tee "$out/click-diff.txt"
fi
python3 "$here/doc_paths.py" "$cli" > "$out/doc-paths-cli.txt"
echo "done: $out"

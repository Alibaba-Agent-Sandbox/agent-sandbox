#!/usr/bin/env bash
# Provider-plugin E2E for the ebx CLI: install the reference plugins from python-sdk/examples/providers and drive
# real sandboxes through them.
#
#   e2e/providers/run.sh [all|opensandbox|local-process|e2b-compatible|offline]...
#
# Environment (nothing is read from your real HOME; secrets are never printed):
#   EBX_BIN         command that runs the CLI (default: tsx src/bin/ebx.ts in a dev checkout, else node dist/bin/ebx.js; set it to test a built or installed binary)
#   PROVIDERS_DIR   directory holding the example plugins (default: ../python-sdk/examples/providers)
#   OSB_URL         OpenSandbox server (default http://127.0.0.1:8080); start one with python-sdk/e2e/opensandbox/local-up.sh
#   OSB_KEY         its API key (default local-dev-key, the throwaway local-up.sh key)
#   OSB_IMAGE       image for the sandbox (default python:3.12-slim)
#   E2B_API_KEY, E2B_API_URL, E2B_DOMAIN   enable the live e2b-compatible variant (otherwise it is reported as SKIP)
#
# Exit code 0 when every executed step passed; skipped variants are listed but do not fail the run.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "$HERE/../.." && pwd)"
PROVIDERS_DIR="${PROVIDERS_DIR:-$CLI_ROOT/../python-sdk/examples/providers}"
OSB_URL="${OSB_URL:-http://127.0.0.1:8080}"
OSB_KEY="${OSB_KEY:-local-dev-key}"
OSB_IMAGE="${OSB_IMAGE:-python:3.12-slim}"

if [ -z "${EBX_BIN:-}" ]; then
  if [ -x "$CLI_ROOT/node_modules/.bin/tsx" ]; then EBX_BIN="$CLI_ROOT/node_modules/.bin/tsx $CLI_ROOT/src/bin/ebx.ts"; else EBX_BIN="node $CLI_ROOT/dist/bin/ebx.js"; fi
fi

WORK="$(mktemp -d)"
PASS=0; FAIL=0; SKIP=()
KEEP_IDS=()

cleanup() {
  for ref in "${KEEP_IDS[@]:-}"; do
    [ -n "$ref" ] && ebx kill "$ref" --yes >/dev/null 2>&1
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

fresh_home() { rm -rf "$WORK/home"; mkdir -p "$WORK/home" "$WORK/cwd"; }

# ebx ARGS...: runs the CLI in the throwaway HOME/cwd with a scrubbed environment; stdout in $OUT, stderr in $ERR, status in $RC.
ebx() {
  OUT="$(cd "$WORK/cwd" && env -i PATH="$PATH" HOME="$WORK/home" LANG=C.UTF-8 NO_COLOR=1 TERM=dumb "${EXTRA_ENV[@]}" $EBX_BIN "$@" 2>"$WORK/err")"
  RC=$?
  ERR="$(cat "$WORK/err")"
  return $RC
}
EXTRA_ENV=()

step() { STEP="$1"; }
ok() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$STEP"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n        %s\n' "$STEP" "$1"; printf '        exit=%s stdout=%s stderr=%s\n' "$RC" "$(printf %s "$OUT" | head -c 300 | tr '\n' ' ')" "$(printf %s "$ERR" | head -c 300 | tr '\n' ' ')"; }
expect_rc() { if [ "$RC" = "$1" ]; then return 0; else bad "expected exit $1"; return 1; fi; }
expect_out() { if printf %s "$OUT$ERR" | grep -qF -- "$1"; then return 0; else bad "expected output to contain: $1"; return 1; fi; }
expect_not_out() { if printf %s "$OUT$ERR" | grep -qF -- "$1"; then bad "output must not contain: $1"; return 1; else return 0; fi; }
json_get() { printf %s "$OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

section() { printf '\n== %s\n' "$1"; }
skip() { SKIP+=("$1: $2"); printf '\n== %s\n  SKIP  %s\n' "$1" "$2"; }

# --- shared sandbox round trip (create, info, exec, files, list, kill) -------------------------------------------------
roundtrip() {
  local provider_args=("$@")
  step "create"
  ebx --json "${provider_args[@]}" create --template "${CREATE_TEMPLATE:-base}"
  expect_rc 0 || return
  local sid; sid="$(json_get "d.get('ID') or d.get('sandbox_id')")"
  local ref="$sid"
  [ -n "${PROVIDER_ID:-}" ] && ref="$PROVIDER_ID:$sid"
  if [ -z "$sid" ]; then bad "no sandbox id in the JSON output"; return; fi
  KEEP_IDS+=("$ref")
  ok

  step "list shows the sandbox"
  ebx --json "${provider_args[@]}" list; expect_rc 0 && expect_out "$sid" && ok

  step "exec echo"
  ebx "${provider_args[@]}" exec "$ref" "echo e2e-hello"; expect_rc 0 && expect_out "e2e-hello" && ok

  step "exec propagates the exit code"
  ebx "${provider_args[@]}" exec "$ref" "sh -c 'exit 3'"; expect_rc 3 && ok

  step "upload then download round trip"
  printf 'payload-%s\n' "$$" > "$WORK/cwd/up.txt"
  ebx "${provider_args[@]}" upload "$ref" up.txt /tmp/up.txt; expect_rc 0 || return
  ebx "${provider_args[@]}" download "$ref" /tmp/up.txt down.txt; expect_rc 0 || return
  if cmp -s "$WORK/cwd/up.txt" "$WORK/cwd/down.txt"; then ok; else bad "downloaded file differs"; fi

  step "sandbox files list"
  ebx "${provider_args[@]}" sandbox files list "$ref" --path /tmp; expect_rc 0 && expect_out "up.txt" && ok

  step "kill"
  ebx "${provider_args[@]}" kill "$ref" --yes; expect_rc 0 || return
  KEEP_IDS=("${KEEP_IDS[@]/$ref}")
  ok

  step "killed sandbox is gone (exit 4)"
  ebx "${provider_args[@]}" exec "$ref" "true"; expect_rc 4 && ok
}

# --- offline: install/list/doctor/default/uninstall behaviour that needs no backend ----------------------------------
suite_offline() {
  section "offline: install, trust and selection"
  fresh_home; EXTRA_ENV=()
  local src="$PROVIDERS_DIR/local-process"
  if [ ! -d "$src" ]; then skip offline "plugin examples not found in $PROVIDERS_DIR"; return; fi

  step "provider group is hidden from root help until a plugin is installed"
  ebx --help; expect_rc 0 && expect_not_out "provider" && ok

  step "non-interactive install without --yes is refused (exit 2)"
  ebx provider install "$src"; expect_rc 2 && expect_out "E8012" && ok

  step "install from a path"
  ebx provider install "$src" --yes; expect_rc 0 && expect_out "local-process" && ok

  step "provider group is visible after the first install"
  ebx --help; expect_rc 0 && expect_out "provider" && ok

  step "list --json has the built-in and the installed plugin"
  ebx --json provider list; expect_rc 0 && expect_out "alicloud-express" && expect_out "local-process" && ok

  step "reinstall conflicts (E8003, exit 1) unless --force"
  ebx provider install "$src" --yes; expect_rc 1 && expect_out "E8003" || return
  ebx provider install "$src" --yes --force; expect_rc 0 && ok

  step "doctor"
  ebx provider doctor local-process; expect_rc 0 && expect_out "handshake" && ok

  step "info shows the manifest"
  ebx provider info local-process; expect_rc 0 && expect_out "exec.run" && ok

  step "unknown provider (E8001, exit 4)"
  ebx --provider nope list; expect_rc 4 && expect_out "E8001" && ok

  step "secret options are refused on the command line (E8002, exit 2)"
  ebx --provider local-process --opt token=abc list; expect_rc 2 && expect_out "E8002" && expect_not_out "abc" && ok

  step "provider default, persisted and reverted"
  ebx provider default local-process; expect_rc 0 || return
  ebx provider default; expect_out "local-process" || return
  ebx provider default --unset; expect_rc 0 && ok

  step "reference mismatch (E8030, exit 2)"
  ebx --provider alicloud-express kill local-process:sbx-1 --yes; expect_rc 2 && expect_out "E8030" && ok

  step "git install: unpinned is refused, pinned works (local git repo)"
  local repo="$WORK/plugin-repo"; rm -rf "$repo"; cp -r "$src" "$repo"
  ( cd "$repo" && git init -q . && git add -A && git -c user.name=e2e -c user.email=e2e@example.invalid commit -q -m plugin ) || { bad "git setup failed"; return; }
  local sha; sha="$(git -C "$repo" rev-parse HEAD)"
  ebx provider uninstall local-process --yes >/dev/null 2>&1
  ebx provider install "file://$repo" --allow-insecure-transport --yes; expect_rc 2 || { [ "$RC" = 1 ] || bad "unpinned git install should be refused"; }
  ebx provider install "file://$repo" --allow-insecure-transport --ref "$sha" --yes; expect_rc 0 && expect_out "local-process" && ok

  step "tampering is detected by doctor (E8011)"
  printf '# tampered\n' >> "$WORK/home/.ebx/providers/local-process/provider.py"
  ebx provider doctor local-process; expect_rc 1 && ok

  step "uninstall"
  ebx provider uninstall local-process --yes --purge; expect_rc 0 && ok
}

suite_local_process() {
  section "local-process (python3 stdlib plugin, no network)"
  local src="$PROVIDERS_DIR/local-process"
  if [ ! -d "$src" ] || ! command -v python3 >/dev/null; then skip local-process "plugin or python3 missing"; return; fi
  fresh_home; EXTRA_ENV=()
  ebx provider install "$src" --yes >/dev/null || { step "install"; bad "install failed"; return; }
  PROVIDER_ID=local-process CREATE_TEMPLATE=base roundtrip --provider local-process
  PROVIDER_ID=
}

suite_opensandbox() {
  section "opensandbox (live local server at $OSB_URL)"
  local src="$PROVIDERS_DIR/opensandbox"
  if [ ! -d "$src" ] || ! command -v node >/dev/null; then skip opensandbox "plugin or node missing"; return; fi
  if ! curl -fsS -m 5 "$OSB_URL/health" >/dev/null 2>&1; then
    skip opensandbox "no OpenSandbox server at $OSB_URL (run python-sdk/e2e/opensandbox/local-up.sh)"; return
  fi
  fresh_home
  EXTRA_ENV=("EBX_OPENSANDBOX_BASE_URL=$OSB_URL" "EBX_OPENSANDBOX_API_KEY=$OSB_KEY")

  step "install from a path (consent screen shows the manifest)"
  ebx provider install "$src" --yes; expect_rc 0 && expect_out "opensandbox" && ok

  step "doctor reaches the handshake"
  ebx provider doctor opensandbox; expect_rc 0 && expect_out "handshake" && ok

  step "the API key never appears in provider config output"
  ebx provider config opensandbox list; expect_rc 0 && expect_not_out "$OSB_KEY" && ok

  step "provider default opensandbox"
  ebx provider default opensandbox; expect_rc 0 && ok

  # Default provider selected: no --provider flag needed, ids are printed qualified.
  PROVIDER_ID=opensandbox CREATE_TEMPLATE="$OSB_IMAGE" roundtrip
  PROVIDER_ID=

  step "explicit --provider with the default unset"
  ebx provider default --unset >/dev/null; ebx --json --provider opensandbox create --template "$OSB_IMAGE"; expect_rc 0 || return
  local sid; sid="$(json_get "d.get('ID')")"; KEEP_IDS+=("opensandbox:$sid")
  ebx --provider opensandbox exec "opensandbox:$sid" "echo via-flag"; expect_rc 0 && expect_out "via-flag" || return
  ebx kill "opensandbox:$sid" --yes; expect_rc 0 && { KEEP_IDS=("${KEEP_IDS[@]/opensandbox:$sid}"); ok; }

  step "install from a local git repo pinned to a commit"
  local repo="$WORK/opensandbox-repo"; rm -rf "$repo"; cp -r "$src" "$repo"
  ( cd "$repo" && git init -q . && git add -A && git -c user.name=e2e -c user.email=e2e@example.invalid commit -q -m plugin ) || { bad "git setup failed"; return; }
  ebx provider uninstall opensandbox --yes >/dev/null 2>&1
  ebx provider install "file://$repo" --allow-insecure-transport --ref "$(git -C "$repo" rev-parse HEAD)" --yes; expect_rc 0 || return
  ebx provider doctor opensandbox; expect_rc 0 || return
  ebx --json --provider opensandbox create --template "$OSB_IMAGE"; expect_rc 0 || return
  sid="$(json_get "d.get('ID')")"; KEEP_IDS+=("opensandbox:$sid")
  ebx --provider opensandbox exec "opensandbox:$sid" "echo from-git"; expect_rc 0 && expect_out "from-git" || return
  ebx kill "opensandbox:$sid" --yes; expect_rc 0 && { KEEP_IDS=("${KEEP_IDS[@]/opensandbox:$sid}"); ok; }

  step "provider test (contract suite)"
  ebx provider test opensandbox -o "base_url=$OSB_URL"; if [ "$RC" = 0 ]; then ok; else bad "contract suite failed"; fi
}

suite_e2b_compatible() {
  section "e2b-compatible (REST plugin on the live E2B endpoint)"
  local src="$PROVIDERS_DIR/e2b-compatible"
  [ -d "$src" ] || { skip e2b-compatible "plugin examples not found"; return; }
  fresh_home
  if [ -z "${E2B_API_KEY:-}" ]; then
    EXTRA_ENV=()
    step "install and info work without credentials"
    ebx provider install "$src" --yes; expect_rc 0 && ok
    skip e2b-compatible "live part needs E2B_API_KEY (and E2B_API_URL / E2B_DOMAIN)"
    return
  fi
  EXTRA_ENV=("E2B_API_KEY=$E2B_API_KEY")
  [ -n "${E2B_API_URL:-}" ] && EXTRA_ENV+=("E2B_API_URL=$E2B_API_URL")
  [ -n "${E2B_DOMAIN:-}" ] && EXTRA_ENV+=("E2B_DOMAIN=$E2B_DOMAIN")

  step "install (consent shows that sandbox_api_key is inherited)"
  ebx provider install "$src" --yes; expect_rc 0 && ok

  step "doctor"
  ebx provider doctor e2b-compatible; expect_rc 0 && ok

  step "the plugin works on the same account as the built-in provider"
  ebx --json list; expect_rc 0 || return
  ok

  PROVIDER_ID=e2b-compatible CREATE_TEMPLATE="${E2B_TEMPLATE:-base}" roundtrip --provider e2b-compatible
  PROVIDER_ID=
}

targets=("$@"); [ ${#targets[@]} -eq 0 ] && targets=(all)
for t in "${targets[@]}"; do
  case "$t" in
    all) suite_offline; suite_local_process; suite_opensandbox; suite_e2b_compatible ;;
    offline) suite_offline ;;
    local-process) suite_local_process ;;
    opensandbox) suite_opensandbox ;;
    e2b-compatible) suite_e2b_compatible ;;
    *) echo "unknown target: $t" >&2; exit 64 ;;
  esac
done

printf '\n%s passed, %s failed, %s skipped\n' "$PASS" "$FAIL" "${#SKIP[@]}"
for s in "${SKIP[@]:-}"; do [ -n "$s" ] && printf '  skipped %s\n' "$s"; done
[ "$FAIL" -eq 0 ]

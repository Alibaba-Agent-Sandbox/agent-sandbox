#!/usr/bin/env bash
# Build catalog templates without creating Sandbox instances. Retain artifacts and journals.
# Environment: ABX_BIN, ACR_NAMESPACE (required), REGION, TAG, WORK_DIR, RESULTS_FILE,
# EXAMPLES_TEMPLATES_DIR (optional local source fixtures).
set -euo pipefail
ABX_BIN="${ABX_BIN:-abx}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLES_TEMPLATES_DIR="${EXAMPLES_TEMPLATES_DIR:-$ROOT/../python-sdk/examples/templates}"
REGION="${REGION:-cn-hangzhou}"
TAG="${TAG:-dev}"
: "${ACR_NAMESPACE:?set ACR_NAMESPACE to your ACR namespace}"
WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/abx-template-builds.XXXXXX")}"
RESULTS_FILE="${RESULTS_FILE:-$WORK_DIR/results.txt}"
ORDER=("$@")
if [[ ${#ORDER[@]} -eq 0 ]]; then
  ORDER=(python-hello node-web browser-automation claude-code codex deepseek-harness hermes-agent openclaw qoder qwen-code)
fi
printf 'Template | ExitCode | Artifact\n' > "$RESULTS_FILE"
failed=0
for name in "${ORDER[@]}"; do
  if [[ -d "$EXAMPLES_TEMPLATES_DIR/$name" ]]; then
    source="$EXAMPLES_TEMPLATES_DIR/$name"
  else
    source="$WORK_DIR/$name-source"
    "$ABX_BIN" --provider alicloud-express --opt "region=$REGION" \
      template init "$source" --from "$name" --yes
  fi
  artifact="$WORK_DIR/$name-artifact"
  "$ABX_BIN" --provider alicloud-express --opt "region=$REGION" \
    template build "$source" --out "$artifact" --alias "$name-$TAG" --yes && result=0 || result=$?
  printf '%s | %s | %s\n' "$name" "$result" "$artifact" >> "$RESULTS_FILE"
  if [[ "$result" -ne 0 ]]; then failed=1; fi
done
cat "$RESULTS_FILE"
exit "$failed"

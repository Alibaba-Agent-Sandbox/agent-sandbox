#!/usr/bin/env bash
# Deploy all 10 templates one by one via CLI deploy
# Templates live in the SSOT repo alibaba-agent-sandbox/awesome-templates; the python-hello
# offline fixture lives in the python-sdk repository (examples/templates/).
# Non-fixture templates are fetched into the local cache first via
# `abx template install <name> --download-only`.
# Usage: bash scripts/deploy_all_templates.sh
# Environment: ABX_BIN overrides the abx executable (default: abx);
# ACR_NAMESPACE (required) is your ACR namespace, TAG the image tag (default: dev),
# REGION the region (default: cn-hangzhou), RESULTS_FILE the summary file
# (default: a fresh mktemp file);
# EXAMPLES_TEMPLATES_DIR overrides the fixture directory
# (default: ../python-sdk/examples/templates).
set -euo pipefail

ABX_BIN="${ABX_BIN:-abx}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLES_TEMPLATES_DIR="${EXAMPLES_TEMPLATES_DIR:-$ROOT/../python-sdk/examples/templates}"
REGION="${REGION:-cn-hangzhou}"
: "${ACR_NAMESPACE:?set ACR_NAMESPACE to your ACR namespace}"
ACR_NS="$ACR_NAMESPACE"
TAG="${TAG:-dev}"
CATALOG_CACHE="$HOME/.abx/templates/alibaba-agent-sandbox/awesome-templates/default"

# Template name -> cpu memory
declare -A TEMPLATES
TEMPLATES=(
  ["python-hello"]="2 2048"
  ["node-web"]="1 2048"
  ["browser-automation"]="2 4096"
  ["claude-code"]="2 4096"
  ["codex"]="2 4096"
  ["deepseek-harness"]="2 4096"
  ["hermes-agent"]="2 4096"
  ["openclaw"]="2 4096"
  ["qoder"]="2 4096"
  ["qwen-code"]="2 4096"
)

ORDER=(python-hello node-web browser-automation claude-code codex deepseek-harness hermes-agent openclaw qoder qwen-code)

RESULTS_FILE="${RESULTS_FILE:-$(mktemp "${TMPDIR:-/tmp}/abx_deploy_results.XXXXXX")}"
echo "Template | ExitCode | Status" > "$RESULTS_FILE"

for name in "${ORDER[@]}"; do
  read -r cpu mem <<< "${TEMPLATES[$name]}"
  echo ""
  echo "========================================="
  echo "Deploying: $name (cpu=$cpu, memory=$mem)"
  echo "========================================="

  # python-hello ships in the python-sdk repo as an offline fixture; everything
  # else is pulled from the catalog repo (single source of truth) into the cache.
  if [[ -d "$EXAMPLES_TEMPLATES_DIR/$name" ]]; then
    SRC="$EXAMPLES_TEMPLATES_DIR/$name"
  else
    echo "Fetching $name from alibaba-agent-sandbox/awesome-templates..."
    "$ABX_BIN" --provider alicloud-express template install "$name" --region "$REGION" --download-only
    SRC="$CATALOG_CACHE/$name"
  fi

  START_TIME=$(date +%s)
  
  "$ABX_BIN" --provider alicloud-express template deploy \
    "$SRC" --region "$REGION" \
    --acr-namespace "$ACR_NS" \
    --acr-repo "$name" \
    --tag "$TAG" \
    --cpu "$cpu" \
    --memory "$mem" 2>&1 && EXIT_CODE=$? || EXIT_CODE=$?
  
  END_TIME=$(date +%s)
  ELAPSED=$((END_TIME - START_TIME))
  
  echo "$name | exit=$EXIT_CODE | elapsed=${ELAPSED}s" >> "$RESULTS_FILE"
  echo "--- $name completed in ${ELAPSED}s with exit code $EXIT_CODE ---"
done

echo ""
echo "========================================="
echo "DEPLOYMENT SUMMARY"
echo "========================================="
cat "$RESULTS_FILE"

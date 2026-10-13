#!/bin/bash
# Deploy the hermes-agent template from the SSOT catalog repo
# (alibaba-agent-sandbox/awesome-templates); the python-hello fixture lives in the python-sdk repository.
# Environment: ABX_BIN (abx executable, default: abx), ACR_NAMESPACE (required, your ACR
# namespace), TAG (image tag, default: dev), REGION (default: cn-hangzhou).
set -euo pipefail
ABX_BIN="${ABX_BIN:-abx}"
REGION="${REGION:-cn-hangzhou}"
TAG="${TAG:-dev}"
: "${ACR_NAMESPACE:?set ACR_NAMESPACE to your ACR namespace}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
echo "Fetching hermes-agent from alibaba-agent-sandbox/awesome-templates..."
"$ABX_BIN" --region "$REGION" \
    template install hermes-agent --download-only
echo "Starting hermes-agent build..."
"$ABX_BIN" --region "$REGION" \
    template deploy "$HOME/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/hermes-agent" \
    --acr-namespace "$ACR_NAMESPACE" --acr-repo hermes-agent \
    --tag "$TAG" --cpu 2 --memory 4096 --official-api
echo "Exit code: $?"

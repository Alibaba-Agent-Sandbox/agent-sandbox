#!/bin/bash
# Deploy the hermes-agent template from the SSOT catalog repo
# (Easy-Sandbox/awesome-templates); the python-hello fixture lives in the python-sdk repository.
# Environment: EBX_BIN (ebx executable, default: ebx), ACR_NAMESPACE (required, your ACR
# namespace), TAG (image tag, default: dev), REGION (default: cn-hangzhou).
set -euo pipefail
EBX_BIN="${EBX_BIN:-ebx}"
REGION="${REGION:-cn-hangzhou}"
TAG="${TAG:-dev}"
: "${ACR_NAMESPACE:?set ACR_NAMESPACE to your ACR namespace}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
echo "Fetching hermes-agent from Easy-Sandbox/awesome-templates..."
"$EBX_BIN" --region "$REGION" \
    template install hermes-agent --download-only
echo "Starting hermes-agent build..."
"$EBX_BIN" --region "$REGION" \
    template deploy "$HOME/.ebx/templates/Easy-Sandbox/awesome-templates/default/hermes-agent" \
    --acr-namespace "$ACR_NAMESPACE" --acr-repo hermes-agent \
    --tag "$TAG" --cpu 2 --memory 4096 --official-api
echo "Exit code: $?"

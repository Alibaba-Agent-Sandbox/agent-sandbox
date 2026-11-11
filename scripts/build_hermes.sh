#!/usr/bin/env bash
# Fetch and build hermes-agent without starting a sandbox. Retain the artifact for deploy/cleanup.
# Environment: ABX_BIN (default abx), ACR_NAMESPACE (required), REGION, TAG, WORK_DIR.
set -euo pipefail
ABX_BIN="${ABX_BIN:-abx}"
REGION="${REGION:-cn-hangzhou}"
TAG="${TAG:-dev}"
: "${ACR_NAMESPACE:?set ACR_NAMESPACE to your ACR namespace}"
WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/abx-hermes-build.XXXXXX")}"
# Keep configuration overrides transient; template.yaml owns runtime resources.
"$ABX_BIN" --provider alicloud-express --opt "region=$REGION" \
  template init "$WORK_DIR/source" --from hermes-agent --yes
"$ABX_BIN" --provider alicloud-express --opt "region=$REGION" \
  template build "$WORK_DIR/source" --out "$WORK_DIR/artifact" --alias "hermes-agent-$TAG" --yes
printf 'Build artifact: %s\n' "$WORK_DIR/artifact"

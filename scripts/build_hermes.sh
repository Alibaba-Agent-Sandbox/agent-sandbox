#!/usr/bin/env bash
# Fetch hermes-agent and build its local Docker image without cloud registration.
# Environment: ABX_BIN (default abx), REGION, WORK_DIR.
set -euo pipefail
ABX_BIN="${ABX_BIN:-abx}"
REGION="${REGION:-cn-hangzhou}"
WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/abx-hermes-build.XXXXXX")}"
# Keep configuration overrides transient; template.yaml owns runtime resources.
"$ABX_BIN" --provider alicloud-express --opt "region=$REGION" \
  template init "$WORK_DIR/source" --from hermes-agent --yes
"$ABX_BIN" --provider alicloud-express --opt "region=$REGION" \
  template build "$WORK_DIR/source"
printf 'Template source: %s\n' "$WORK_DIR/source"

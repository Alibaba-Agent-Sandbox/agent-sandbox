#!/usr/bin/env bash
# Build the remaining catalog templates through the shared source/build helper.
# Resource sizes belong in each template manifest. This helper only builds local images.
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/deploy_all_templates.sh" hermes-agent openclaw qoder qwen-code

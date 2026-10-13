#!/bin/bash
# Deploy remaining templates using stepped approach to avoid OOM
# Each step is a separate process
# Templates live in the SSOT repo alibaba-agent-sandbox/awesome-templates (this repo keeps
# only the python-hello fixture); they are fetched into the cache on demand.
#
# The CLI steps call the `abx` executable (ABX_BIN overrides, default: abx).  The
# docker-login / official-template steps use the Python SDK API directly, so they
# need a Python with `agent-sandbox` installed (PYTHON overrides, default: python3).
# The wheel to inject is built from the python-sdk repository (WHEEL overrides;
# default: the newest dist/agent_sandbox-*.whl there).
# Other environment: ACR_NAMESPACE (required, your ACR namespace), TAG (image tag,
# default: dev), ACR_REGISTRY / REGION (default: cn-hangzhou), DOCKER_PLATFORM
# (default: linux/amd64, the sandbox runtime architecture), RESULTS_FILE (summary
# file, default: a fresh mktemp file).
set -euo pipefail

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ABX_BIN="${ABX_BIN:-abx}"
PYTHON="${PYTHON:-python3}"
EXAMPLES_TEMPLATES_DIR="${EXAMPLES_TEMPLATES_DIR:-$WORKDIR/../python-sdk/examples/templates}"
TAG="${TAG:-dev}"
: "${ACR_NAMESPACE:?set ACR_NAMESPACE to your ACR namespace}"
ACR_NS="$ACR_NAMESPACE"
REGION="${REGION:-cn-hangzhou}"
ACR_REGISTRY="${ACR_REGISTRY:-registry.$REGION.aliyuncs.com}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
RESULTS_FILE="${RESULTS_FILE:-$(mktemp "${TMPDIR:-/tmp}/abx_deploy_results.XXXXXX")}"
if [ -z "${WHEEL:-}" ]; then
    WHEEL="$(ls -t "$WORKDIR"/../python-sdk/dist/agent_sandbox-*.whl 2>/dev/null | head -n 1 || true)"
fi
[ -f "${WHEEL:-}" ] || { echo "No wheel found; build one in the python-sdk repo or set WHEEL=<path>" >&2; exit 1; }
CATALOG_CACHE="$HOME/.abx/templates/alibaba-agent-sandbox/awesome-templates/default"

resolve_template_dir() {
    local name="$1"
    if [ -d "$EXAMPLES_TEMPLATES_DIR/$name" ]; then
        echo "$EXAMPLES_TEMPLATES_DIR/$name"
        return
    fi
    if [ ! -d "$CATALOG_CACHE/$name" ]; then
        echo "Fetching $name from alibaba-agent-sandbox/awesome-templates..." >&2
        "$ABX_BIN" --region "$REGION" \
            template install "$name" --download-only >&2
    fi
    echo "$CATALOG_CACHE/$name"
}

deploy_template() {
    local name="$1"
    local cpu="$2"
    local mem="$3"
    local alias="${4:-$name}"
    local tdir
    tdir="$(resolve_template_dir "$name")"
    local acr_ref="$ACR_REGISTRY/$ACR_NS/$name:$TAG"

    echo ""
    echo "========================================="
    echo "Deploying: $name (alias=$alias, cpu=$cpu, memory=$mem)"
    echo "========================================="
    local start_ts=$(date +%s)

    # Step 1: Copy wheel
    cp "$WHEEL" "$tdir/"
    echo "[1/4] Wheel injected"

    # Step 2: Docker build
    echo "[2/4] Building Docker image..."
    docker build -t "$name:$TAG" --platform "$DOCKER_PLATFORM" "$tdir" 2>&1 | tail -5
    local build_exit=$?
    rm -f "$tdir/agent_sandbox-"*.whl
    if [ $build_exit -ne 0 ]; then
        echo "FAIL: Docker build failed for $name"
        echo "$name|FAIL|N/A|$acr_ref|docker-build-failed|$(($(date +%s)-start_ts))s" >> "$RESULTS_FILE"
        return 1
    fi
    echo "[2/4] Build OK"

    # Step 3: Tag + Login + Push to ACR
    echo "[3/4] Pushing to ACR..."
    docker tag "$name:$TAG" "$acr_ref"
    # Login via project code
    $PYTHON -c "
from agent_sandbox.api.docker_builder import DockerBuilder
b = DockerBuilder()
from agent_sandbox.transport.config import load_config
cfg = load_config(region='$REGION')
creds = b.login_acr_with_aksk('$ACR_REGISTRY', cfg.access_key_id, cfg.access_key_secret, region='$REGION')
print('ACR login OK, temp user:', creds.get('tempUserName', 'N/A')[:8] + '...')
" 2>&1
    docker push "$acr_ref" 2>&1 | tail -5
    if [ $? -ne 0 ]; then
        echo "FAIL: ACR push failed for $name"
        echo "$name|FAIL|N/A|$acr_ref|acr-push-failed|$(($(date +%s)-start_ts))s" >> "$RESULTS_FILE"
        return 1
    fi
    echo "[3/4] Push OK"

    # Step 4: Create/Update template via official API
    echo "[4/4] Creating/Updating template via official API..."
    $PYTHON -c "
from agent_sandbox.api.fc_template import create_official_template
from agent_sandbox.transport.config import load_config
from agent_sandbox.api.docker_builder import DockerBuilder

cfg = load_config(region='$REGION')
b = DockerBuilder()
creds = b.login_acr_with_aksk('$ACR_REGISTRY', cfg.access_key_id, cfg.access_key_secret, region='$REGION')

result = create_official_template(
    name='$alias',
    image='$acr_ref',
    access_key_id=cfg.access_key_id,
    access_key_secret=cfg.access_key_secret,
    region='$REGION',
    cpu=$cpu,
    memory_size=$mem,
    generation=1,
    envd_inject=True,
    registry_type='acr',
    registry_username=creds.get('tempUserName'),
    registry_password=creds.get('authorizationToken'),
)
print(f\"TemplateID={result.get('templateID')}\")
print(f\"StatusCode={result.get('statusCode')}\")
print(f\"Message={result.get('message')}\")
" 2>&1
    local api_exit=$?
    local end_ts=$(date +%s)
    local elapsed=$((end_ts - start_ts))

    if [ $api_exit -ne 0 ]; then
        echo "FAIL: API call failed for $name"
        echo "$name|FAIL|N/A|$acr_ref|api-call-failed|${elapsed}s" >> "$RESULTS_FILE"
        return 1
    fi
    echo "--- $name completed in ${elapsed}s ---"
}

# Clear results
echo "Template|Result|TemplateID|ACR_Ref|Status|Time" > "$RESULTS_FILE"

# Deploy remaining templates
deploy_template "hermes-agent" 2 4096
deploy_template "openclaw" 2 4096
deploy_template "qoder" 2 4096
deploy_template "qwen-code" 2 4096

echo ""
echo "========================================="
echo "BATCH RESULTS"
echo "========================================="
cat "$RESULTS_FILE"

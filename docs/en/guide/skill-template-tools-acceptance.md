# Verify template, repository, preview and third-party tool workflows

These opt-in scenarios run against the configured real Express account. They create temporary resources and delete only the resources created by that run, including on failure. They do not prove every provider supports the same workflow.

Build the CLI with its lockfile (`npm ci && npm run build`). Supply the existing environment configuration: `ALICLOUD_ACCESS_KEY_ID`, `ALICLOUD_ACCESS_KEY_SECRET`, `ALIBABA_CLOUD_REGION_ID`, `E2B_API_KEY`, `E2B_API_URL` and `E2B_DOMAIN`. The Python scenario also needs a source-compatible `agent-sandbox-client` installed in its Python environment; follow the [SDK installation instructions](https://github.com/Alibaba-Agent-Sandbox/python-sdk#installation). Account credentials stay outside the sandbox and evidence files.

## OCI builds, business validation and template rollback

Select an existing ready generation-2 template whose OCI image and startup configuration you are authorized to reuse. The scenario reads its metadata and leaves that source unchanged. It refuses private registry configuration rather than copying credentials.

```bash
export ABX_SKILL_SOURCE_TEMPLATE_ID=REPLACE_ME
node e2e/skill-template-acceptance.mjs --output ./template-acceptance-new.json
```

`ABX_BIN` selects a different CLI build; otherwise the scenario uses this checkout's `dist/bin/abx.js`. `ABX_SKILL_RUN_PREFIX` optionally supplies a short lowercase resource-label prefix; the scenario adds a fresh random suffix.

The scenario authors valid spec-5 manifests with `provides: {}` because this fixture promises shell/file operations and no application service. It registers two immutable templates through the actual `--build steps` path, waits for readiness and creates sandboxes in order v1 → v2 → v1. Each sandbox must return its expected build-time version and the business result `385`. Returning to the retained v1 template proves rollback by explicit template selection. It separately builds a fixture that deliberately exits `42`; the platform must report an error and the client must diagnose that exit code. Registration alone never counts as successful delivery.

The final JSON records sandbox absence through independent HTTP404 reads and template absence through both official GetTemplate404 and the exact owned-name inventory. An unknown submission outcome fails acceptance and leaves its owned intent in the evidence for reconciliation. The test does not claim local Dockerfile validation, an external VM snapshot conversion, production traffic migration or automatic WarmPool/cache refresh.

## Repository application, expiring preview and third-party MCP

```bash
# Run in the python-sdk checkout:
python3 e2e/skill_tools_acceptance.py --output ./tools-acceptance-new.json
```

The [Python SDK owns this runner](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/e2e/skill_tools_acceptance.py). `ABX_SKILL_RUNTIME_TEMPLATE` optionally selects an existing runtime template; the default is the platform's `code-interpreter-v1` alias. Use a runtime with Python, Node.js, Git and outbound package/repository access.

This scenario clones the pinned Agent Sandbox template repository commit, checks the dependency-free Node application, starts it and verifies its exact HTTP response. A small application proxy issues a preview valid for20 seconds. External requests must return200 for the valid signature and403 for an absent, modified or expired signature. This is application-level HMAC authentication and expiry. It is not a provider gateway-native signed-URL claim. The sandbox is created with `secure=False` so the external browser can reach that application gate; the non-sensitive sample application is temporary and the sandbox is deleted after verification.

The same sandbox installs the real npm filesystem MCP server at2026.7.10, performs MCP initialization and tool discovery, and calls `read_file` on an allowed fixture directory. The response must contain the independently expected business result `385`. It then updates to2026.8.31 and repeats the protocol/tool check, reads server logs and removes the packages, data and processes. This particular third-party server needs no external credentials; credential-requiring tools need a separate acceptance case. Third-party Skills and every other MCP package are not covered by this one fixture.

Use a new evidence filename for each run. The scenarios never overwrite an existing receipt. Inspect every failed or blocked check and the independent cleanup result before reporting completion. A passing fixture establishes only the recorded time, provider and workflow scope.

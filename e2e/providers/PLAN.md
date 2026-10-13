# Provider end-to-end plan

[简体中文](PLAN.zh-CN.md)

One plan covers every provider, including OpenSandbox. A tier that cannot run is reported as skip with a reason. It is not a pass.

The same table is the contract for `cli/e2e`, `python-sdk/e2e`, and [awesome-providers](https://github.com/alibaba-agent-sandbox/awesome-providers).

| Tier | What it proves | Command | Needs |
|---|---|---|---|
| T0 | The plugin's own unit and mock tests | `node tests/run.mjs` inside the provider directory | Node >= 20 |
| T1 | Install, consent, pin, tamper, doctor, uninstall. No sandbox is created | `cli/e2e/providers/run.sh offline` and `python-sdk/e2e/opensandbox/provider_install_e2e.py` | git, Node, the SDK on `PYTHONPATH` |
| T2 | A provider that needs no cloud: create, exec, files, kill through `abx` | `cli/e2e/providers/run.sh local-process` | Python 3 |
| T3 | The catalog spelling users type: `owner/repo//subdir` | `cli/e2e/providers/run.sh catalog` | git and GitHub |
| T4 | A real OpenSandbox server: CLI round trip and SDK `Sandbox.create(provider="opensandbox")` | `local-up.sh up`, then `run.sh opensandbox` and `provider_e2e.py` | Docker, the local server on port 8080 |
| T5 | The built-in Alibaba Cloud provider on the real platform | `npm run e2e` in `cli/`, `make e2e` in `python-sdk/` | cloud credentials |

T0–T3 do not need a cloud account. T4 does not need Alibaba Cloud. T5 does not install a third-party plugin.

## Rules

- Each run uses a throwaway `HOME`. The real `~/.abx` is not read or written.
- Secrets are passed to the child process and are not printed. `provider config list` must not echo an API key.
- A missing feature is a successful `E8004`, not a crash and not a skipped assertion.
- `abx create "a sentence"` is not a provider test. It runs the built-in template pipeline first. Provider tests use `abx --provider <id> create --template <image-or-name>`.
- Cleanup kills every sandbox the run created. It does not use `kill --all`.
- The plugin source under test for OpenSandbox is the catalog checkout (`ABX_AWESOME_PROVIDERS` or a clone). It is not a copy inside the SDK.

## What a new provider adds

1. T0 in its own directory.
2. A row in its README: works, partial, E8004.
3. T1 by installing that directory.
4. T4 or T5 only for the backend that provider actually calls.

## Commands

```bash
# T0
cd opensandbox && node tests/run.mjs

# T1–T4, from cli/
e2e/providers/run.sh offline catalog local-process
ABX_AWESOME_PROVIDERS=/path/to/awesome-providers e2e/providers/run.sh opensandbox

# T4, from python-sdk/e2e/opensandbox/
./local-up.sh up && eval "$(./local-up.sh env)"
ABX_AWESOME_PROVIDERS=/path/to/awesome-providers python3 provider_e2e.py
python3 provider_install_e2e.py
```

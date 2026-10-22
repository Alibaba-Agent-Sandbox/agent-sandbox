# Current development API

The project keeps one current API. Old project interfaces, import aliases, migration commands and version fallbacks are removed without compatibility wrappers.

- Provider source preparation uses `templates.build` and `buildTemplateManager(ctx).prepareProject`. E2B and CubeSandbox image-registration helpers are internal to that path.
- Express template operations use the official FCSandbox API. `--legacy-api`, the API selector flags and the old REST template manager are removed.
- CLI settings use `sandbox_api_key`, `sandbox_base_url`, `sandbox_domain` and provider-owned keys. There is no `config check`, `config migrate`, `--legacy-names`, flat TOML fallback or old LLM plaintext fallback.
- Python provider extensions use `ProviderSandbox` and canonical `sandbox_*` arguments. Import backend implementations from their owning provider modules. Standard `Sandbox` and `AsyncSandbox` retain the current pinned upstream behavior contract.
- Files on the sandbox server use `/files/upload-stream` and `/files/download-stream`. The old transfer routes and client methods are removed. Authentication uses one policy-token engine; an explicit token policy is authoritative over the convenience server-token environment variable.
- Port addressing comes from the selected provider. Remote standalone server clients supply an explicit `pty_url`; localhost retains the documented PTY port.
- Provider catalog metadata accepts only schema version 3. Every template must declare its supported specification; `--all` checks every template.

Historical engineering evidence is retained as evidence of its original revision. It does not enable removed APIs.

Sandbox text output uses provider-qualified identifiers for every provider. JSON includes provider identity. Template indexes must explicitly declare the supported schema version.

Configuration exports use one `storage` descriptor. Inert `max_retries` and `retry_base_delay` fields and the duplicate GlobalConfig model are removed; the retry utility remains an explicit opt-in helper. Secrets stored by the environment-file contract are not loaded from plaintext TOML.

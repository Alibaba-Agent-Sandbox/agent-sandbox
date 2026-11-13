# Runtime environment and authentication

Host configuration, creation-time environment, per-command environment and an already running application's state are separate inputs.

```bash
abx sandbox create --template TEMPLATE_ID --env MODE=example --yes
abx sandbox exec --env MODE=one SANDBOX_ID -- printenv MODE
abx sandbox exec SANDBOX_ID -- sh -c 'printf "%s\n" "$HOME"'
```

The creation option is passed to the new runtime. The exec override affects that process and its children; it does not reconfigure an application already running elsewhere. Put exec options before the target: arguments after the Sandbox name/ID belong to the remote command. Use an explicit remote shell for expansion or pipelines and quote against local expansion.

Pass runtime inputs through the instance SDK/CLI or the selected template’s run.py. Follow that template’s README for model configuration and private application authentication. External clients need the same application token and any separate Provider endpoint headers.

Do not print secrets to inspect configuration. `abx sandbox system env ID` observes a newly started process, not an arbitrary existing server. An application's authenticated environment API, where enabled, affects that application's future children and cannot change its parent or siblings. Startup-cached values may require restarting the application or creating a new instance.

Use `abx sandbox delete SANDBOX_ID --yes` to remove the instance you own. Connecting to an existing instance does not transfer ownership. See [configuration](guided-configuration.md), [template startup](template-workflows.md), and the [Python environment guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/environment-variables.md).

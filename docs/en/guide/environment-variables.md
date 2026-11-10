# Runtime environment and authentication

Host configuration, creation-time environment, per-command environment and an already running application's state are separate inputs.

```bash
abx deploy ./project --name my-app --env MODE=example --yes
abx sandbox exec --env MODE=one my-app -- printenv MODE
abx sandbox exec my-app -- sh -c 'printf "%s\n" "$HOME"'
```

The deployment option is passed to the new runtime. The exec override affects that process and its children; it does not reconfigure an application already running elsewhere. Put exec options before the target: arguments after the Sandbox name/ID belong to the remote command. Use an explicit remote shell for expansion or pipelines and quote against local expansion.

Templates declare their runtime inputs. Only declared empty model fields inherit the saved model profile; explicit values and template defaults take priority. Normal application tokens are generated and saved automatically. External clients need the same application token and any separate Provider endpoint headers.

Do not print secrets to inspect configuration. `abx sandbox system env ID` observes a newly started process, not an arbitrary existing server. An application's authenticated environment API, where enabled, affects that application's future children and cannot change its parent or siblings. Startup-cached values may require a new deployment.

Use `abx delete my-app --yes` to remove the instance you own. Connecting to an existing instance does not transfer ownership. See [configuration](guided-configuration.md), [template startup](template-workflows.md), and the [Python environment guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/environment-variables.md).

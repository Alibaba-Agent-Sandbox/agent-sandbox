# Deploy a template and clean up

```bash
abx --provider PROVIDER deploy SOURCE --name my-app --yes
abx status my-app
abx logs my-app
abx delete my-app --yes
```

SOURCE can be a catalog name, local project or pinned Git reference. Use `--template-id TEMPLATE_ID` for an existing native template. Current source uses one command surface; an older release may differ, so inspect `abx --help`.

A Sandbox template prepares and creates one instance, runs declared startup/readiness and resolves every `provides` endpoint. Server v2 receives health and protocol discovery without executing business commands. Other HTTP protocols rely on declared readiness and are not automatically certified as application-compatible. Managed applications have a different lifecycle; see [managed applications](managed-applications.md).

Configure the Provider first. Express may need platform and registry permissions; OpenSandbox needs a reachable server, Docker, a writable image repository and runtime pull access. Official recipes resolve known base-image placeholders; `ABX_BASE_IMAGE_REGION` and `ABX_BASE_IMAGE_TAG` control image inputs only. Ordinary builds need no separate Python SDK checkout; use `ABX_SERVER_SDK_SOURCE` only to test a local development wheel deliberately.

Deployment `--build-timeout` bounds preparation, `--sandbox-timeout` sets instance lifetime and `--build-profile` selects a declared recipe. HTTP wait deadlines and termination of remote work are different; a timeout does not prove the remote side effect never happened.

Missing application tokens are generated and privately saved. External clients send application authentication separately from Provider endpoint authentication. Preserve proxy prefixes, signed queries and gateway headers.

After failure, inspect status and run `abx recover my-app` to observe incomplete work before cleanup. Network failures, 401/403 and server errors are not proof of absence. Source builds are not automatically replayed; inspect reported cleanup and retained-resource results.

For Docker download failures, check DNS, HTTPS, proxy, CA and MTU inside the build container; successful host requests do not prove container connectivity. Do not disable TLS validation or alter dependency pins to hide a network failure. Use `--verbose` for local diagnosis and treat application-produced logs as potentially private.

[Manifest and startup semantics](template-workflows.md) · [Build reuse](authoring-templates.md)

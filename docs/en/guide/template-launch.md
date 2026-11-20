# Deployment, logs and cleanup

```bash
abx deploy SOURCE --name my-app --plan
abx deploy SOURCE --name my-app --yes
abx status my-app
abx logs my-app --resource api
abx delete my-app --yes
```

SOURCE can be a catalog entry, local directory or pinned Git reference. Named-resource deployment supports Express Sandbox templates/static volumes and exact-version FC3 Serving components. Configure the existing cloud identity first; image builds also need Docker and a writable registry. The selected FC component keeps its own native runtime and resource constraints.

The same native component loader handles FC build, deploy, logs and remove. Component and shell diagnostics follow abx verbosity/quiet settings on stderr, with progress on interactive terminals; `--json` results remain machine readable. `--resource` selects a Serving resource when several exist. FC runtime logs require configured SLS delivery. Template preparation has no dynamic instance log stream: use the ID of an actual running instance for Sandbox logs.

Output references wait for producers to be ready. Host actions execute in declaration order; custom business publication belongs in template scripts. An Agents API resource deployment is not complete business acceptance until its publication script succeeds. Follow [the application template](managed-applications.md) for revision routing and drain before deletion.

Owned identities are saved before changes. Missing source files do not authorize adopting same-name replacements. `recover` observes saved identities and leaves uncertain writes visible; a 401/403 or network failure is not proof of deletion. Follow the retained-resource list for images, explicit retained volumes and FC auto resources.

[Resource semantics](template-workflows.md) · [Build reuse](deploy-and-build.md)

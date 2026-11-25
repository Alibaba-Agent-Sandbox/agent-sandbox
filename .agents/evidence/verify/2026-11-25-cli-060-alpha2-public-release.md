# Verification: CLI 0.6.0-alpha.2 public delivery

- Date: 2026-11-25
- Result: PASS for public GitHub/npm artifact delivery and independent consumption. This record-only PR still requires normal CI/review/merge.
- Release source: [PR285](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/285), merged at `fb4de80458e2c002cc05f70616a0de04f1ab8f03`.
- Reviewed source head: `ccfd1736962f667ede365e2c6f24d883f4e35400`.
- Immutable tag: `v0.6.0-alpha.2`, annotated object `4afa587437422e81f375ed853d493f0d3577e2af`, peeled to the release merge.
- Coordination: [Issue282](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/282).
- Local public-artifact environment: Linux x64, Node 22.22.2, npm 12.0.2, Python 3.13.13.

## Scope and source gates

This release makes the merged invocation, application-authentication and MCP
cleanup/protocol corrections installable. It also rejects the removed MCP
`envd_inject` argument rather than silently accepting an ineffective switch.
The native Provider's independent preparation field remains documented according
to its actual request behavior. This release does not contain the native-resource
candidate in PR281, the template migration in PR311, or unfinished managed SDK drafts.

All eight checks on the reviewed release head passed: Node 20/22 tests and parity,
typecheck/lint/hygiene, installer, Markdown links, the actual installed npm artifact,
generated client-only MCP HTTP behavior, and the public server wheel in a real Docker
image. See [source CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45600007346),
[generated MCP](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45600007329),
[server image](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45600007875)
and [links](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45600007391).
Existing [preparation evidence](2026-11-25-cli-060-alpha2-release.md) remains unchanged.

The runtime pin was updated only after paired Python client/server 0.5.0a1 became
public and independently installable. Python release source is
`8d9297f7d1a9adddf3710ddcaab914b9e35d3618`, immutable tag `v0.5.0a1`,
[publish run](https://github.com/Alibaba-Agent-Sandbox/python-sdk/actions/runs/45597651893).
Generated MCP installs the client distribution only; its absence of the Server SDK
was checked by the generated-artifact verifier. The matching server distribution
is separately consumed by the image verification workflow.

## Public native delivery

[The GitHub prerelease](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.6.0-alpha.2)
was published at 11:15:39 UTC after all five jobs in
[binary run 45602068106](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45602068106)
passed. Those jobs execute the actual npm installation and independently copied
standalone binary on Linux x64/arm64, macOS x64/arm64, and Windows x64.
Anonymous release metadata confirms `draft: false` and `prerelease: true`; GitHub
latest remains `v0.5.10`.

An independent anonymous Linux x64 download has 135924928 bytes and SHA-256
`52dabc38ac62690983f5029ddc086ef0a0d9ba2b15027beb293efff6218d5cc2`.
Its bytes match both the separate checksum asset and GitHub's asset digest.
The complete artifact checker passed using a copied executable outside every
real `node_modules` ancestor, an isolated home/current directory and no injected
Node lookup options. It includes real PTY cancellation, target-first API help,
removed-wrapper rejection, generated scaffolds, notices and structured errors.
Only Linux x64 was independently downloaded and run locally; the other four
platforms have the actual platform-workflow evidence above.

## Public npm delivery

[npm run 45602785730](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45602785730)
completed successfully, including its exact candidate installation, public-registry
installation and attached tarball/checksum. Its final log confirms publication to
`https://registry.npmjs.org/` with `next` and public access, a signed provenance
statement, and the exact package/version. The public-install artifact checker
passed at 11:31:14 UTC after the earlier failed reads below.

Independent anonymous metadata now reports `next: 0.6.0-alpha.2` and
`latest: 0.5.10`. A separately downloaded public npm tarball has 1465289 bytes,
SHA-256 `b0558f4f39645fcb4fc29a2bb6005d4e2d186e29c340fecd7d974d00cbc54f84`,
and SHA-512 matching the registry `dist.integrity`. The separately downloaded
GitHub tarball and checksum match those exact npm bytes. The GitHub release has
12 assets: five native binary/checksum pairs and the npm tarball/checksum pair.

A third independent installation used a new empty prefix and cache, the official
registry and `--prefer-online`. It succeeded, and the complete installed-artifact
checker exited zero. The checker retains npm's legitimate installation dependency
tree while isolating configuration and working directory. It verifies the actual
version, local input rejection, target-first API help, generated OpenAPI assets,
retired command rejection, error channels, complete notices and real PTY cancel.

```sh
npm install --global --prefix "$CHECK_DIR/npm" --cache "$CHECK_DIR/cache" \
  --registry=https://registry.npmjs.org --prefer-online @agent-sandbox/cli@0.6.0-alpha.2
node scripts/check-release-artifact.mjs "$CHECK_DIR/npm/bin/abx"
node scripts/check-release-artifact.mjs "$CHECK_DIR/abx-0.6.0-alpha.2-linux-x64"
```

`CHECK_DIR` denotes fresh temporary paths; the source-side checker is from the
exact release source. This is public package consumption, not a local tarball
substituted for a public install. See the [sanitized machine receipt](2026-11-25-cli-060-alpha2-public-release.json).

## Preserved failures and boundaries

The workflow upload step reported success at 11:21:26 UTC. Subsequent anonymous
metadata reads still returned 404, and a fresh public-registry installation at
11:22:38 UTC returned `ETARGET`. At that checkpoint the public package index still
reported `next: 0.6.0-alpha.1`. By 11:28:16 UTC metadata was available, but its tarball URL still returned 404;
a second fresh installation failed with that tarball error. At 11:30:32 UTC the
independent tarball download returned 200; the third fresh installation and full
checker passed. The cause of these successive visibility delays was not
independently established. The website publication gate stayed closed until
actual public installation passed. No repeated upload or changed version was used.

The optional read-only credential-diagnostics workflow job was skipped; it is not
a failed product check or cloud acceptance. No cloud resource was created by these
publication checks. The earlier actual protected sandbox call and actual MCP
create/exec/delete proof are recorded in the owning correction evidence, including
independent cleanup; they were not replayed merely to publish the version.

## Cleanup and unverified scope

Artifact checking uses local temporary files and subprocesses. The verifier cleans
its temporary workspace and owned processes; the downloaded public artifact and
sanitized receipts are retained for engineering verification. No new database,
image repository, cloud template, function or sandbox was created here.

This record does not certify native static YAML startup, a complete empty-Sandbox
API bootstrap, OpenSandbox named resources, all Agents API methods/harnesses,
FC-hosted MCP deployment, durable MCP sessions across process restart, or E2B SDK
compatibility. Earlier partial and draft evidence remains partial/draft.

## Record maintenance and review

The release decision moves from proposed to implemented only after public
consumption passed. Earlier merged preparation evidence is preserved unchanged.
The [complete request coverage review](2026-11-25-full-request-coverage.md)
is a separate point-in-time scope audit, not a claim that publishing this package
completed every original product requirement. The website installation/API text
was independently reviewed against this exact source; its own public rollout and
UI checks remain the website repository's evidence.

The fresh record worktree initially lacked the development toolchain, so its
health checker correctly refused to run. After `npm ci`, repository health passed
with 105 passes, 11 pre-existing historical/configuration warnings and zero failures;
`npm run check:hygiene` passed. No production file changed in this evidence update.

# CLI 0.5.6 publication and independent public consumption

- Date: 2026-10-25
- Result: PASS for the completed publication and public-package observations below; this documentation-only head's required CI, review and normal merge remain pending.
- Runtime source: `1ea3eabd679c3cf26c824492a60fe2a8aea43f62` (normally merged PR181); its tree equals reviewed `e982301cce86356846faaee3342f5f0f3a9d52c8`.
- Immutable tag: `v0.5.6`, annotated object `bf3d2574ed9a054a82893e154e27dc805d42fdd5`.
- No new runtime, version, dependency or package publication is introduced by this documentation follow-up.

## Formal release gates and identity

The reviewed source had **six applicable checks, all SUCCESS**: Typecheck, Node20 tests, Node22 tests, Build package, Installer script and Markdown links. This is six actual checks, not nine assumed jobs. Exact check URLs, tag/source and all asset sizes/digests are in the [public metadata receipt](2026-10-25-cli-056-public-metadata.json).

The normal [five-platform binary workflow 40236483898](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40236483898) completed SUCCESS before the draft was published. [GitHub release v0.5.6](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.5.6) is public (release423678307, published 21:44:20 UTC). The normal [npm publisher 40236891035](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40236891035) completed SUCCESS. All 12 release assets are present: five binaries, their five SHA-256 sidecars, npm archive and its sidecar. Independent release verification matched all six asset sidecars and official npm/GitHub tarball bytes; tarball SHA-256 is `f8e123e5cc15a64ea0ed403c895eb28eae4f655d6f01949856d5fd7b6676bbad`.

## Independent official npm installation

The release owner installed exact `@agent-sandbox/cli@0.5.6` from the official registry using a fresh HOME, fresh npm cache and working directory outside the repository. The configured CA was inherited. Version/help passed and no retired workflow option appeared. The existing full artifact verifier also passed version/help, managed loopback preflight, standard/native parsing, configuration/scaffolding/noninteractive behavior, real terminal cancellation and complete notices. These checks made zero cloud calls.

- [Installation receipt](2026-10-25-cli-056-public-npm-installation.json)
- [Actual installed-artifact verifier](2026-10-25-cli-056-public-npm-artifact.json)

The machine-local executable path is the only omitted field from the copied installation receipt; no authentication values or resource IDs are included.

## Independent public Linux standalone binary

A separate full HTTPS download was streamed into a SHA-256 calculation without keeping another large binary. Linux x64 downloaded 135400640 bytes, SHA-256 `f7d900762660f49863bcb4749f1bb1f7b328d996b643a446868e2d3a36a2ac81`; it matched GitHub's digest and the separately installed case binary. That binary executed in another fresh HOME and reported actual version 0.5.6. This receipt proves download/identity/version, not an additional cloud or complete standalone capability run.

- [Binary download and execution receipt](2026-10-25-cli-056-public-binary.json)

## Actual public npm cloud controls and cleanup

The independently installed official npm 0.5.6 CLI, public client/server 0.4.0a6 and one newly created Express `base` sandbox exercised five controls: execution-failure JSON, validation-failure JSON through the command alias, execution-failure text, successful null JSON and unknown-command JSON. Independent authenticated HTTP observed status500/400 for the deliberate execution/validation failures. CLI JSON failures emitted one diagnostic E3000 object with exit1; null retained `{result:null}` and exit0; unknown command retained E3005 and exit2.

All five controls passed. The exact one owned sandbox was deleted and independently confirmed absent through typed lookup. No prepared template or model was created. These are five named-command controls on one sandbox, not the five complete developer journeys or a full template/provider matrix.

- [Independent official-package cloud receipt](2026-10-25-cli-056-public-cloud.json)

The earlier [named-command candidate checkpoint](2026-10-25-named-command-json-errors.md) and its actual 89ec source / unreleased candidate5 identity remain unchanged. Earlier local full-suite failures and baseline comparisons remain in those historical files; this new public-package pass does not relabel them or infer a host root cause.

## Website delivery boundary

A nonce read of the official website release manifest still returned `tag_name: v0.5.4` at this documentation checkpoint. Website mirror promotion is separate from GitHub/npm publication. The default website command must not be called a default0.5.6 install yet. Current0.5.6 installation can use exact official npm or published GitHub assets; the installation guide's manual examples now point to those actual assets. This record does not claim the website has deployed the new mirror.

## Reproduction and documentation checks

The actual public npm installation follows:

```bash
npm install --global @agent-sandbox/cli@0.5.6 --registry=https://registry.npmjs.org
abx --version
```

For an isolated repeat, select a new HOME/cache/prefix and an external working directory before running these commands. Use the existing release artifact verifier against that exact installed executable. The copied receipts record the already executed public checks; no new cloud or dependency installation was performed for this prose-only follow-up.

Local documentation checks: `npm run check:hygiene` and `git diff --check` PASS. Final `bash scripts/check-repo-health.sh` reports 106 PASS / 11 existing WARN / 0 FAIL, including relative-link checks. The clean worktree initially lacked its TypeScript health parser; a temporary whole-node_modules symlink was rejected by the existing guard (105 PASS / 11 WARN / 1 FAIL), and NODE_PATH did not resolve its ESM dependency. The temporary symlink was removed. Final health reused only the already installed lock-matching TypeScript5.9.3 package through local hardlinks in a real ignored node_modules directory, read-only for this check. No npm installation, duplicated package payload, source change or scanner-rule weakening occurred. Original setup-failure logs remain private. Four copied JSON receipts structurally equal their originals except omission of the machine-local executable path; all new records have zero known-secret-value or machine-local-path matches. Exact-head remote CI remains pending; no new cloud or full local suite was run for this documentation-only change. Full catalog matrices, five developer journeys, other clouds, PTY and model tasks retain their own scoped records and are not certified by this publication document.

# CLI 0.6.0-alpha.2 release preflight — 2026-11-25

## Scope

Ship merged OpenAPI invocation improvements from PR 277 and MCP cleanup/protocol
corrections from PR 280. Do not include unfinished native resource, empty-Sandbox
bootstrap, provider/managed bridge or catalog migration draft branches.

## Public state observed

Fresh registry reads found npm latest=0.5.10, next=0.6.0-alpha.1 and no alpha.2.
Python client/server public metadata both identifies 0.5.0a0; 0.5.0a1 is not yet
published at this checkpoint. The GitHub repository-level NPM_API_TOKEN secret is
configured; no environment-specific override exists. Existing alpha.1 binary and
npm release workflows both completed successfully. These facts do not promise future
credential validity; no credential values were printed or copied.

## Required source update

1. After PR 280 is merged, create a fresh release branch from that exact main commit.
2. Use CLI 0.6.0-alpha.2 in package.json and both package-lock root records, public
   English/Chinese README, binary-installation and upgrading-to-0.6 pages, plus the
   standalone managed-build npm-install guidance in src/application/host.ts.
3. Add a new version-evidence batch and golden, preserving alpha.1 history.
4. After verified paired Python 0.5.0a1 publication, update the shared runtime pin in
   src/utils/server_sdk_pin.ts, the server-wheel image workflow tag, the exact codegen
   expectation and corresponding migration guide links. The generated MCP artifact
   consumes the client package through this same pin; leaving it at a0 would retain
   the old cleanup/header bugs. Do not add the Server SDK to the MCP-only artifact.
5. Extend the existing installed-artifact checker with installed OpenAPI option help
   and local bad-input assertions for the new options. Extend the generated MCP
   artifact check with protocol rejection and authenticated empty-session deletion.
6. Record source checks, package hashes and actual public readback under .agents;
   keep public pages focused on installation and supported usage.

## Existing gates and order

- Release PR: Node 20/22 full tests and parity; typecheck/lint/hygiene; installer;
  npm package check; documentation; generated MCP actual HTTP and server-wheel Docker
  jobs triggered by the runtime pin. Paired Python packages must already be publicly
  installable for the latter gates.
- Merge the reviewed release PR through normal checks; tag only the matching immutable
  merge commit as v0.6.0-alpha.2. Do not alter an existing tag/version.
- Tag push runs release-binary.yml for Linux x64/arm64, macOS x64/arm64, Windows x64.
  Each platform installs the actual npm tarball and checks a copied standalone binary
  outside development dependencies. Wait for all five results and checksum assets.
- The tag creates a draft GitHub Release. Publish it explicitly as prerelease and
  non-latest only after binary gates. Publishing triggers release.yml.
- The npm job checks source tag/version and provenance repository identity, installs
  locked dependencies, typechecks/builds/tests, packs and verifies the exact tarball,
  compares immutable npm metadata, then publishes that tarball with provenance and
  dist-tag next. Stable latest remains 0.5.10.
- Verify the public registry installation, attached exact tarball/checksum, GitHub
  prerelease flags, and an anonymous native download through the existing artifact
  checker. Report only after independent readback. Recovery uses existing current-main
  workflow_dispatch(release_tag=existing tag); never move a source tag.

## Limits

The initial preflight performed no release/version/tag/publication mutation.
The subsequent release branch prepares version metadata; no tag or public
publication has occurred at this checkpoint.
The release does not claim native YAML v1 deployment, FC-hosted MCP scaling, durable
MCP process-restart recovery, all-agent harness coverage or SDK-style E2B equivalence.

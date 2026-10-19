# Decision: Publish the CLI from independently installed0.4.0 artifacts

Status: implemented

## Problem
The official scoped npm package returns404. GitHubv0.3.0 points to an older implementation than accepted main; green source CI did not deliver the new executable or npm installation. The optional npm flag can silently skip distribution.

## Decision
Use a new0.4.0 pre1.0 public-preview line without overwriting historical tags. A tag builds, installs and checks actual npm packages plus real SEA binaries on five platforms, then uploads checksums into a draft Release. Publish that draft only after all platforms pass. The explicit published Release triggers npm upload of the installed/tested tarball, followed by a real public-registry installation. Manual npm retries must select the matching tag; branches and mismatching versions fail before upload.

## API Design
No runtime API surface changes. Version metadata becomes0.4.0. release-binary.yml handles tag pushes and artifact-only manual runs; release.yml handles a published Release and tag-scoped manual retry. The old NPM_PUBLISH variable is no longer a silent publication gate. Unstable semver uses npm next; normal0.x versions use latest.

## Alternatives considered
Reusingv0.3.0 misidentifies the code and invalidates existing checksums. Publishing a release before native assets finish produces a broken installation window. A fake installer payload or --version alone does not prove real sandbox behavior. Preserving the optional flag would leave the requested npm install unresolved. Historical snapshots remain immutable; the changed version has a new actual capture.

## Dependencies
Existing repository NPM_API_TOKEN and npm environment; no secret is downloaded or changed. Pinned SDK/provider test fixtures are reviewed public revisions. The package remains @agent-sandbox/cli with the abx command. Python package publication, provider/template certification and branding changes are excluded. Refs https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66 .

## Test Strategy
Fresh user-prefix npm tarball installation and real Linux SEA/local HTTP installer; actual CLI create/exec/failure exit/binary upload/remote hash/download/list/kill and independent absence. Test release guards, current metadata, complete notices and existing snapshot/installer gates. Require hosted current-head CI before merge, all native builds before public Release, and independent published-channel installation plus local cloud acceptance afterward.

## Acceptance criteria
Release preparation is implemented and locally tested; all required hosted gates pass before merge. Actual tag/release/npm publication is a post-merge operation tracked by Issue66 and must be independently read back before declaring success. A configured token, draft, skipped check or local pack is never reported as a published npm package.

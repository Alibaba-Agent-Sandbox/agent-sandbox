# Verification: CLI 0.5.8 publication and public installation guidance

- Date: 2026-10-28
- Result: PASS for GitHub/npm publication, independent public installation and scoped documentation checks. Website promotion is verified separately after deployment.
- Source merge: b49e8e5dbd4ac10779846049e70038883c981847.
- Source PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/208 (MERGED).
- Release: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.5.8.
- Related README PR: https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/289 (MERGED).

## Source and distribution gates

- Exact reviewed PR head 42eb85fe8afa37eb7a579a34b69e4f9b3a317a0f passed all applicable checks,
  including full Node 20/22 tests/parity and package build. CI run:
  https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40627451858.
- Merge source tree matched the reviewed head exactly; tag v0.5.8 targets that merge. No source tag
  was moved and no default-branch push or review/check bypass was used.
- All five platform builds and actual npm/binary artifact checks passed:
  https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40628239555.
- GitHub publication readback: non-draft stable v0.5.8, published 2026-10-28T03:46:31Z.
  All ten expected platform binary/checksum assets uploaded with nonzero size.
- An extra REST lookup by draft tag returned HTTP 404 before publication. The exploratory shell
  continued to the publish command; the five-platform run had already completed successfully.
  Public-tag asset validation afterward confirmed all ten required files. Subsequent delivery
  command chains use fail-fast execution.
- npm provenance publication and public consumption workflow:
  https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40628591014.
- Initial independent npm metadata reads returned 404 during index propagation; later fresh
  exact-version metadata and tarball URLs returned HTTP 200 for 0.5.8.

## Installed candidate and cloud behavior

The installed npm candidate passed artifact verification and three real Express paths: command-only
platform-key setup plus create/exec; application-token prompting, generation, injection and later
saved-token reuse; full initialization, catalog selection, creation and remote execution. Each
owned sandbox was deleted and independently read back as HTTP 404. Temporary configuration was
removed. The original remote Codex reference also reached the explained application prompt through
the installed candidate and cancelled before preparation/creation without saving credentials.

## Public readback and documentation checks

- npm publication run 40628591014 completed SUCCESS, including provenance publication, clean
  public-registry installation and attachment of the tested npm tarball/checksum.
- Independently installed `@agent-sandbox/cli@0.5.8` from `https://registry.npmjs.org` using a fresh
  prefix/cache: PASS. Ran `scripts/check-release-artifact.mjs` on that installation: PASS.
- Ran `e2e/initialized-template.mjs --application` through the official npm installation: PASS,
  including prompted/generated token, injection, later saved-token reuse and actual authenticated
  application discovery. Owned sandbox deletion independently confirmed by HTTP 404; isolated
  configuration removed.
- `bash scripts/check-repo-health.sh --quiet`: PASS=105, WARN=11, FAIL=0.
- `npm run check:hygiene` and `git diff --check`: PASS.
- Both installer/tutorial languages recommend 0.5.8. Publisher recovery/provenance instructions
  moved to `.agents/design/cli-release-operations.md`; public installation docs retain user tasks.
- Official website mirror promotion is a separate deployment/readback; it is not claimed by
  GitHub publication or npm installation alone.
All credentials stay in the pre-existing private dotenv/child environment; values and private
resource references are absent from records. Prior failures/captures remain unchanged.

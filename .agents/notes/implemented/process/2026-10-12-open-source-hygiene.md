# Decision: Open-source hygiene sweep and `check-no-local-paths` guard

Status: implemented

## Problem
Before the `cli` repository is published, files inherited from the original single
repository still carried developer-machine specifics: an absolute home-directory
path used as a working directory, `.venv/bin/python` assumptions, a personal ACR
namespace and fixed e2e tags in deploy scripts and `.env.example`, agent
scratch locations under the system temp directory in `docs/PORTING.md`, a personal home directory in sample command
output, and real sandbox / template identifiers captured in the e2e workflow guide.

## Decision
1. Fix each finding the way a public-repo maintainer would:
   - Scripts and benchmarks resolve the repo root from their own location
     (`$(dirname "${BASH_SOURCE[0]}")/..`, `import.meta.url`), never from a fixed path.
   - The `abx` executable comes from `PATH`, overridable with `ABX_BIN`
     (`benchmarks/bench_cli_startup.mjs`, `scripts/*.sh`).
   - `scripts/build_hermes.sh`, `deploy_all_templates.sh`, `deploy_remaining.sh`:
     `ACR_NAMESPACE` is required (no personal default), `TAG` defaults to `dev`,
     `REGION` defaults to `cn-hangzhou`, `DOCKER_PLATFORM` defaults to
     `linux/amd64` (sandbox runtime architecture), result summaries go to a
     `mktemp` file (`RESULTS_FILE` overrides) instead of fixed temp-directory file names, the
     wheel is the newest `python-sdk/dist/agent_sandbox-*.whl` (`WHEEL` overrides).
   - `.env.example`: `ACR_NAMESPACE=<your-namespace>`.
   - `docs/PORTING.md`: scratch paths replaced by `$ORIG_REPO` / `$ORACLE_VENV`.
   - Docs: user-home absolute paths to `.abx/` and `.cursor/mcp.json` became `~/...`;
     real sandbox UUID and template IDs in `e2e-template-workflow.md` (en/zh) became
     placeholders.
   - Ignored `.agents/evidence` logs scrubbed of local file URLs under user homes and
     agent-cache paths (they are gitignored today but would leak if un-ignored).
2. Add a regression guard: `scripts/check-no-local-paths.sh` (bash + grep only, no
   `rg`) scans every tracked or untracked-but-not-ignored file for user-home paths,
   Windows user paths, `Documents/Qoder` / `chat-N` project directories,
   `.venv/bin|Scripts/`, agent scratch locations, the personal ACR namespace / fixed
   e2e tag, and AccessKey / API-key / token / private-key shaped strings (values are
   never echoed). Legitimate matches go into `scripts/local-paths.allowlist`
   (`<path-glob>[|<regex>]`, narrow entries with a justification).
3. Wire it in: `npm run check:hygiene`, `make hygiene` (also part of `make ci`), and
   a step in the `lint` job of `.github/workflows/ci.yml`.

## Rationale
- Product names such as "Qoder" (the agent integration documented in `SKILL.md`,
  `docs/`) are legitimate; only the path forms (`Documents/Qoder`, `Qoder/<date>-...`)
  are rejected. `/home/user` (the sandbox's default home) is exempt.
- The allowlist keeps the guard strict by default while letting the repo-health
  checker (which contains the detection regexes) pass.

## Known gaps
- `docs/design/repository-layout.md` (split audit) quotes the leaks it describes and
  is allowlisted temporarily; remove the entry once the literal paths are scrubbed.
- `.github/SECURITY.md` / `CODE_OF_CONDUCT.md` contain the maintainer contact email on
  purpose (not checked).
- `.env` (gitignored, local) holds real credentials; it is never committed, but must
  not be copied into the published repository.

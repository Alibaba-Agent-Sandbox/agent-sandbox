# Decision: template deploy one-shot deployment command

Status: implemented
Implemented: 2026-09-09

## Problem
The full template release flow involves several steps: (1) build the Docker
image; (2) push it to ACR (Alibaba Cloud Container Registry); (3) call the
CreateTemplate API to create/update the template. Users had to run
`abx template build`, `abx template push`, and `abx template create` in
sequence, which is tedious and easy to skip steps in. A one-shot command that
merges these three steps is needed.

## Decision
Add the `abx template deploy` command, which encapsulates the full pipeline
build → push → create.

### Core design

1. **`abx template deploy`** is a superset of `abx template build`: it runs the
   full image build, ACR push, and CreateTemplate API call.
2. **Parameter reuse**: the `deploy` command's parameter set is identical to
   `build`'s (via `params=list(build.params)` on the `click.command`), so users
   don't need to learn new parameters.
3. **Implementation**: internally `deploy` calls `ctx.invoke(build, **kwargs)`
   and runs the `build` command as a subprocess (the `build` command already
   contains the push + create logic).

### The coexisting `abx deploy`

4. **`abx deploy`** (top-level shortcut) has a different meaning from
   `template deploy`. `abx deploy` is a **project-deployment** command (NL mode
   or traditional mode) that deploys a user project into a sandbox to run.
   `abx template deploy` is a **template-release** command that publishes a
   template image to the platform.

| Command | Meaning | Source |
|---------|---------|--------|
| `abx deploy ./project` | Project deployment (into a sandbox) | `cli/commands/deploy.py` |
| `abx template deploy` | Template release (to the platform) | `cli/commands/template.py` |

## API Design
```bash
# one-shot template release (build + push + create)
abx template deploy ./examples/templates/python-hello \
  --alias python-hello \
  --timeout 300

# equivalent to running in sequence:
# abx template build → abx template push → abx template create

# project deployment (different command)
abx deploy ./my-project "deploy this FastAPI project"
```

## Alternatives considered
- **Keep only `build`, without adding `deploy`** — users would need to know that
  `build` already includes push + create; the naming is not intuitive. Rejected.
- **Implement `deploy` independently instead of reusing `build`** — causes code
  duplication, and `build`'s parameter set is already comprehensive. Rejected.
- **Merge `abx deploy` and `abx template deploy`** — their semantics are
  entirely different (project deployment vs template release); merging would
  cause confusion. Rejected.

## Dependencies
- `cli/commands/template.py` (the `build` subcommand's parameter definitions)
- `api/docker_builder.py` (Docker image build)
- `api/deploy.py` (ACR push)
- `api/fc_template.py` (CreateTemplate API)

## Test Strategy
- `abx template deploy --help` output matches `build`'s parameters.
- End-to-end: the `deploy` command runs build, push, and create in sequence.
- Error propagation: when the build step fails, `deploy` reports the error correctly and exits.

## Acceptance criteria
- ✅ The `abx template deploy` command is available and completes build → push → create in one command.
- ✅ Its parameter set is identical to `build`'s, requiring no new parameter learning.
- ✅ `abx deploy` (project deployment) and `abx template deploy` (template release) have clear, non-conflicting semantics.

## Implementation
- **template deploy**: the `deploy` function in `src/agent_sandbox/cli/commands/template.py`
- **Top-level deploy**: the `deploy_shortcut` function in `src/agent_sandbox/cli/commands/deploy.py`
- **Docker build**: `src/agent_sandbox/api/docker_builder.py`
- **ACR push**: `src/agent_sandbox/api/deploy.py`
- **FC CreateTemplate**: `src/agent_sandbox/api/fc_template.py`
- **Tests**: `tests/test_cli/test_template*.py`

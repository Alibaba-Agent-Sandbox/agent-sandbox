# Decision: Template Awesome — community sandbox template index

Status: implemented
Implemented: 2026-09-09

## Problem
The current template-distribution model supports only: (1) the built-in templates
under the local `examples/templates/` directory; (2) manual build and push via
`abx template build-local`. There is no community-driven mechanism for template
discovery and distribution, so users cannot search for and discover sandbox
templates created by others, nor install community templates locally with one
command.

## Decision
Use the **awesome-list + Git index file** pattern to create a community sandbox
template index.

### Core design

1. **`awesome-templates.yaml` index file**: a YAML index file is maintained at
   the repo root, listing every community template's metadata (name, description,
   author, Git repo URL, tags, capabilities, status, etc.). Anyone can add their
   own template via PR.

2. **CLI command extensions**:
   - `abx template search <keyword>` — searches the community template index
     (supports `--tag` and `--status` filters).
   - `abx template install <name>` — clones a template from the index or a
     GitHub URL into local `~/.abx/templates/`.
   - `abx install <name>` — top-level shortcut command.

3. **Distribution mechanism**:
   - The index file lives in the root of the main repository.
   - The templates themselves live in their author's Git repository.
   - The `install` command runs `git clone` into the local cache directory.
   - The local cache directory coincides with the existing `~/.abx/templates/`
     template-resolution directory.

### Index file format
```yaml
templates:
  - name: "python-hello"
    description: "A minimal Python hello world template for testing"
    repo: https://github.com/alibaba-agent-sandbox/awesome-templates
    path: python-hello
    tags: [python, hello-world, example]
    author: alibaba-agent-sandbox
    capabilities: [shell, files, code, ports]
    status: official
```

## API Design
```bash
# search the community template index
abx template search python --tag hello-world --status official

# install a template into ~/.abx/templates/
abx template install python-hello
abx install python-hello         # top-level shortcut, same as `template install`
```

The index-file schema (see the sample above) is the machine-readable contract;
each entry contains `name`, `description`, `repo`, `path`, `tags`, `author`,
`capabilities`, and `status`.

## Alternatives considered
- **Centralized template server (like npm registry)** — needs server
  infrastructure, too costly for MVP. Deferred.
- **Vendor all community templates into the main repo** — repo bloat and
  version-management difficulty. Rejected.
- **Pure GitHub Topics tag discovery** — no structured metadata; poor search
  experience. Rejected.
- **OCI Registry template distribution** — too high a barrier. Deferred.

## Dependencies
- `cli/commands/template.py` (search/install subcommands)
- `examples/templates/` (existing built-in templates as seed data)
- Git CLI (`install` depends on `git clone`)

## Test Strategy
- Index file parsing: YAML format validation, missing required fields raise errors.
- `search` command: keyword matching (name + description + tags), no-result message.
- `install` command: clones to the correct path.

## Acceptance criteria
- ✅ The `awesome-templates.yaml` index file contains 10 official templates.
- ✅ `abx template search` can search the template index.
- ✅ `abx template install` / `abx install` can install templates.
- ✅ After installation, community templates are directly usable via `abx create <template-name>`.
- ✅ The contribution flow is documented in the index-file comments.

## Implementation
- **Index file**: `awesome-templates.yaml` (10 official templates + community-template locations)
- **search command**: the `search` subcommand in `src/agent_sandbox/cli/commands/template.py`
- **install command**: the `install` subcommand in `src/agent_sandbox/cli/commands/template.py`
- **Top-level shortcut**: `install` mapped to `template:install_shortcut` in `src/agent_sandbox/cli/main.py`
- **Tests**: `tests/test_cli/test_template*.py`

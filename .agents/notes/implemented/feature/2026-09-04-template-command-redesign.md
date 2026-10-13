# Decision: template command redesign

Status: implemented
Implemented: 2026-09-09
Task: #105

## Problem
The existing `abx template` subcommand family had several design flaws: it assumed
a nonexistent central registry, had redundant responsibilities across commands,
and left users completely unable to discover templates without a repo. These
problems would directly affect the user experience at the first public release.

## Decision
Record the existing problems and clarify the redesign direction.

### Existing problems (fixed)

1. **`abx template list` assumed a nonexistent central registry** → changed to scan
   locally installed templates.
2. **`abx template delete` and `abx template cache --clear` had redundant
   responsibilities** → responsibilities clarified.
3. **Users could not find any template without providing a repo** → solved via
   `abx template search` + `awesome-templates.yaml`.
4. **`abx template cache` only listed file paths** → `info` now shows full
   capabilities + custom_commands.

### Redesign result

5. **`list`**: scans `~/.abx/templates/` and shows a summary of locally installed
   templates, with no network request.
6. **`info <template>`**: local-first, falling back to remote `GET /templates/{id}`,
   showing full details.
7. **`install <source>`**: installs a template from a GitHub repo or local path into
   `~/.abx/templates/`.
8. **`search <keyword>`**: searches the `awesome-templates.yaml` index.
9. **`build`/`deploy`**: builds a Docker image and pushes + creates the template.
10. **`delete`**: deletes a remote template, with confirmation.

## API Design
```bash
abx template list                 # scan ~/.abx/templates/, no network
abx template info <template>      # local-first, fallback to GET /templates/{id}
abx template install <source>     # from GitHub repo or local path
abx template search <keyword>     # search awesome-templates.yaml
abx template build                # build Docker image
abx template deploy               # push + create template
abx template delete <template>    # delete remote template (confirm)
abx install <source>              # top-level shortcut alias for `template install`
```

## Alternatives considered
- **Keep the status quo** — poor first-use experience. Rejected.
- **Build a central registry** — large effort, not justified at the current
  template scale. Deferred.
- **`abx install` (top-level command)** — keep `abx template install` to avoid
  bloating the top-level namespace; `abx install` was added as a shortcut alias.

## Dependencies
- `cli/commands/template.py`
- `api/capability.py` (local template discovery)
- `awesome-templates.yaml` (community template index)

## Test Strategy
- `abx template list` scans the local cache with no network request.
- `abx template info <name>` shows capabilities + custom_commands details.
- `abx template install <source>` installs from GitHub or a local path.
- `abx template search <keyword>` searches awesome-templates.yaml.

## Acceptance criteria
- ✅ `list` shows only locally installed templates, with no dependency on a central registry.
- ✅ `info` shows the full details of a single template.
- ✅ `install` is the main entry point for obtaining templates.
- ✅ `search` can search the community template index.
- ✅ `build`/`deploy` build and push in one step.

## Implementation
- **Source**: `src/agent_sandbox/cli/commands/template.py` (install, info, search,
  build, deploy, delete, and other subcommands)
- **Template management API**: `src/agent_sandbox/api/template.py`
- **Tests**: `tests/test_cli/test_template*.py`

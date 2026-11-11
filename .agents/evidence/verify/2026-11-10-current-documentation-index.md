# Current documentation index and build-mode correction — 2026-11-10

Coordination: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/244 .

## Scope and review

The English/Chinese documentation indexes still advertised retired scaffold,
search/install and combined create/deploy entries. The build-mode design page
called itself current while documenting removed CLI flags. Parent review scoped
this final change to documentation only, using the already reviewed command
surface and existing build implementation.

- Update both indexes to the single current command reference, source authoring,
  explicit template builds, named deployments and editable MCP templates.
- Describe Express preparation modes through manifest `build.mode`; explain
  declared Dockerfile profiles through `--build-profile`, artifact reuse through
  `deploy --build FILE`, step expansion, local-file limitations, readiness and
  preparation/lifetime/request deadlines.
- Mark the older provider/credential specifications as historical and link the
  current configuration, Provider operation and command references. Each file
  changes only its status paragraph; its historical grammar remains intact.
- Dated proposed provider-template-deploy/error-reporting documents and archived
  records remain unchanged. No runtime, test, workflow or package file is changed.

## Verification

- Read actual command definitions and implementation in commands/template.ts,
  commands/deploy.ts, template_build.ts, template_launch.ts, build_plan.ts and
  the Express preparation extension; compare with current task guides.
- Built CLI `template build --help` and `deploy --help` confirmed the documented
  options. No model, build, deployment or cloud operation was executed.
- Six changed public Markdown files passed local target-file link checks.
  Remote URLs and anchor fragments were not checked by this local audit.
- Diff whitespace checks passed. Current indexes/build-mode pages no longer
  present retired scaffold/search/install, build-mode flags or create pipelines
  as current usage. Historical pages intentionally retain their old grammar.

Remote documentation checks will run on the coordinator's final documentation
commit; this record does not change the preceding runtime CI results.

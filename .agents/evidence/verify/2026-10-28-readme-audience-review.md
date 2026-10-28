# Verification: agent-sandbox README audience review

- Date: 2026-10-28
- Result: PASS — scoped local documentation verification. Remote checks and merge are reported separately on the PR.
- Base revision: `fc37ad54288383eca30cce50029289331a9d5bef`.
- Scope: `README.md`, `README.zh-CN.md`, `docs/en/guide/getting-started.md`, `docs/zh/guide/getting-started.md`; repository-owned note and this evidence.
- Environment: Linux, Node.js 22.22.2, system Python 3.13.13; SDK/server and checker environment Python 3.11.15.

## What was reviewed

The opening promoted an Alibaba E2B migration link before the badges. Installation details, plugin internals, historical mirror failures, large command dumps and copied SDK documentation made the first successful CLI session hard to find.

Lead with the abx purpose, supported installation paths and one create/exec/connect/kill session. Keep application launch and AI-tool entry points brief. Put migration in the task-oriented documentation table, retain installation troubleshooting in its existing guide, and link the SDK instead of copying it. Update the getting-started text that described the old README template.

## Validation

`python "$README_AUDIT"` passed for 8 changed Markdown files, with zero failures. This temporary audit used the existing template repository's Markdown-target/heading parser at its checked-out base revision and a task wrapper (SHA-256 `fe8c34fd4ef2474ca7dfcfcc94d2a055e9ead01a92fe2695446cfe08341df7e6`). It checks changed local targets/fragments, incoming active README heading links, one H1 and reciprocal language links in each root README, balanced fences and Python snippet syntax. `README_AUDIT` denotes that temporary wrapper; no machine-local path is part of the repository. It does not validate cloud runtime behavior.

`git -c core.filemode=false diff --check HEAD` passed. The filesystem exposes executable bits on unchanged checkout files; ignoring those bits for task-local Git commands avoided including unrelated mode changes. The staged change was reviewed for prose-only scope, translation equivalence, current command/API names and preserved license links. Package registry checks on 2026-10-28 found CLI 0.5.8 and Python client 0.4.0a6; the Node SDK public npm metadata endpoint returned HTTP 404. No new package publication is claimed.

## Limits and cleanup

Documentation changes only. No provider API calls, sandboxes, templates, cloud keys, model calls, deployments or package releases were created by local verification. Existing historical receipts remain unchanged. CI and existing main-branch publication workflows retain their own scope.

## Repository checks

- `bash scripts/check-repo-health.sh`: PASS: 106 checks, 0 failures; 11 warnings.
- `npm run check:hygiene`: PASS.
- `npm ci`: PASS.
- `npm test`: PARTIAL: stopped after repeated local engine/parity harness failures and 15–20 second timeouts; a complete local pass is not claimed. Runtime files are unchanged; remote CI runs remain required.
- `npm run lint` and `npm run typecheck` (separate commands after the initial chained test run): PASS.

## Reviewed public-file identity

| File | SHA-256 |
| --- | --- |
| `CHANGELOG.md` | `769475d0d031f6b5ad111e25f3d8c574b1646cb2cc84dcba15d218d088c1230e` |
| `README.md` | `de2951b3c167ddbc74cfcf37055990d0a1ad88d96979ce61c1a5bd4de811f026` |
| `README.zh-CN.md` | `6a1c0b69833695ccbc07cc647da221aba551c7c451643988c3a64727f19863db` |
| `docs/en/guide/getting-started.md` | `2d999ef02192c1f9b41d1e2147aa9ab9f4aba54b51ae1f98c3d3b9f5f03e7b9b` |
| `docs/zh/guide/getting-started.md` | `89149e44320720c3fd9e48ac18be8557676a7edbe98c94ac1f2d708cd6f66782` |

## Local harness limits

The broad local CLI suite was stopped after repeated failures in engine/parity integration and the managed-key process-lock timing test. That run used the system Python rather than the separately installed SDK/server environment, and the mounted checkout has slow file operations. These observations do not independently establish every failure cause. The scoped documentation, health, hygiene, lint and type checks passed. The full latest-head CI matrix must pass before merge. No real cloud-key preparation was executed: consent messages above came from local test fixtures.

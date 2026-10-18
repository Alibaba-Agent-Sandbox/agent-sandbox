# Contributing to Agent Sandbox

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 20+ (npm 10+)
- Git

### Getting Started

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/agent-sandbox.git
cd agent-sandbox

# 2. Install dependencies (includes the test / type-check / build tooling)
npm ci

# 3. Install pre-commit — its checks are invoked automatically by .githooks/pre-commit
pip install pre-commit   # or: make hooks

# 4. Verify your setup
make test
```

> **Note on Git hooks:** This repository ships `.githooks/` and uses it as the
> hook entry point via `core.hooksPath=.githooks` (a local Git config).
> `.githooks/pre-commit` first runs the custom secret scan
> (`.githooks/check-secrets.sh`), then — if the `pre-commit` command is
> installed — invokes the full `.pre-commit-config.yaml` suite (the generic
> file checks, detect-secrets, `tsc --noEmit`, …). Installing the package
> (`pip install pre-commit`, or `make hooks`) is all that is needed:
> `pre-commit install` is not used here because it writes to `.git/hooks/`,
> which Git bypasses while `core.hooksPath=.githooks` is set. On a fresh clone
> (where `core.hooksPath` is unset), run `git config core.hooksPath .githooks`
> — or `pre-commit install` — to activate the hooks.

## Development Workflow

1. **Fork** the repository on GitHub
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Make your changes** — write code, tests, and docs
4. **Run checks** before committing:
   ```bash
   make lint      # Run ESLint
   make typecheck # Type-check with tsc (npm run typecheck)
   make test      # Run tests with vitest (npm test)
   ```

   Or run the full local CI equivalent in one command:
   ```bash
   make ci        # hygiene + tsc --noEmit + ESLint + build + vitest (not integration) + parity coverage check
   ```

   > **Note:** `make ci` runs on your single local Node.js version. It does **not** replace the Node.js 20 / 22 test matrix enforced by GitHub Actions CI — the matrix can only be fully covered by CI itself.
5. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add sandbox snapshot support
   fix: resolve timeout issue in pool manager
   docs: update CLI usage examples
   chore: bump typescript to 5.6.0
   ```
6. **Push** and open a **Pull Request** against `main`

## Definition of Done

A change is done only when it is verified end to end against real components and recorded under
`.agents/`. Every PR must provide: unit tests, an E2E run against the real cloud (`ABX_BIN=abx npm run e2e`,
see [`e2e/README.md`](../e2e/README.md)) recorded in `.agents/evidence/verify/<date>-<topic>.md` (never
containing credentials), an ADR/note under `.agents/notes/`, English and Chinese docs, and a
`CHANGELOG.md` entry. Real credentials live only in gitignored `.env` files and must never be printed,
logged or committed. The full rule, the evidence-file and ADR templates are in
[`.agents/notes/DEFINITION-OF-DONE.md`](../.agents/notes/DEFINITION-OF-DONE.md) (English and 中文:
**完成定义**——所有功能必须针对真实组件完成端到端验证,并在 `.agents/` 中记录,文档需中英文齐全并附 CHANGELOG 条目)。

## Code Style

We use [**TypeScript**](https://www.typescriptlang.org/) in `strict` mode (ESM, Node.js >= 20). The configuration lives in `tsconfig.json`; `npm run typecheck` must pass.

- **Type Hints**: All public APIs must have type annotations; we enforce this with `tsc --noEmit` (strict mode).
- **Docstrings**: Use TSDoc comments for public functions and classes.

```ts
/**
 * Create a new sandbox instance.
 *
 * @param template - Name of the sandbox template.
 * @param timeout - Maximum creation time in seconds.
 * @returns A configured Sandbox instance.
 * @throws SandboxError If sandbox creation fails.
 */
export async function createSandbox(template: string, timeout = 300): Promise<Sandbox> {
  // ...
}
```

## Secret Scanning

A custom hook (`.githooks/check-secrets.sh`) scans every commit for hardcoded secrets — API keys, tokens, passwords, and cloud credentials. Commit-time checks flow through a single entry point:

| Component | Role |
|-----------|------|
| `.githooks/pre-commit` | **Primary hook entry point.** Git calls it because this repository is configured with `core.hooksPath=.githooks`. |
| `check-secrets.sh` | Runs first: scans staged files for hardcoded secrets and blocks the commit if any are found. |
| pre-commit framework | Runs second (when the `pre-commit` command is installed): executes every hook in `.pre-commit-config.yaml` — the generic file checks, detect-secrets, `tsc --noEmit`, plus the `check-secrets` local hook — via `pre-commit run --hook-stage pre-commit`. |

To enable the full suite locally, install the package once:

```bash
pip install pre-commit
# or:
make hooks
```

If `pre-commit` is not installed, `.githooks/pre-commit` still runs the secret
scan and prints an install hint; the framework step is skipped without blocking
the commit.

If the hook detects a secret, the commit is blocked and the offending file + line is printed. False positives can be suppressed by adding `placeholder`, `example`, or `REPLACE_ME` to the line.

## Testing

- We use [vitest](https://vitest.dev/) for testing.
- Write tests for all new features and bug fixes.
- Place tests in the `tests/` directory, mirroring the `src/` structure.

```bash
# Run all tests
make test

# Run a specific test file
npx vitest run tests/test_api/test_sandbox.test.ts

# Run with verbose output
npx vitest run --reporter=verbose
```

## Template Contributions

Sandbox templates — content, the machine-readable index (`awesome-templates.yaml`), releases and CI — live in the dedicated repository **[alibaba-agent-sandbox/awesome-templates](https://github.com/alibaba-agent-sandbox/awesome-templates)**. It is the single source of truth for official & community templates; this repository no longer bundles a template collection (it keeps only a minimal `python-hello` offline fixture for tests).

### Contributing a Template

1. **Read** the catalog repository's [CONTRIBUTING.md](https://github.com/alibaba-agent-sandbox/awesome-templates/blob/main/CONTRIBUTING.md) — it defines the template anatomy, capability-group rules, and local dev workflow.
2. **Open a PR** against [alibaba-agent-sandbox/awesome-templates](https://github.com/alibaba-agent-sandbox/awesome-templates) that adds your template folder and updates `awesome-templates.yaml` (plus the README template table) in the same PR.
3. **Required index fields**: `name`, `description`, `repo`, `tags`, `author`, `capabilities`, `status` (optional: `path` for subdirectory templates, `ref` to pin a version).
4. **Status values**:
   - `official` — maintained by the alibaba-agent-sandbox team (do not use for community PRs)
   - `community` — community-contributed and maintained
   - `experimental` — early-stage or proof-of-concept
5. **Ensure** your repo contains a valid `template.yaml` at the specified path. The catalog CI validates every folder and the index offline.

### Template Repository Requirements

Your template repository should include:
- A `template.yaml` defining the sandbox configuration (base image, packages, capabilities, etc.)
- A `Dockerfile` and a `README.md` with usage instructions
- Example code or scripts that demonstrate the template's purpose

### Searching Templates

Use the CLI to search the remote index:
```bash
abx template search python      # search by tag or keyword
abx template search ai-agent    # find AI agent templates
abx template search browser     # find browser automation templates
```

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Purpose |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `chore:` | Build, CI, or tooling changes |
| `test:` | Adding or updating tests |
| `refactor:` | Code change that neither fixes a bug nor adds a feature |
| `perf:` | Performance improvement |

## Reporting Issues

- Use [GitHub Issues](https://github.com/alibaba-agent-sandbox/agent-sandbox/issues/new/choose) with our templates
- For security vulnerabilities, see our [Security Policy](SECURITY.md)

## Questions?

- Open a [Discussion](https://github.com/alibaba-agent-sandbox/agent-sandbox/discussions) for general questions
- Check existing issues and discussions before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](../LICENSE).

## Stacked pull requests / 堆叠式拉取请求

The complete CI workflow runs on pull requests targeting any branch, including a
feature branch. Wait for the runtime, typecheck, test and build jobs on the latest
head; a Markdown-only result does not establish product validation. Push events
remain limited to `main`. Real-component evidence and all other definition-of-done
requirements still apply.

完整 CI 会验证目标为任意分支的拉取请求，包括以功能分支为基底的堆叠 PR。
须确认最新提交的运行、类型、测试和构建任务实际完成；仅 Markdown 检查通过
不能证明产品验证完成。直接推送仍仅在 `main` 触发；真实组件证据和其余完成
标准继续适用。

#!/usr/bin/env bash
# Repository health gate for the cli (abx, npm @agent-sandbox/cli) repository.
#
# Fails (exit 1) when a file, section or invariant required of a complete
# open-source repository is missing.  It only reads files; run it from anywhere:
#
#   scripts/check-repo-health.sh            # FAIL lines make the exit code 1
#   scripts/check-repo-health.sh --strict   # WARN lines fail too
#   scripts/check-repo-health.sh --quiet    # print only FAIL/WARN lines and the summary
#
# Requires: bash, node >= 20.  See docs/design/repository-layout.md
# ("Definition of done") for the rationale behind every check.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

STRICT=0
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    --quiet) QUIET=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

FAILS=0
WARNS=0
PASSES=0

pass() { PASSES=$((PASSES + 1)); [ "$QUIET" -eq 1 ] || printf '[PASS] %s\n' "$1"; }
fail() { FAILS=$((FAILS + 1)); printf '[FAIL] %s\n' "$1"; }
warn() { WARNS=$((WARNS + 1)); printf '[WARN] %s\n' "$1"; }

need_file() {
  if [ -f "$1" ]; then pass "file: $1"; else fail "missing file: $1${2:+ ($2)}"; fi
}
need_dir() {
  if [ -d "$1" ]; then pass "dir: $1"; else fail "missing dir: $1${2:+ ($2)}"; fi
}
need_grep() { # need_grep <file> <regex> <description>
  if [ -f "$1" ] && grep -Eiq -- "$2" "$1"; then pass "$3"; else fail "$3 [$1]"; fi
}
warn_file() {
  if [ -f "$1" ]; then pass "file: $1"; else warn "recommended file missing: $1${2:+ ($2)}"; fi
}
warn_any() { # warn_any <description> <path>...
  local desc="$1"; shift
  local f
  for f in "$@"; do [ -e "$f" ] && { pass "$desc ($f)"; return; }; done
  warn "recommended file missing: $desc (one of: $*)"
}

tally() {
  local line
  while IFS= read -r line; do
    case "$line" in
      "[PASS]"*) PASSES=$((PASSES + 1)); [ "$QUIET" -eq 1 ] || printf '%s\n' "$line" ;;
      "[WARN]"*) WARNS=$((WARNS + 1)); printf '%s\n' "$line" ;;
      "[FAIL]"*) FAILS=$((FAILS + 1)); printf '%s\n' "$line" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done
}
shopt -s lastpipe

section() { [ "$QUIET" -eq 1 ] || printf '\n== %s ==\n' "$1"; }

section "Top-level project files"
for f in README.md README.zh-CN.md LICENSE NOTICE CHANGELOG.md AGENTS.md llms.txt SKILL.md \
         .gitignore .env.example .secrets.baseline package.json package-lock.json \
         tsconfig.json tsconfig.build.json vitest.config.ts; do
  need_file "$f"
done
warn_file .editorconfig
warn_any "ESLint config" eslint.config.js eslint.config.mjs eslint.config.ts .eslintrc.json .eslintrc.cjs
warn_any "Prettier config" .prettierrc .prettierrc.json prettier.config.js prettier.config.mjs
warn_any "Node version pin" .nvmrc .node-version
need_dir .githooks
need_file .githooks/pre-commit

section "README / CHANGELOG sections"
for h in "Install" "Quick ?start|Usage|CLI" "Documentation|Docs" "Contributing" "License"; do
  need_grep README.md "^#{1,3} .*(${h})" "README.md has a '${h}' heading"
done
need_grep README.md 'npm (install|i) .*@agent-sandbox/cli' "README.md documents the npm install command"
need_grep CHANGELOG.md '^## \[Unreleased\]' "CHANGELOG.md has an [Unreleased] section"
need_grep CHANGELOG.md 'keepachangelog' "CHANGELOG.md declares the Keep a Changelog format"

section "Community health + CI (.github)"
for f in CODE_OF_CONDUCT.md CONTRIBUTING.md SECURITY.md PULL_REQUEST_TEMPLATE.md dependabot.yml \
         ISSUE_TEMPLATE/bug_report.yml ISSUE_TEMPLATE/feature_request.yml ISSUE_TEMPLATE/config.yml \
         workflows/ci.yml workflows/release.yml; do
  need_file ".github/$f"
done
warn_file .github/workflows/release-binary.yml "standalone Node SEA binaries (docs/en/guide/binary-installation.md)"
warn_file .github/workflows/docs-links.yml "scheduled markdown link check (lychee)"
warn_file .github/CODEOWNERS
if [ -f .github/dependabot.yml ]; then
  if grep -Eq 'package-ecosystem:[[:space:]]*"?npm' .github/dependabot.yml; then
    pass "dependabot watches npm"
  else
    fail "dependabot does not watch npm (.github/dependabot.yml)"
  fi
  if grep -Eq 'package-ecosystem:[[:space:]]*"?pip' .github/dependabot.yml; then
    fail "dependabot still watches pip: this is a Node repository"
  else
    pass "dependabot has no pip ecosystem"
  fi
  need_grep .github/dependabot.yml 'github-actions' "dependabot watches github-actions"
fi
if [ -f .github/workflows/ci.yml ]; then
  need_grep .github/workflows/ci.yml 'npm (ci|install)' "ci.yml installs with npm ci"
  need_grep .github/workflows/ci.yml 'npm (run )?(test|typecheck)|vitest|tsc' "ci.yml runs typecheck + tests"
  need_grep .github/workflows/ci.yml 'node-version' "ci.yml pins/matrices the Node version"
fi
if [ -f .github/workflows/release.yml ]; then
  need_grep .github/workflows/release.yml 'npm publish' "release.yml publishes to npm"
  need_grep .github/workflows/release.yml 'provenance|id-token' "release.yml publishes with provenance (OIDC)"
fi

section "npm package (package.json)"
node - <<'JS' | tally
const fs = require("fs");
const path = require("path");
const out = [];
const R = (k, m) => out.push(`[${k}] ${m}`);
let pkg;
try { pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); } catch (e) { R("FAIL", "package.json unreadable: " + e.message); console.log(out.join("\n")); process.exit(0); }
const chk = (cond, okMsg, badMsg, kind = "FAIL") => R(cond ? "PASS" : kind, cond ? okMsg : badMsg);
chk(pkg.name === "@agent-sandbox/cli", "package name is @agent-sandbox/cli", `package name is ${pkg.name}`);
chk(pkg.bin && pkg.bin.abx === "dist/bin/abx.js", "bin.abx -> dist/bin/abx.js", "bin.abx must be dist/bin/abx.js");
chk(pkg.type === "module", "type: module (ESM)", "package.json should declare type: module");
chk(pkg.license === "Apache-2.0", "license is Apache-2.0", "license must be Apache-2.0");
chk(pkg.engines && /20/.test(pkg.engines.node || ""), "engines.node >= 20", "engines.node must pin Node >= 20");
chk(pkg.repository && /alibaba-agent-sandbox\/cli(\.git)?$/.test(pkg.repository.url || ""), "repository.url points at agent-sandbox/agent-sandbox", `repository.url is ${pkg.repository && pkg.repository.url} (expected github.com/agent-sandbox/agent-sandbox.git)`);
chk(!!pkg.homepage, "homepage set", "homepage missing");
chk(pkg.bugs && pkg.bugs.url && /alibaba-agent-sandbox\/cli/.test(pkg.bugs.url), "bugs.url points at agent-sandbox/agent-sandbox", "bugs.url missing or not agent-sandbox/agent-sandbox");
chk(Array.isArray(pkg.keywords) && pkg.keywords.length > 0, "keywords set", "keywords missing", "WARN");
chk(pkg.publishConfig && pkg.publishConfig.access === "public", "publishConfig.access = public (required for a scoped package)", "publishConfig.access must be 'public' for @agent-sandbox/cli");
chk(Array.isArray(pkg.files) && pkg.files.includes("dist"), "files whitelist includes dist", "files must whitelist dist");
for (const s of ["build", "typecheck", "test"]) chk(pkg.scripts && pkg.scripts[s], `npm script '${s}'`, `npm script '${s}' missing`);
chk(pkg.scripts && pkg.scripts.lint, "npm script 'lint'", "npm script 'lint' missing", "WARN");
chk(pkg.scripts && (pkg.scripts.prepublishOnly || pkg.scripts.prepack), "prepublishOnly/prepack builds before publish", "no prepublishOnly/prepack: publishing could ship a stale dist", "WARN");

const root = process.cwd();
const SKIP = new Set([".git", "node_modules", "dist", "coverage", ".vitest", "build"]);
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}
const files = walk(root);
const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {}), ...Object.keys(pkg.optionalDependencies || {}), ...Object.keys(pkg.peerDependencies || {})]);
const builtins = new Set(require("module").builtinModules);
const missingRuntime = new Map(), missingDev = new Map();
for (const f of files.filter((f) => /\.(ts|mts|cts|js|mjs)$/.test(f) && /\/(src|tests|scripts)\//.test(f))) {
  const rel = path.relative(root, f);
  const isRuntime = rel.startsWith("src/");
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("node:") || spec.startsWith("#")) continue;
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (builtins.has(name)) continue;
    const runtimeDeclared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {})]);
    if (isRuntime && !runtimeDeclared.has(name)) (missingRuntime.get(name) || missingRuntime.set(name, []).get(name)).push(rel);
    if (!isRuntime && !declared.has(name)) (missingDev.get(name) || missingDev.set(name, []).get(name)).push(rel);
  }
}
chk(missingRuntime.size === 0, "every import in src/ is a declared runtime dependency",
  `src/ imports packages missing from dependencies: ${[...missingRuntime.keys()].join(", ")}`);
chk(missingDev.size === 0, "every import in tests/ and scripts/ is declared",
  `tests/scripts import undeclared packages: ${[...missingDev.keys()].join(", ")}`);
const dev = pkg.devDependencies || {};
for (const t of ["typescript", "vitest", "@types/node"]) chk(dev[t], `devDependency ${t}`, `devDependency ${t} missing (a fresh clone cannot build or test)`);

let nm = null;
try { nm = fs.lstatSync("node_modules"); } catch {}
chk(!nm || !nm.isSymbolicLink(), "node_modules is not a symlink", "node_modules is a symlink to another location (never commit/publish from such a tree)");
const gi = fs.existsSync(".gitignore") ? fs.readFileSync(".gitignore", "utf8") : "";
for (const p of ["node_modules", "dist"]) chk(new RegExp(`^/?${p}/?$`, "m").test(gi), `.gitignore ignores ${p}`, `.gitignore does not ignore ${p}`);
chk(fs.existsSync("src/bin/abx.ts"), "src/bin/abx.ts exists (bin entry)", "src/bin/abx.ts missing: the 'abx' bin has no source entry point");
const tests = files.filter((f) => /\.test\.ts$/.test(f) && f.includes(`${path.sep}tests${path.sep}`));
chk(tests.length > 0, `tests/ has ${tests.length} test files`, "no *.test.ts files under tests/");
const scratch = tests.filter((f) => /(^|\/)_|tmp|scratch|fuzz/i.test(path.relative(root, f)));
chk(scratch.length === 0, "no scratch/temporary test files", `scratch test files must not be committed: ${scratch.map((f) => path.relative(root, f)).join(", ")}`);
const py = files.filter((f) => /\.py$/.test(f) && !path.relative(root, f).startsWith(".agents/"));
chk(py.length === 0, "no Python files outside .agents/", `Python leftovers in a Node repo: ${py.map((f) => path.relative(root, f)).slice(0, 4).join(", ")}`);
const stale = files.filter((f) => /\.(sh|mjs|js|ts|yml|yaml)$/.test(f) && /scripts\/|\.github\//.test(f)).filter((f) => !f.endsWith("check-repo-health.sh")).filter((f) => /agent_sandbox\.cli|\.venv\/bin\/python|python3? -m agent_sandbox/.test(fs.readFileSync(f, "utf8")));
chk(stale.length === 0, "no script invokes the removed Python CLI", `scripts still call the Python CLI (agent_sandbox.cli / .venv/bin/python): ${stale.map((f) => path.relative(root, f)).join(", ")}`);
console.log(out.join("\n"));
JS

section "Docs (docs/en, docs/zh)"
need_file docs/README.md
need_file docs/en/README.md
need_file docs/zh/README.md
for f in guide/getting-started.md guide/cli-tutorial.md guide/authentication.md guide/environment-variables.md \
         guide/troubleshooting.md reference/cli-reference.md reference/configuration.md \
         reference/error-codes.md design/cli-design.md; do
  need_file "docs/en/$f"
done
need_file docs/design/repository-layout.md "this layout decision"
warn_file docs/en/guide/providers.md "provider plugins: install, use, author"
warn_file docs/en/guide/contributing-code.md "TypeScript layout, parity ledger, how to add a command"
need_dir examples "runnable examples (CLI recipes, CI usage, provider plugin skeleton)"

section "Agent records (.agents)"
need_file .agents/README.md "explains notes/evidence/research scope and ADR rules for this repo"
need_file .agents/notes/README.md
need_dir .agents/notes/implemented
need_dir .agents/notes/proposed
need_dir .agents/notes/rejected
if grep -Eq '^/?\.agents/(evidence|research)/?$' .gitignore 2>/dev/null; then
  warn ".gitignore ignores .agents/evidence + .agents/research: a fresh 'git add' of the published repo silently drops them"
else
  pass ".gitignore does not hide .agents/evidence or .agents/research"
fi

section "Content hygiene (links, ADRs, leaked paths)"
node - <<'JS' | tally
const fs = require("fs");
const path = require("path");
const root = process.cwd();
const SKIP = new Set([".git", "node_modules", "dist", "coverage", "build", ".vitest"]);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  }
})(root);
const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const out = [];
const R = (k, m) => out.push(`[${k}] ${m}`);
const read = (p) => fs.readFileSync(p, "utf8");
const stripCode = (t) => t.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

const broken = [], escaping = [];
for (const p of files.filter((f) => f.endsWith(".md"))) {
  const text = stripCode(read(p));
  for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    const link = m[1];
    if (/^(https?:|mailto:|tel:|data:)/.test(link)) continue;
    if (link.startsWith("file://")) { broken.push([p, link]); continue; }
    const target = path.resolve(path.dirname(p), link);
    if (path.relative(root, target).startsWith("..")) { escaping.push([p, link]); continue; }
    if (!fs.existsSync(target)) broken.push([p, link]);
  }
}
if (escaping.length) R("FAIL", `${escaping.length} relative links leave the repository (cross-repo links must be absolute https URLs); e.g. ` + escaping.slice(0, 4).map(([p, l]) => `${rel(p)} -> ${l}`).join("; "));
else R("PASS", "no relative link escapes the repository");
if (broken.length) {
  const by = new Map();
  for (const [p, l] of broken) (by.get(rel(p)) || by.set(rel(p), []).get(rel(p))).push(l);
  R("FAIL", `${broken.length} broken relative markdown links in ${by.size} files; first: ` + [...by].sort().slice(0, 5).map(([f, ls]) => `${f} -> ${ls[0]}`).join("; "));
} else R("PASS", "all relative markdown links resolve");

const LEAK = /(\/Users\/[A-Za-z0-9_.-]+\/|file:\/\/\/|\/home\/ubuntu\/|\/tmp\/(?:agent-sandbox|parity|venv)[A-Za-z0-9_-]*|Qoder\/20\d\d|\bthis VM\b)/g;
const leaks = new Map();
for (const p of files) {
  if (!/\.(md|txt|ya?ml|toml|json|sh|mjs|js|ts|py)$/.test(p)) continue;
  const r = rel(p);
  if (r === "scripts/check-repo-health.sh" || r === "docs/design/repository-layout.md" || r === "package-lock.json") continue;
  const n = (read(p).match(LEAK) || []).length;
  if (n) leaks.set(r, n);
}
if (leaks.size) R("FAIL", `${leaks.size} files leak machine-local paths (/Users/..., file:///, /tmp/parity, 'this VM'): ` + [...leaks.keys()].sort().slice(0, 6).join(", ") + (leaks.size > 6 ? " ..." : ""));
else R("PASS", "no machine-local paths in text files");

const adrRe = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;
const bad = [];
for (const p of files) {
  const r = rel(p);
  if (!r.startsWith(".agents/notes/") || !r.endsWith(".md") || ["README.md", "DEFINITION-OF-DONE.md"].includes(path.basename(r))) continue;
  const parts = r.split("/");
  const state = parts.length > 3 ? parts[2] : "";
  if (!adrRe.test(path.basename(r))) { bad.push(`${r}: name is not YYYY-MM-DD-slug.md`); continue; }
  const head = read(p).split("\n").slice(0, 6);
  if (!head[0] || !head[0].startsWith("# Decision:")) { bad.push(`${r}: first line is not '# Decision: <Title>'`); continue; }
  const line = head.find((l) => /^status:/i.test(l));
  const st = line ? line.split(":")[1].trim().toLowerCase() : null;
  if (st === null || (["proposed", "implemented", "rejected"].includes(state) && !st.startsWith(state))) bad.push(`${r}: Status '${st}' does not match directory '${state}'`);
}
if (bad.length) R("FAIL", `${bad.length} ADR(s) violate .agents/notes/README.md rules; first: ` + bad.slice(0, 3).join("; "));
else R("PASS", "every ADR has a dated name, '# Decision:' title and Status matching its directory");

const stems = new Set(files.filter((p) => adrRe.test(path.basename(p))).map((p) => path.basename(p).replace(/\.md$/, "")));
const dangling = new Map();
for (const p of files.filter((f) => /\.(md|txt)$/.test(f) && rel(f) !== "docs/design/repository-layout.md")) {
  const t = read(p).replace(/\[[^\]]*\]\(https?:\/\/[^)]*\)|https?:\/\/\S+/g, "");
  for (const m of t.matchAll(/(?<![0-9A-Za-z-])(\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]*[a-z0-9])(?![0-9A-Za-z-])/g)) {
    if (!stems.has(m[1])) (dangling.get(m[1]) || dangling.set(m[1], new Set()).get(m[1])).add(rel(p));
  }
}
if (dangling.size) {
  const nf = new Set([...dangling.values()].flatMap((s) => [...s])).size;
  R("FAIL", `${dangling.size} ADR/evidence slugs are referenced in ${nf} files but absent from this repo (cross-repo refs must be absolute URLs): ` + [...dangling.keys()].sort().slice(0, 4).join(", ") + (dangling.size > 4 ? " ..." : ""));
} else R("PASS", "no dangling ADR references");

const set = (lang) => new Set(files.map(rel).filter((r) => r.startsWith(`docs/${lang}/`) && r.endsWith(".md")).map((r) => r.slice(`docs/${lang}/`.length)));
const en = set("en"), zh = set("zh");
const onlyEn = [...en].filter((x) => !zh.has(x)).sort(), onlyZh = [...zh].filter((x) => !en.has(x)).sort();
if (onlyEn.length || onlyZh.length) R("FAIL", `docs en/zh mismatch: only en=${JSON.stringify(onlyEn.slice(0, 4))} only zh=${JSON.stringify(onlyZh.slice(0, 4))}`);
else R("PASS", "docs/en and docs/zh have the same page set");
let stale = 0;
for (const lang of ["en", "zh"]) {
  const idx = path.join(root, "docs", lang, "README.md");
  if (!fs.existsSync(idx)) continue;
  for (const line of read(idx).split("\n")) {
    const m = line.match(/\]\(([^)#]+)\)/);
    if (m && /coming soon|即将推出|翻译中/i.test(line) && fs.existsSync(path.join(path.dirname(idx), m[1]))) stale++;
  }
}
if (stale) R("WARN", `${stale} docs index rows still say 'coming soon' although the page exists`); else R("PASS", "docs index has no stale 'coming soon' rows");

const sib = path.join(root, "..", "python-sdk", "docs");
if (fs.existsSync(sib)) {
  const dup = [];
  for (const r of files.map(rel).filter((r) => /^docs\/(en|zh)\/.*\.md$/.test(r))) {
    const q = path.join(sib, r.slice("docs/".length));
    if (fs.existsSync(q) && fs.readFileSync(q).equals(fs.readFileSync(path.join(root, r)))) dup.push(r);
  }
  if (dup.length) R("FAIL", `${dup.length} doc pages are byte-identical in ../python-sdk/docs (one repo must own each page; the other links to it): ` + dup.slice(0, 4).join(", ") + " ...");
  else R("PASS", "no byte-identical doc pages shared with ../python-sdk");
}
console.log(out.join("\n"));
JS

printf '\n== Summary ==\n'
printf 'PASS=%d  WARN=%d  FAIL=%d\n' "$PASSES" "$WARNS" "$FAILS"
if [ "$FAILS" -gt 0 ] || { [ "$STRICT" -eq 1 ] && [ "$WARNS" -gt 0 ]; }; then
  exit 1
fi
exit 0

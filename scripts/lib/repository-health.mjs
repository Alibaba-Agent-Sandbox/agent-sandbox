/** Syntax-aware helpers for the repository health gate. Requires npm ci first. */
import ts from "typescript";
import crypto from "node:crypto";

function source(text, file = "source.ts") {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function imports(text, file) {
  const result = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) result.push(node.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) result.push(node.moduleReference.expression.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) result.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source(text, file));
  return result;
}

function canonicalRepository(value, issues = false) {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/^git\+/, "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
  return normalized === `https://github.com/alibaba-agent-sandbox/agent-sandbox${issues ? "/issues" : ""}`;
}

function productPython(relative) {
  return relative.endsWith(".py") && !relative.startsWith(".agents/") && !relative.startsWith("parity/") && !relative.startsWith("tests/fixtures/");
}

function removedCli(text, file) {
  let executable = "";
  if (/\.(?:mjs|cjs|js|ts)$/.test(file)) {
    function visit(node) {
      if (ts.isStringLiteralLike(node)) executable += `${node.text}\n`;
      ts.forEachChild(node, visit);
    }
    visit(source(text, file));
  } else {
    executable = text.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  }
  return /agent_sandbox\.cli|\.venv\/bin\/python|python3?\s+-m\s+agent_sandbox(?:\s|$)/.test(executable);
}

/** Historical context applies only to registered bytes and one explicit finding. */
function historicalContext(manifest, relative, bytes, kind, finding) {
  if (!/^\.agents\/(?:evidence\/|notes\/(?:implemented|superseded)\/)/.test(relative)) return false;
  if (kind === "localPaths" && !relative.startsWith(".agents/evidence/")) return false;
  const entry = manifest[relative];
  return Boolean(entry && entry.sha256 === crypto.createHash("sha256").update(bytes).digest("hex") && entry[kind]?.includes(finding));
}

export { imports, canonicalRepository, productPython, removedCli, historicalContext };

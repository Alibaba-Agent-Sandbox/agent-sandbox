#!/usr/bin/env node
// TS-AST inventory of cli/src: declared symbols per file, every string literal (decoded), env reads, exit calls.
// Usage: node ts_inventory.mjs [srcDir=../../../src] > ts-inventory.json
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(process.argv[2] ?? join(here, "../../../src"));
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".ts")) files.push(p);
  }
})(srcDir);

const out = { files: {}, literals: [], env_reads: [], exits: [] };
for (const f of files.sort()) {
  const rel = relative(srcDir, f);
  const text = readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
  const info = { classes: [], functions: [], methods: [], variables: [], types: [], exports: [] };
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const nameOf = (n) => (n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) || ts.isPrivateIdentifier(n.name)) ? n.name.text : null);
  function visit(n, ctxCall) {
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) { const nm = nameOf(n); if (nm) info.classes.push(nm); }
    else if (ts.isFunctionDeclaration(n)) { const nm = nameOf(n); if (nm) info.functions.push(nm); }
    else if (ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isPropertyDeclaration(n)) { const nm = nameOf(n); if (nm) info.methods.push(nm); }
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) info.variables.push(n.name.text);
    else if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n)) info.types.push(n.name.text);
    else if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) { const nm = nameOf(n); if (nm) info.methods.push(nm); }

    let nextCall = ctxCall;
    if (ts.isCallExpression(n)) {
      nextCall = n.expression.getText(sf).replace(/\s+/g, "");
      if (/^(process\.exit|ctx\.exit|exit|.*\.exit)$/.test(nextCall) || /(^|\.)(ExitError|Exit|SystemExit)$/.test(nextCall))
        out.exits.push({ file: rel, line: line(n), how: nextCall, code: n.arguments[0]?.getText(sf) ?? "" });
      if (/(^|\.)(environ\.get|getenv|envGet|getEnv|env\.get)$/.test(nextCall) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]))
        out.env_reads.push({ file: rel, line: line(n), name: n.arguments[0].text, how: nextCall });
    }
    if (ts.isNewExpression(n)) {
      const nm = n.expression.getText(sf);
      if (/^(ExitError|Exit|SystemExit)$/.test(nm)) out.exits.push({ file: rel, line: line(n), how: "new " + nm, code: n.arguments?.[0]?.getText(sf) ?? "" });
      nextCall = "new " + nm;
    }
    if (ts.isPropertyAccessExpression(n)) {
      const t = n.expression.getText(sf);
      if (/(^|\.)(process\.env|env|environ)$/.test(t)) out.env_reads.push({ file: rel, line: line(n), name: n.name.text, how: t + "." });
    }
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && /(^|\.)(process\.env|env|environ)$/.test(n.expression.getText(sf)))
      out.env_reads.push({ file: rel, line: line(n), name: n.argumentExpression.text, how: "env[]" });

    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.literals.push({ file: rel, line: line(n), context: ctxCall, text: n.text });
    } else if (ts.isTemplateExpression(n)) {
      out.literals.push({ file: rel, line: line(n), context: ctxCall, text: n.head.text });
      for (const s of n.templateSpans) out.literals.push({ file: rel, line: line(n), context: ctxCall, text: s.literal.text });
    }
    ts.forEachChild(n, (c) => visit(c, nextCall));
  }
  visit(sf, "");
  for (const k of Object.keys(info)) info[k] = [...new Set(info[k])];
  out.files[rel] = info;
}
process.stdout.write(JSON.stringify(out));

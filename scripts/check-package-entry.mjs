/** Accept npm's legacy array and newer package-name keyed pack reports. */
import path from "node:path";
import { readFileSync } from "node:fs";

let report;
try {
  report = JSON.parse(readFileSync(0, "utf8"));
} catch {
  console.error("Invalid npm pack JSON report");
  process.exit(1);
}
const entry = Array.isArray(report) ? report[0] : report?.["@agent-sandbox/cli"];
if (!Array.isArray(entry?.files) || !entry.files.some(file => file?.path === "dist/bin/abx.js")) {
  console.error("dist/bin/abx.js NOT found in package");
  process.exit(1);
}
console.log("dist/bin/abx.js found in package: OK");

// A skill installed from the npm tarball must retain its local reference closure.
const shipped = new Set(entry.files.map(file => file.path));
const pending = ["SKILL.md"];
const visited = new Set();
while (pending.length) {
  const file = pending.pop();
  if (visited.has(file)) continue;
  visited.add(file);
  if (!shipped.has(file)) {
    console.error(`Skill resource missing from package: ${file}`);
    process.exit(1);
  }
  const markdown = readFileSync(file, "utf8");
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
    if (!shipped.has(resolved)) {
      console.error(`Skill link missing from package: ${file} -> ${target}`);
      process.exit(1);
    }
    if (resolved.endsWith(".md")) pending.push(resolved);
  }
}
console.log("Skill reference closure found in package: OK");

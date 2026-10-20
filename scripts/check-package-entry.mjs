/** Accept npm's legacy array and newer package-name keyed pack reports. */
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

/** Synchronize the owner-published v1 decoder instead of maintaining a consumer dialect. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = path.join(root, "src/template/contract-v1");
const sourceFiles = {
  "contracts/template-v1/normalize.mjs": "normalize.mjs",
  "contracts/template-v1/normalize.d.mts": "normalize.d.mts",
  "contracts/template-v1/contract.json": "contract.json",
  "spec/template-v1.schema.json": "schema.json",
  "spec/registry-v1.schema.json": "registry.schema.json",
};
const hash = value => createHash("sha256").update(value).digest("hex");
const args = process.argv.slice(2);
if (args.includes("--check")) {
  const lock = JSON.parse(fs.readFileSync(path.join(destination, "source.json"), "utf8"));
  for (const name of Object.values(sourceFiles)) {
    if (hash(fs.readFileSync(path.join(destination, name))) !== lock.files[name]) throw new Error(`Template v1 contract drift: ${name}`);
  }
  process.stdout.write("Template v1 decoder/schema hashes match their source record.\n");
} else {
  const index = args.indexOf("--source");
  if (index < 0 || !args[index + 1]) throw new Error("Pass --source PATH for the awesome-templates owner checkout.");
  const source = path.resolve(args[index + 1]);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const candidate = args.includes("--candidate"), bytes = {}, files = {};
  for (const [relative, name] of Object.entries(sourceFiles)) {
    bytes[name] = fs.readFileSync(path.join(source, relative));
    if (!candidate) {
      const committed = execFileSync("git", ["show", `${revision}:${relative}`], { cwd: source });
      if (!committed.equals(bytes[name])) throw new Error(`Uncommitted owner contract: ${relative}; use --candidate only for explicitly unmerged integration work.`);
    }
    files[name] = hash(bytes[name]);
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const [name, value] of Object.entries(bytes)) fs.writeFileSync(path.join(destination, name), value);
  fs.writeFileSync(path.join(destination, "source.json"), JSON.stringify({
    repository: "https://github.com/Alibaba-Agent-Sandbox/awesome-templates", revision,
    ...(candidate ? { sourceState: "unmerged-owner-working-tree" } : {}), files,
  }, null, 2) + "\n");
  process.stdout.write(`Synced template v1 ${candidate ? "candidate bytes based on" : "at"} ${revision}.\n`);
}

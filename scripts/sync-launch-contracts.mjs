/** Vendor the whole-template contract from its immutable Python SDK owner revision. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const files = {"launch-v1.json": "src/template/launch-v1.json", "launch-vectors.json": "tests/test_template/fixtures/launch-vectors.json"};
const lockPath = path.join(root, "src/template/launch-contract.lock.json");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
if (args.includes("--check")) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  for (const [name, destination] of Object.entries(files)) if (digest(fs.readFileSync(path.join(root, destination))) !== lock.files[name]) throw new Error(`Launch contract drift: ${name}`);
  console.log("Launch contract and vector hashes match.");
} else {
  const index = args.indexOf("--source");
  if (index < 0 || !args[index + 1]) throw new Error("Pass --source PATH for the python-sdk checkout.");
  const source = path.resolve(args[index + 1]);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {cwd: source, encoding: "utf8"}).trim();
  const hashes = {};
  for (const [name, destination] of Object.entries(files)) {
    const committed = execFileSync("git", ["show", `${revision}:contracts/${name}`], {cwd: source});
    if (!committed.equals(fs.readFileSync(path.join(source, "contracts", name)))) throw new Error(`Uncommitted owner contract: ${name}`);
    fs.writeFileSync(path.join(root, destination), committed); hashes[name] = digest(committed);
  }
  fs.writeFileSync(lockPath, JSON.stringify({repository: "https://github.com/Alibaba-Agent-Sandbox/python-sdk", revision, files: hashes}, null, 2) + "\n");
  console.log(`Synced launch contracts at ${revision}.`);
}

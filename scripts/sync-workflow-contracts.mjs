/** Reproducibly vendor owner contracts from an explicit checkout and immutable revision. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2), sourceIndex = args.indexOf("--source"), check = args.includes("--check");
const destination = fileURLToPath(new URL("../src/template/", import.meta.url));
const names = ["workflow-v1.json", "verification-profiles.json", "receipt.schema.json"];
const lockFile = path.join(destination, "workflow-contract.lock.json");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
if (check) {
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  for (const name of names) if (digest(fs.readFileSync(path.join(destination, name))) !== lock.files[name]) throw new Error(`Workflow contract drift: ${name}`);
  console.log("Workflow owner contract hashes match.");
} else {
  if (sourceIndex < 0 || !args[sourceIndex + 1]) throw new Error("Pass --source PATH for the python-sdk owner checkout.");
  const source = path.resolve(args[sourceIndex + 1]);
  const revision = execFileSync("git", ["-c", "core.filemode=false", "rev-parse", "HEAD"], {cwd:source,encoding:"utf8"}).trim();
  const files = {};
  for (const name of names) {
    const committed = execFileSync("git", ["-c", "core.filemode=false", "show", `${revision}:contracts/${name}`], {cwd:source,maxBuffer:16*1024*1024});
    const actual = fs.readFileSync(path.join(source,"contracts",name));
    if (!actual.equals(committed)) throw new Error(`Owner contract has uncommitted changes: ${name}`);
    fs.writeFileSync(path.join(destination,name),committed); files[name] = digest(committed);
  }
  fs.writeFileSync(lockFile,JSON.stringify({repository:"https://github.com/Alibaba-Agent-Sandbox/python-sdk",revision,files},null,2)+"\n");
  const vectors = execFileSync("git",["-c","core.filemode=false","show",`${revision}:contracts/vectors.json`],{cwd:source,maxBuffer:16*1024*1024});
  fs.mkdirSync(fileURLToPath(new URL("../tests/test_template/fixtures/",import.meta.url)),{recursive:true});
  fs.writeFileSync(fileURLToPath(new URL("../tests/test_template/fixtures/workflow-vectors.json",import.meta.url)),vectors);
  console.log(`Synced contracts at ${revision}.`);
}

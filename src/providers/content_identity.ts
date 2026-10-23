/** Content identities bind executable provider input, never version strings alone. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProviderConfigError } from "../models/provider_errors.js";
const excluded = new Set([".git", "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", "node_modules", ".venv", "data", ".abx-install.json"]);
/** Hash the eligible plugin files using the shared path-NUL-bytes-NUL encoding. */
export function providerContentDigest(root: string): string {
  const files: string[]=[];
  function visit(directory:string):void {
    for(const name of fs.readdirSync(directory)) {
      if(excluded.has(name)||name===".env"||name.startsWith(".env.")||/\.(pem|key|pyc)$/.test(name))continue;
      const file=path.join(directory,name),stat=fs.lstatSync(file);
      if(stat.isSymbolicLink())throw new ProviderConfigError("Provider content identity refuses symlinked inputs.");
      if(stat.isDirectory())visit(file);
      else if(stat.isFile())files.push(path.relative(root,file).split(path.sep).join("/"));
      else throw new ProviderConfigError("Provider content identity requires regular files.");
    }
  }
  visit(root);files.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
  const hash=createHash("sha256");for(const name of files)hash.update(name).update("\0").update(fs.readFileSync(path.join(root,name))).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

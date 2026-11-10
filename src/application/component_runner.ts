/** Isolated component host source; emitted to an owned temporary runner, never evaluated in the CLI process. */
export const COMPONENT_RUNNER_SOURCE = String.raw`
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {createRequire} = require("node:module");
const request = JSON.parse(fs.readFileSync(0, "utf8"));
let logCount = 0;
const logs = []; let logBytes = 0;
if (request.command === "logs") console.log = (...values) => {
  const line = values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ");
  logBytes += Buffer.byteLength(line);
  if (logs.length >= 10000 || logBytes > 1024 * 1024) throw new Error("Log output exceeds capture limit");
  logs.push(line.replace(/\x1b\[[0-9;]*m/g, ""));
};
let stage = "load", credentialRequests = 0;
const noop = () => { logCount += 1; };
const progress = new Proxy({}, {get: () => noop});
const logger = new Proxy(noop, {get: (_, key) => key === "progress" || key === "getProgressBar" ? (() => progress) : noop});
const write = value => fs.writeFileSync(3, JSON.stringify(value));
(async () => {
  const requireFromLoader = createRequire(request.loaderPath);
  const loaded = requireFromLoader(request.loaderPath);
  const loadComponent = loaded.default || loaded;
  const instance = await loadComponent(request.component, {logger, cleanCache: true});
  if (!instance || ["deploy", "info", "remove"].some(key => typeof instance[key] !== "function")) throw new Error("Unsupported component lifecycle");
  if (request.action === "prepare") {
    if (typeof instance.__path !== "string" || !fs.statSync(instance.__path).isDirectory()) throw new Error("No component bundle path");
    write({componentPath: instance.__path, version: String(instance.__version || ""), logCount});
    return;
  }
  if (!["deploy", "info", "remove", "logs"].includes(request.command) || typeof instance[request.command] !== "function") throw new Error("Unsupported lifecycle method");
  stage = "invoke";
  const input = {
    cwd: request.cwd, name: request.name, props: request.props, command: request.command,
    yaml: {path: path.join(request.cwd, "generated-component.yaml")},
    resource: {name: request.resource, component: request.component, access: "abx-resolved-snapshot"},
    args: ["--assume-yes", "--skip-push"],
    getCredential: async () => { credentialRequests += 1; return {...request.credential}; },
  };
  const result = await instance[request.command](input);
  write({result, logCount, ...(request.command === "logs" ? {logs} : {})});
})().catch(error => { write({error: "Component operation failed; raw output withheld.", stage, credentialRequests,
  ...(typeof error.code === "string" && /^[A-Za-z0-9_.]{1,80}$/.test(error.code) ? {code:error.code} : {})}); });
`;

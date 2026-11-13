import { FC_CREATION_GUARD_SOURCE } from "./component_creation_guard.js";
/** Isolated native component host. FD 3 carries results; optional FD 4 carries sanitized log events. */
export const COMPONENT_RUNNER_SOURCE = String.raw`
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {format, stripVTControlCharacters} = require("node:util");
const {StringDecoder} = require("node:string_decoder");
const {createRequire} = require("node:module");
const request = JSON.parse(fs.readFileSync(0, "utf8"));
${FC_CREATION_GUARD_SOURCE}
let logCount = 0, stage = "load", credentialRequests = 0, eventBytes = 0;
const logs = []; let logBytes = 0;
const secrets = new Set((request.sensitiveValues || []).filter(value => typeof value === "string" && value.length));
const sensitiveKey = /(?:secret|password|passwd|token|authorization|api[-_]?key|access[-_]?key)/i;
function collect(value, sensitive = false) {
  if (typeof value === "string") { if (sensitive && value) secrets.add(value); return; }
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) collect(child, sensitive || sensitiveKey.test(key));
}
collect(request.credential); collect(request.props);
for (const [key, value] of Object.entries(process.env)) if (sensitiveKey.test(key) && value) secrets.add(value);
const replacements = [...secrets].sort((a, b) => b.length - a.length);
function redact(value) {
  let text = stripVTControlCharacters(String(value));
  for (const secret of replacements) text = text.split(secret).join("[REDACTED]");
  return text.replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/((?:password|passwd|secret|token|authorization|api[_-]?key|access[_-]?key)(?:[A-Za-z_]*)["']?\s*[:=]\s*)["']?[^\s,;}"']+["']?/gi, "$1[REDACTED]")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}
function emit(level, values) {
  logCount += 1;
  if (!request.events) return;
  const message = redact(format(...values));
  if (!message.trim()) return;
  const event = JSON.stringify({level, message, component: redact(request.componentReference || request.component),
    resource: redact(request.resource || ""), command: redact(request.command || "")}) + "\n";
  eventBytes += Buffer.byteLength(event);
  if (eventBytes > 1024 * 1024) throw new Error("Component log output exceeds capture limit");
  fs.writeSync(4, event);
}
const once = new Set();
const progress = new Proxy({}, {get: (_, key) => key === "then" ? undefined : (...values) => emit("info", values)});
const logger = new Proxy(function(...values) { if (values.length) emit("info", values); return logger; }, {
  get: (_, key) => {
    if (key === "then") return undefined;
    if (key === "instance" || key === "logger") return logger;
    if (key === "progress" || key === "getProgressBar") return () => progress;
    return (...values) => {
      if (String(key).endsWith("Once")) { const item = String(key) + format(...values); if (once.has(item)) return; once.add(item); }
      emit(key === "debug" ? "debug" : key === "warn" || key === "warning" || key === "warnOnce" ? "warning" : key === "error" ? "error" : "info", values);
    };
  },
});
const flushers = [];
if (request.events) {
  // Some native tools write directly to process streams. Buffer complete lines before
  // redacting so a credential split over writes cannot bypass the log bridge.
  for (const [stream, level] of [[process.stdout, "info"], [process.stderr, "warning"]]) {
    const decoder = new StringDecoder("utf8"); let buffer = "", discarding = false;
    const flush = () => { if (buffer && !discarding) emit(level, [buffer]); buffer = ""; discarding = false; };
    stream.write = (chunk, encoding, callback) => {
      const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
      for (const part of text.split(/(?<=\n)/)) {
        if (!discarding) buffer += part;
        if (Buffer.byteLength(buffer) > 65536) { buffer = ""; discarding = true; }
        if (part.endsWith("\n")) flush();
      }
      const done = typeof encoding === "function" ? encoding : callback; if (typeof done === "function") done();
      return true;
    };
    flushers.push(flush);
  }
  for (const [method, level] of [["log", "info"], ["info", "info"], ["debug", "debug"], ["warn", "warning"], ["error", "error"]]) console[method] = (...values) => emit(level, values);
}
if (request.command === "logs") console.log = (...values) => {
  const line = values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ");
  logBytes += Buffer.byteLength(line);
  if (logs.length >= 10000 || logBytes > 1024 * 1024) throw new Error("Log output exceeds capture limit");
  logs.push(stripVTControlCharacters(line));
};
const write = value => { for (const flush of flushers) flush(); fs.writeFileSync(3, JSON.stringify(value)); };
(async () => {
  const loaded = typeof __abxLoadComponent === "function" ? __abxLoadComponent() : createRequire(request.loaderPath)(request.loaderPath);
  const loadComponent = loaded.default || loaded;
  const instance = await loadComponent(request.component, {logger, cleanCache: true});
  if (!instance) throw new Error("Component loader returned no instance");
  if (request.action === "prepare") {
    if (typeof instance.__path !== "string" || !fs.statSync(instance.__path).isDirectory()) throw new Error("No component bundle path");
    write({componentPath: instance.__path, version: String(instance.__version || ""), logCount});
    return;
  }
  if (!/^[a-z][a-zA-Z0-9-]*$/.test(request.command) || ["constructor", "prototype", "__proto__"].includes(request.command) || typeof instance[request.command] !== "function") throw new Error("Unsupported component method");
  stage = "invoke";
  const input = {
    cwd: request.cwd, name: request.name, props: request.props, command: request.command,
    yaml: {path: request.yamlPath || path.join(request.cwd, "generated-component.yaml")},
    resource: {name: request.resource, component: request.componentReference || request.component, access: "abx-resolved-snapshot"},
    args: request.args === undefined ? ["--assume-yes", "--skip-push"] : request.args,
    getCredential: async () => { credentialRequests += 1; return {...request.credential}; },
  };
  const result = await instance[request.command](input);
  if (!fcCreateGuardSatisfied) {const error = new Error("FC component did not confirm a new owned function; refusing to adopt an existing or uncertain result."); error.code = "ABX_FC_CREATE_UNCONFIRMED"; throw error;}
  write({result, logCount, ...(request.command === "logs" ? {logs} : {})});
})().catch(error => { write({error: "Component operation failed; raw output withheld.", stage, credentialRequests,
  ...(typeof error.code === "string" && /^[A-Za-z0-9_.]{1,80}$/.test(error.code) ? {code:redact(error.code)} : {}),
  ...(request.events && typeof error.message === "string" ? {message: redact(error.message).slice(0, 2048)} : {})}); });
`;

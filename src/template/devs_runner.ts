/** Native Devs parsing runs outside the CLI because it loads dotenv and private configuration. */
export const DEVS_PARSE_RUNNER_SOURCE = String.raw`
"use strict";
const fs = require("node:fs");
const {createRequire} = require("node:module");
const request = JSON.parse(fs.readFileSync(0, "utf8"));
const write = value => fs.writeFileSync(3, JSON.stringify(value));
const noop = () => {};
const logger = new Proxy(noop, {get: () => noop});
(async () => {
  const loaded = typeof __abxParseSpec === "function" ? __abxParseSpec() : createRequire(request.parserPath)(request.parserPath);
  const {ParseSpecForContent} = loaded;
  const parsed = await new ParseSpecForContent(request.content, {
    argv: [request.command], logger, isPreview: false,
  }).start();
  write({content: parsed.yaml.content, steps: parsed.steps.map(step => ({
    resource: step.projectName, component: step.component, order: step.order,
  }))});
})().catch(error => {
  // Native errors can contain resolved credentials and template snippets. Never forward them.
  const missing = /env\(['"]([A-Za-z_][A-Za-z0-9_]*)['"]\) not found/.exec(String(error.message));
  write({error: "native_parse_failed", ...(missing ? {missingEnvironment: missing[1]} : {})});
  process.exitCode = 1;
});
`;

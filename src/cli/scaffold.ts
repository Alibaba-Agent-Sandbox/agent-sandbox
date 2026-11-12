/**
 * Built-in template scaffolds for `abx template init` (port of `cli/scaffold.py`).
 *
 * Provides pre-defined template cases (python, node, minimal). The Dockerfile base image and start style come from
 * the selected provider template profile (`{name}` is the only placeholder; `{{` / `}}` are literal braces).
 */

import { mcpScaffold } from "./scaffold_mcp.js";
import { ValueError } from "../utils/_pyerrors.js";
import {
  ABX_SERVER_INSTALL,
  dockerfileCmdLine,
  resolveTemplateProfile,
  type TemplateProfile,
} from "../providers/template_profile.js";

// ---------------------------------------------------------------------------------------------------------------------
// Case definitions: [name, description]
// ---------------------------------------------------------------------------------------------------------------------

const _CASES: ReadonlyArray<readonly [string, string]> = [
  ["python", "Python sandbox with shell, files, and code capabilities"],
  ["node", "Node.js sandbox with shell, files, and code capabilities"],
  ["minimal", "Minimal template with template.yaml, Dockerfile, and README"],
  ["mcp", "Authenticated MCP Streamable HTTP application"],
];

const _COMMANDS = `"""Named commands for {name}."""
from __future__ import annotations

import os

from agent_sandbox.server import command, start


@command("hello", description="Say hello.")
def hello(name: str = "World") -> str:
    return f"Hello, {{name}}!"


if __name__ == "__main__":
    start(int(os.environ.get("ABX_SERVER_PORT", "9000")))
`;

function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Resource values are local; publication metadata is optional and belongs in registry.yaml. */
function templateYaml(profile: TemplateProfile, cpu: number, minimal = false): string {
  const start = profile.server_start === "platform_start_cmd" && profile.start_cmd ? profile.start_cmd : `agent-sandbox-server serve --port 9000 --commands ${profile.workdir}/commands.py`;
  return `specVersion: 1
name: {name}
sandbox:
  template:
    source: { dockerfile: Dockerfile, context: . }
    props: { cpu: ${cpu}, memory: 2048 }
${minimal ? "  services: {}\n" : `  instance:
    envs: { ABX_SERVER_TOKEN: "" }
  start: ${quoted(start)}
${profile.ready_cmd ? `  ready: ${quoted(profile.ready_cmd)}\n` : ""}  services:
    app: { protocol: agent-sandbox-server, version: 2, port: 9000, operations: [commands.list, commands.run] }
`}`;
}

function dockerfile(profile: TemplateProfile, opts: { copyCommands: boolean }): string {
  const cmd = dockerfileCmdLine(profile);
  const lines = [
    `FROM ${profile.base_image}`,
    "",
    "ENV DEBIAN_FRONTEND=noninteractive",
    "",
    "# Install agent-sandbox-server (the in-sandbox HTTP server).",
    ABX_SERVER_INSTALL,
    "",
    `WORKDIR ${profile.workdir}`,
  ];
  if (profile.user) lines.push(`USER ${profile.user}`);
  if (opts.copyCommands) {
    lines.push("COPY commands.py .", "", "EXPOSE 9000");
    if (cmd && profile.server_start === "platform_start_cmd") lines.push(cmd);
  }
  return `${lines.join("\n")}\n`;
}

function readme(blurb: string, profile: TemplateProfile): string {
  const who = profile.user || "the image default user";
  const deploy = `Run from this project directory. Deploy prompts for missing configuration in a terminal.
It builds the source and starts a named application using the selected Provider.

\`\`\`bash
abx --provider ${profile.provider_id} deploy . --name {name}
abx sandbox command run {name} hello --arg name=Ada
abx delete {name} --yes
\`\`\`

For automation, configure the required values before adding \`--yes\` to deploy.
The Provider must support source template preparation and application endpoints.`;
  return `# {name}

${blurb}

Base image: \`${profile.base_image}\`.
Default user: \`${who}\`. Working directory: \`${profile.workdir}\`.

## What this template serves

\`commands.py\` starts \`agent-sandbox-server\` on port 9000. The enabled groups are files, process, and system, plus the \`hello\` command.

| Call | What it does |
|---|---|
| \`GET /health\` | Process is up |
| \`GET /commands\` | Lists \`hello\` |
| \`POST /commands/hello\` | Body \`{"name":"Ada"}\`, returns \`{"result":"Hello, Ada!"}\` |
| \`POST /shell\` | Runs a shell command and returns stdout |
| \`POST /files\` | Upload a file under the server base directory |

## Deploy

${profile.registry}

${deploy}

## Call it over HTTP

Use \`abx status {name}\` to inspect the endpoint. External clients must send the
application token as a Bearer token and include any additional traffic headers required
by the Provider. \`ABX_SERVER_TOKEN\` is the application token generated and saved by
abx; it is separate from the Provider's Sandbox API key.
`;
}

function caseFiles(caseName: string, profile: TemplateProfile): Map<string, string> | undefined {
  if (caseName === "mcp") return mcpScaffold(profile);
  if (caseName === "python") {
    return new Map([
      ["template.yaml", templateYaml(profile, 2)],
      ["Dockerfile", dockerfile(profile, { copyCommands: true })],
      ["commands.py", _COMMANDS],
      ["README.md", readme("A Python sandbox template generated by `abx template init`.", profile)],
    ]);
  }
  if (caseName === "node") {
    return new Map([
      ["template.yaml", templateYaml(profile, 1)],
      ["Dockerfile", dockerfile(profile, { copyCommands: true })],
      ["commands.py", _COMMANDS],
      ["README.md", readme("A Node.js sandbox template generated by `abx template init`. The base image and start style come from the selected provider template profile.", profile)],
    ]);
  }
  if (caseName === "minimal") {
    return new Map([
      ["template.yaml", templateYaml(profile, 2, true)],
      ["Dockerfile", dockerfile(profile, { copyCommands: false })],
      ["README.md", readme("A minimal sandbox template generated by `abx template init`.", profile)],
    ]);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------------

/** Return a list of `[case_name, short_description]` for built-in scaffolds. */
export function availableCases(): Array<[string, string]> {
  return _CASES.map(([name, description]) => [name, description]);
}

/**
 * Render a scaffold case, substituting `name` into templates.
 *
 * The Dockerfile `FROM` and start style come from the selected provider template profile (`providerId`, or the
 * provider `abx` already resolved).
 *
 * @param caseName One of the built-in case names (`python`, `node`, `minimal`).
 * @param name Template name to substitute into `template.yaml` and other files.
 * @returns A Map of relative file names to their rendered content (in creation order).
 * @throws `ValueError` (message `Unknown scaffold case '<case>'. Valid cases: python, node, minimal`) when `caseName`
 *   is not a recognised scaffold name.
 */
export function renderScaffold(caseName: string, name: string, providerId?: string | null): Map<string, string> {
  const profile = resolveTemplateProfile(providerId);
  const templates = caseFiles(caseName, profile);
  if (templates === undefined) {
    const valid = _CASES.map((c) => c[0]).join(", ");
    throw new ValueError(`Unknown scaffold case '${caseName}'. Valid cases: ${valid}`);
  }
  const safeName = String(name).replace(/[{}]/g, "");
  const rendered = new Map<string, string>();
  for (const [filename, content] of templates) {
    rendered.set(
      filename,
      caseName === "mcp" ? content.replaceAll("{name}", safeName) :
        content.replace(/\{\{|\}\}|\{name\}/g, (token) => (token === "{{" ? "{" : token === "}}" ? "}" : safeName)),
    );
  }
  return rendered;
}

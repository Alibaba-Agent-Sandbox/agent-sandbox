/** Regression coverage for complete Docker RUN instructions during server wheel injection. */
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { rewriteDockerfileForServerInstall } from "../../src/providers/alicloud_express/docker_builder.js";
import { SERVER_SDK_PIP_SPEC, SERVER_SDK_RELEASE_SPEC } from "../../src/utils/server_sdk_pin.js";

const WHEEL = "agent_sandbox_server-0.3.0-py3-none-any.whl";
const INSTALL = `pip install --no-cache-dir "${SERVER_SDK_PIP_SPEC}"`;

/** Read shell-form RUN bodies independently, then let the actual shell validate the result. */
function runBodies(text: string): string[] {
  const lines = text.split("\n");
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*RUN\s+(.*)/i.exec(lines[i]!);
    if (!match) continue;
    let body = match[1]!;
    while (body.trimEnd().endsWith("\\") && i + 1 < lines.length) body += "\n" + lines[++i]!;
    bodies.push(body);
  }
  return bodies;
}

function expectValidSingleRun(text: string): string {
  const bodies = runBodies(text);
  expect(bodies).toHaveLength(1);
  if (process.platform !== "win32") {
    const syntax = spawnSync("/bin/sh", ["-n", "-c", bodies[0]!], { encoding: "utf8" });
    expect(syntax.stderr).toBe("");
    expect(syntax.status).toBe(0);
  }
  return bodies[0]!;
}

describe("server wheel Dockerfile structure", () => {
  it("injects a local wheel into the published alpha requirement while preserving unrelated pins", () => {
    const source = `FROM scratch\nRUN pip install "${SERVER_SDK_RELEASE_SPEC}" pandas==3.0.3\n`;
    expect(rewriteDockerfileForServerInstall(source, [WHEEL])).toContain(`pip install /tmp/${WHEEL} pandas==3.0.3`);
    expect(rewriteDockerfileForServerInstall(source, [])).toBe(source);
  });

  it("keeps a conditional wheel install as one valid RUN", () => {
    const source = `FROM scratch\nCOPY *.whl /tmp/\nRUN if ls /tmp/*.whl 1>/dev/null 2>&1; then \\\n        pip install --no-cache-dir /tmp/*.whl && rm -f /tmp/*.whl; \\\n    else \\\n        ${INSTALL}; \\\n    fi\nUSER user\nEXPOSE 9000\n`;
    const output = rewriteDockerfileForServerInstall(source, [WHEEL]);
    const run = expectValidSingleRun(output);
    expect(run).toContain("if ls /tmp/*.whl");
    expect(run).toContain("else \\\n");
    expect(run).toContain("fi");
    expect(output).toContain(`COPY ${WHEEL} /tmp/${WHEEL}\nRUN if`);
    expect(output).toContain("USER user\nEXPOSE 9000\n");
  });

  it("preserves commands on both sides of a continued direct archive install", () => {
    const source = `FROM scratch\nRUN echo before \\\n    && ${INSTALL} \\\n    && echo after\nUSER user\n`;
    const output = rewriteDockerfileForServerInstall(source, [WHEEL]);
    const run = expectValidSingleRun(output);
    expect(run).toContain("echo before");
    expect(run).toContain(`pip install --no-cache-dir /tmp/${WHEEL} \\\n    && echo after`);
    expect(output).not.toContain("github.com");
    expect(output).toContain("USER user");
  });

  it("replaces only the server requirement and preserves other pip packages and flags", () => {
    const source = `FROM scratch\nRUN ${INSTALL} httpx==0.28.1 --disable-pip-version-check && echo done\n`;
    const output = rewriteDockerfileForServerInstall(source, [WHEEL]);
    const run = expectValidSingleRun(output);
    expect(run).toBe(`pip install --no-cache-dir /tmp/${WHEEL} httpx==0.28.1 --disable-pip-version-check && echo done`);
  });

  it("does not rewrite comments, echoed requirements or a different package using that archive", () => {
    const source = `FROM scratch\n# ${INSTALL}\nLABEL description="${SERVER_SDK_PIP_SPEC}"\nRUN echo '${INSTALL}' && pip install --no-cache-dir "different-package @ ${SERVER_SDK_PIP_SPEC.split(" @ ")[1]}"\n`;
    expect(rewriteDockerfileForServerInstall(source, [WHEEL])).toBe(source);
  });

  it("leaves unrelated exact pins intact without a wheel", () => {
    const source = 'FROM scratch\nRUN pip install --no-cache-dir agent-sandbox-server==1.2.3 agent-sandbox-server-extra==4.5.6\n';
    expect(rewriteDockerfileForServerInstall(source, [])).toBe(source);
  });

  it("keeps heredoc source text and exec-form instructions intact", () => {
    const source = `FROM scratch\nRUN python3 - <<'PY'\nprint('${INSTALL}')\nCOPY *.whl /tmp/\nPY\nRUN ["echo", "${SERVER_SDK_PIP_SPEC}"]\n`;
    expect(rewriteDockerfileForServerInstall(source, [WHEEL])).toBe(source);
    expect(rewriteDockerfileForServerInstall(source, [])).toBe(source);
  });

  it("does not treat echoed control words or pip text as executed commands", () => {
    const source = `FROM scratch\nRUN echo then pip install "${SERVER_SDK_PIP_SPEC}"\n`;
    expect(rewriteDockerfileForServerInstall(source, [WHEEL])).toBe(source);
    const bare = 'FROM scratch\nRUN echo pip install --no-cache-dir agent-sandbox-server\n';
    expect(rewriteDockerfileForServerInstall(bare, [])).toBe(bare);
  });

  it("does not mistake quoted heredoc text for an actual heredoc", () => {
    const source = `FROM scratch\nRUN echo '<<EOF'\nRUN ${INSTALL}\n`;
    const output = rewriteDockerfileForServerInstall(source, [WHEEL]);
    expect(output).toContain("RUN echo '<<EOF'\nCOPY " + WHEEL);
    expect(output).not.toContain("github.com");
  });

  it("adds wheels in each affected build stage and keeps an unrelated PyPI pin", () => {
    const source = `FROM scratch AS first\nRUN ${INSTALL}\nFROM scratch\nRUN pip install --no-cache-dir agent-sandbox-server==1.2.3\nRUN python3 -m ${INSTALL}\n`;
    const output = rewriteDockerfileForServerInstall(source, [WHEEL, "extra-1.0-py3-none-any.whl", "../invalid.whl"]);
    expect(output.match(new RegExp("COPY " + WHEEL, "g"))).toHaveLength(2);
    expect(output).toContain("agent-sandbox-server==1.2.3");
    expect(output).toContain("python3 -m pip install --no-cache-dir /tmp/" + WHEEL + " /tmp/extra-1.0-py3-none-any.whl");
    expect(output).not.toContain("../invalid.whl");
  });

  it("preserves the standard no-wheel conditional fallback", () => {
    const source = 'FROM scratch\nCOPY *.whl /tmp/\nRUN if ls /tmp/*.whl; then pip install /tmp/*.whl; else pip install --no-cache-dir agent-sandbox-server; fi\n';
    const output = rewriteDockerfileForServerInstall(source, []);
    expectValidSingleRun(output);
    expect(output).not.toContain("COPY *.whl");
    expect(output).toContain(SERVER_SDK_PIP_SPEC);
  });
});

/**
 * Image — chain-style image builder (Modal-inspired) (port of `api/image.py`).
 *
 * Usage:
 *
 *     const image = Image.fromTemplate("python-base")
 *       .pipInstall("flask", "sqlalchemy")
 *       .aptInstall("postgresql-client")
 *       .env({ DATABASE_URL: "postgresql://localhost/mydb" })
 *       .runCommand("echo 'setup complete'");
 *     const dockerfile = image.toDockerfile();
 *     const template_info = await image.build({ alias: "my-flask-app" });
 */

import type { TemplateInfo } from "../models/template.js";
import { getLogger } from "../utils/logging.js";
import { pyRepr } from "../utils/_pyformat.js";
import { TemplateManager } from "./template.js";
import { createAuthProvider } from "../transport/auth.js";
import { loadConfig } from "../transport/config.js";
import { HttpClient } from "../transport/http.js";

const logger = getLogger("api.image");
void logger;

export interface ImageBuildOptions {
  alias?: string | null;
  api_key?: string | null;
  api_url?: string | null;
  access_key_id?: string | null;
  access_key_secret?: string | null;
  timeout?: number;
  cpu_count?: number | null;
  memory_mb?: number | null;
  start_cmd?: string | null;
}

/** Chain-style image builder: constructs a Dockerfile incrementally via fluent API calls. */
export class Image {
  _steps: string[] = [];
  _base: string = "ubuntu:22.04";
  _envs: Record<string, string> = {};
  _from_template: string | null = null;
  _workdir: string | null = null;
  _exposed_ports: number[] = [];
  _entrypoint: string | null = null;

  /** Create an image based on an existing template (no FROM directive; template_id is passed to the build API). */
  static fromTemplate(template: string): Image {
    const img = new Image();
    img._from_template = template;
    img._base = template; // used in dockerfile as FROM base reference
    return img;
  }

  /** Create from a Docker image (e.g. "python:3.11-slim"). */
  static fromImage(image: string): Image {
    const img = new Image();
    img._base = image;
    return img;
  }

  /** Install Python packages via pip. */
  pipInstall(...packages: string[]): Image {
    if (packages.length) {
      this._steps.push(`RUN pip install --no-cache-dir ${packages.join(" ")}`);
    }
    return this;
  }

  /** Install system packages via apt. */
  aptInstall(...packages: string[]): Image {
    if (packages.length) {
      const pkgs = packages.join(" ");
      this._steps.push(`RUN apt-get update && apt-get install -y ${pkgs} && rm -rf /var/lib/apt/lists/*`);
    }
    return this;
  }

  /** Copy local files into the image. */
  copyLocal(src: string, dst: string): Image {
    this._steps.push(`COPY ${src} ${dst}`);
    return this;
  }

  /** Set environment variables. */
  env(vars: Record<string, string>): Image {
    Object.assign(this._envs, vars);
    return this;
  }

  /** Execute a shell command during build. */
  runCommand(cmd: string): Image {
    this._steps.push(`RUN ${cmd}`);
    return this;
  }

  /** Set the working directory. */
  workdir(path: string): Image {
    this._workdir = path;
    return this;
  }

  /** Expose ports. */
  expose(...ports: number[]): Image {
    this._exposed_ports.push(...ports);
    return this;
  }

  /** Set the entrypoint command. */
  entrypoint(cmd: string): Image {
    this._entrypoint = cmd;
    return this;
  }

  /** Generate Dockerfile content from the build chain. */
  toDockerfile(): string {
    const lines: string[] = [`FROM ${this._base}`];

    for (const step of this._steps) {
      lines.push(step);
    }

    for (const [key, val] of Object.entries(this._envs)) {
      lines.push(`ENV ${key}=${val}`);
    }

    if (this._workdir) {
      lines.push(`WORKDIR ${this._workdir}`);
    }

    for (const port of this._exposed_ports) {
      lines.push(`EXPOSE ${port}`);
    }

    if (this._entrypoint) {
      lines.push(`CMD ${this._entrypoint}`);
    }

    return lines.join("\n");
  }

  /** Build the image as a template on the platform. Creates an HTTP client, builds the Dockerfile, and waits for completion. */
  async build(opts: ImageBuildOptions = {}): Promise<TemplateInfo> {
    const {
      alias = null,
      api_key = null,
      api_url = null,
      access_key_id = null,
      access_key_secret = null,
      timeout = 600,
      cpu_count = null,
      memory_mb = null,
      start_cmd = null,
    } = opts;

    const config_overrides: Record<string, unknown> = {};
    if (api_key !== null) config_overrides["api_key"] = api_key;
    if (api_url !== null) config_overrides["api_url"] = api_url;
    if (access_key_id !== null) config_overrides["access_key_id"] = access_key_id;
    if (access_key_secret !== null) config_overrides["access_key_secret"] = access_key_secret;

    const config = loadConfig(config_overrides);
    const auth = createAuthProvider({
      api_key: config.api_key,
      access_key_id: config.access_key_id,
      access_key_secret: config.access_key_secret,
    });
    const http_client = new HttpClient(config, auth);

    try {
      const manager = new TemplateManager(http_client);
      const dockerfile = this.toDockerfile();
      return await manager.build(dockerfile, { alias, timeout, cpu_count, memory_mb, start_cmd });
    } finally {
      await http_client.close();
    }
  }

  __repr__(): string {
    return `<Image base=${pyRepr(this._base)} steps=${this._steps.length} envs=${Object.keys(this._envs).length}>`;
  }
}

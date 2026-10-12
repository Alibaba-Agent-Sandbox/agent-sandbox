/** Tests for api.image module — Image chain builder. */

import { describe, expect, it } from "vitest";

import { Image } from "../../src/api/image.js";

describe("TestImageFromTemplate", () => {
  // Test Image.from_template() constructor.
  it("test_from_template", () => {
    const img = Image.fromTemplate("python-base");
    expect(img._from_template).toBe("python-base");
    expect(img._base).toBe("python-base");
  });

  it("test_from_template_dockerfile", () => {
    const img = Image.fromTemplate("python-base");
    const dockerfile = img.toDockerfile();
    expect(dockerfile.startsWith("FROM python-base")).toBe(true);
  });
});

describe("TestImageFromImage", () => {
  // Test Image.from_image() constructor.
  it("test_from_image", () => {
    const img = Image.fromImage("python:3.11-slim");
    expect(img._base).toBe("python:3.11-slim");
  });

  it("test_from_image_dockerfile", () => {
    const img = Image.fromImage("ubuntu:22.04");
    const dockerfile = img.toDockerfile();
    expect(dockerfile).toBe("FROM ubuntu:22.04");
  });
});

describe("TestImageChaining", () => {
  // Test chain method calls.
  it("test_pip_install", () => {
    const img = Image.fromImage("python:3.11");
    const result = img.pipInstall("flask", "sqlalchemy");
    expect(result).toBe(img); // returns self for chaining
    expect(img._steps).toContain("RUN pip install --no-cache-dir flask sqlalchemy");
  });

  it("test_pip_install_empty", () => {
    const img = Image.fromImage("python:3.11");
    img.pipInstall();
    expect(img._steps.length).toBe(0);
  });

  it("test_apt_install", () => {
    const img = Image.fromImage("ubuntu:22.04");
    const result = img.aptInstall("curl", "git");
    expect(result).toBe(img);
    expect(img._steps.some((s) => s.includes("apt-get install -y curl git"))).toBe(true);
  });

  it("test_apt_install_empty", () => {
    const img = Image.fromImage("ubuntu:22.04");
    img.aptInstall();
    expect(img._steps.length).toBe(0);
  });

  it("test_copy_local", () => {
    const img = new Image();
    const result = img.copyLocal("./src", "/app/src");
    expect(result).toBe(img);
    expect(img._steps).toContain("COPY ./src /app/src");
  });

  it("test_env", () => {
    const img = new Image();
    const result = img.env({ APP_ENV: "prod", DEBUG: "0" });
    expect(result).toBe(img);
    expect(img._envs).toEqual({ APP_ENV: "prod", DEBUG: "0" });
  });

  it("test_env_chained", () => {
    const img = new Image();
    img.env({ A: "1" }).env({ B: "2" });
    expect(img._envs).toEqual({ A: "1", B: "2" });
  });

  it("test_run_command", () => {
    const img = new Image();
    const result = img.runCommand("echo hello");
    expect(result).toBe(img);
    expect(img._steps).toContain("RUN echo hello");
  });

  it("test_workdir", () => {
    const img = new Image();
    const result = img.workdir("/app");
    expect(result).toBe(img);
    expect(img._workdir).toBe("/app");
  });

  it("test_expose", () => {
    const img = new Image();
    const result = img.expose(3000, 8080);
    expect(result).toBe(img);
    expect(img._exposed_ports).toEqual([3000, 8080]);
  });

  it("test_entrypoint", () => {
    const img = new Image();
    const result = img.entrypoint("python app.py");
    expect(result).toBe(img);
    expect(img._entrypoint).toBe("python app.py");
  });
});

describe("TestImageToDockerfile", () => {
  // Test Image.to_dockerfile().
  it("test_minimal", () => {
    const img = new Image();
    const dockerfile = img.toDockerfile();
    expect(dockerfile).toBe("FROM ubuntu:22.04");
  });

  it("test_full_chain", () => {
    const img = Image.fromImage("python:3.11-slim")
      .aptInstall("curl", "git")
      .pipInstall("flask", "sqlalchemy")
      .copyLocal("./app", "/app")
      .runCommand("echo 'setup done'")
      .env({ FLASK_ENV: "production", PORT: "5000" })
      .workdir("/app")
      .expose(5000)
      .entrypoint("python main.py");
    const dockerfile = img.toDockerfile();
    const lines = dockerfile.split("\n");

    expect(lines[0]).toBe("FROM python:3.11-slim");
    expect(lines.some((line) => line.includes("apt-get install -y curl git"))).toBe(true);
    expect(lines.some((line) => line.includes("pip install --no-cache-dir flask sqlalchemy"))).toBe(true);
    expect(lines.some((line) => line.includes("COPY ./app /app"))).toBe(true);
    expect(lines.some((line) => line.includes("RUN echo 'setup done'"))).toBe(true);
    expect(lines.some((line) => line.includes("ENV FLASK_ENV=production"))).toBe(true);
    expect(lines.some((line) => line.includes("ENV PORT=5000"))).toBe(true);
    expect(lines.some((line) => line.includes("WORKDIR /app"))).toBe(true);
    expect(lines.some((line) => line.includes("EXPOSE 5000"))).toBe(true);
    expect(lines.some((line) => line.includes("CMD python main.py"))).toBe(true);
  });

  it("test_order_of_directives", () => {
    // FROM comes first, ENV after steps, WORKDIR/EXPOSE/CMD at end.
    const img = Image.fromImage("alpine").runCommand("echo 1").env({ A: "1" }).workdir("/w").expose(80).entrypoint("sh");
    const lines = img.toDockerfile().split("\n");
    expect(lines[0]).toBe("FROM alpine");
    // RUN is before ENV
    const run_idx = lines.findIndex((line) => line.includes("RUN"));
    const env_idx = lines.findIndex((line) => line.includes("ENV"));
    const workdir_idx = lines.findIndex((line) => line.includes("WORKDIR"));
    expect(run_idx).toBeLessThan(env_idx);
    expect(env_idx).toBeLessThan(workdir_idx);
  });
});

describe("TestImageRepr", () => {
  // Test Image.__repr__().
  it("test_repr", () => {
    const img = Image.fromImage("python:3.11").pipInstall("flask").env({ X: "1" });
    const r = img.__repr__();
    expect(r).toContain("python:3.11");
    expect(r).toContain("steps=1");
    expect(r).toContain("envs=1");
  });
});

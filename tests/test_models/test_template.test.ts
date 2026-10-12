/** Tests for SandboxTemplate and TemplateRef models. */

import { describe, expect, it } from "vitest";

import { SandboxTemplate, TemplateRef } from "../../src/models/template.js";

describe("TestSandboxTemplate", () => {
  // Tests for SandboxTemplate model.

  it("test_minimal_template", () => {
    const tmpl = new SandboxTemplate({ name: "test" });
    expect(tmpl.name).toBe("test");
    expect(tmpl.version).toBe("1.0.0");
    expect(tmpl.env).toEqual({});
    expect(tmpl.ports).toEqual([]);
    expect(tmpl.capabilities).toBeNull();
    expect(tmpl.custom_commands).toEqual({});
  });

  it("test_full_template", () => {
    const tmpl = new SandboxTemplate({
      name: "data-science",
      version: "2.0.0",
      description: "Data science template",
      env: { LANG: "C.UTF-8" },
      cpu_count: 2,
      memory_mb: 4096,
      author: "test-author",
      license: "MIT",
      tags: ["data", "python"],
      capabilities: ["shell", "files", "code"],
    });
    expect(tmpl.name).toBe("data-science");
    expect(tmpl.version).toBe("2.0.0");
    expect(tmpl.cpu_count).toBe(2);
    expect(tmpl.memory_mb).toBe(4096);
    expect(tmpl.tags).toEqual(["data", "python"]);
    expect(tmpl.capabilities).toEqual(["shell", "files", "code"]);
  });

  it("test_extra_fields_ignored", () => {
    // Legacy build fields (base, system_packages, etc.) are silently ignored.
    const tmpl = new SandboxTemplate({
      name: "test",
      base: "python:3.11",
      system_packages: ["git"],
      python_packages: ["flask"],
    });
    expect(tmpl.name).toBe("test");
    // extra fields are silently dropped by model_config = {"extra": "ignore"}
    expect("base" in tmpl).toBe(false);
    expect("system_packages" in tmpl).toBe(false);
  });
});

describe("TestTemplateRef", () => {
  // Tests for TemplateRef model.

  it("test_default", () => {
    const ref = new TemplateRef();
    expect(ref.owner).toBeNull();
    expect(ref.repo).toBeNull();
    expect(ref.tag).toBeNull();
    expect(ref.path).toBeNull();
    expect(ref.is_builtin).toBe(false);
    expect(ref.registry_url).toBe("https://github.com");
    expect(ref.registry_type).toBe("github");
    expect(ref.local_path).toBeNull();
  });

  it("test_builtin", () => {
    const ref = new TemplateRef({ is_builtin: true, tag: "base" });
    expect(ref.is_builtin).toBe(true);
    expect(ref.tag).toBe("base");
    expect(ref.path).toBeNull();
  });

  it("test_github_ref", () => {
    const ref = new TemplateRef({
      owner: "org",
      repo: "sandbox-templates",
      tag: "v1.0",
      registry_url: "https://github.com",
    });
    expect(ref.owner).toBe("org");
    expect(ref.repo).toBe("sandbox-templates");
    expect(ref.tag).toBe("v1.0");
    expect(ref.path).toBeNull();
    expect(ref.is_builtin).toBe(false);
  });

  it("test_path_field", () => {
    // path 字段应正确存储子目录信息。
    const ref = new TemplateRef({
      owner: "demo",
      repo: "demo",
      tag: "v1.0",
      path: "templates/python-data",
    });
    expect(ref.owner).toBe("demo");
    expect(ref.repo).toBe("demo");
    expect(ref.tag).toBe("v1.0");
    expect(ref.path).toBe("templates/python-data");
    expect(ref.is_builtin).toBe(false);
  });

  it("test_path_field_default_none", () => {
    // path 字段默认为 None。
    const ref = new TemplateRef({ owner: "a", repo: "b" });
    expect(ref.path).toBeNull();
  });

  it("test_path_with_nested_dirs", () => {
    // 深层子目录路径。
    const ref = new TemplateRef({
      owner: "org",
      repo: "templates",
      path: "a/b/c/d",
    });
    expect(ref.path).toBe("a/b/c/d");
  });

  it("test_registry_type_default", () => {
    // registry_type 默认值为 github。
    const ref = new TemplateRef();
    expect(ref.registry_type).toBe("github");
  });

  it("test_registry_type_local", () => {
    // registry_type 可设为 local。
    const ref = new TemplateRef({ registry_type: "local", local_path: "/tmp/my-template" });
    expect(ref.registry_type).toBe("local");
    expect(ref.local_path).toBe("/tmp/my-template");
  });

  it("test_local_path_default_none", () => {
    // local_path 默认为 None。
    const ref = new TemplateRef();
    expect(ref.local_path).toBeNull();
  });

  it("test_local_ref_full", () => {
    // 完整的本地模板引用。
    const ref = new TemplateRef({
      registry_type: "local",
      local_path: "/home/user/templates/python",
      is_builtin: false,
    });
    expect(ref.registry_type).toBe("local");
    expect(ref.local_path).toBe("/home/user/templates/python");
    expect(ref.is_builtin).toBe(false);
    expect(ref.owner).toBeNull();
    expect(ref.repo).toBeNull();
  });
});

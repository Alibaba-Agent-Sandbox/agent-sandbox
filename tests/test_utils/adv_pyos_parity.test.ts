/**
 * Adversarial review fixes (agent-template area), in-process: `shutil.copytree`, `Path.expanduser()`,
 * `load_template_from_yaml` failure texts, strict UTF-8 error text, bytes handling and `.dockerignore` BOM.
 * The Python texts were recorded from the oracle (CPython 3.11, PyYAML 6.0.3, pydantic 2.14).
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { DockerIgnore } from "../../src/utils/dockerignore.js";
import { pyRepr } from "../../src/utils/_pyformat.js";
import {
  OSError,
  ShutilError,
  pyCopytree,
  pyExpandUser,
  readTextPy,
} from "../../src/utils/_pyos.js";
import { loadTemplateFromYaml } from "../../src/utils/registry.js";

const scratch = mkdtempSync(path.join(tmpdir(), "adv-pyos-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const fresh = (): string => {
  counter += 1;
  const dir = path.join(scratch, `t${counter}`);
  mkdirSync(dir);
  return dir;
};

describe("pyCopytree (shutil.copytree(dirs_exist_ok=True))", () => {
  it("copies nested trees, follows symlinks and keeps file modes", () => {
    const root = fresh();
    mkdirSync(path.join(root, "src/sub"), { recursive: true });
    writeFileSync(path.join(root, "src/a.txt"), "a");
    writeFileSync(path.join(root, "src/sub/b.sh"), "b");
    chmodSync(path.join(root, "src/sub/b.sh"), 0o755);
    symlinkSync("a.txt", path.join(root, "src/link.txt"));
    symlinkSync("sub", path.join(root, "src/linkdir"));
    pyCopytree(path.join(root, "src"), path.join(root, "dst"));
    expect(readFileSync(path.join(root, "dst/link.txt"), "utf8")).toBe("a");
    expect(readFileSync(path.join(root, "dst/linkdir/b.sh"), "utf8")).toBe("b");
    expect(statSync(path.join(root, "dst/sub/b.sh")).mode & 0o777).toBe(0o755);
    expect(statSync(path.join(root, "dst/link.txt")).isSymbolicLink()).toBe(
      false,
    );
  });

  it("snapshots the source entries before creating a destination inside the source", () => {
    const root = fresh();
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/a.txt"), "a");
    pyCopytree(path.join(root, "src"), path.join(root, "src/dest"));
    expect(existsSync(path.join(root, "src/dest/a.txt"))).toBe(true);
    expect(existsSync(path.join(root, "src/dest/dest"))).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)(
    "collects per-file failures and keeps copying, raising shutil.Error with the tuple repr",
    () => {
      const root = fresh();
      mkdirSync(path.join(root, "src"));
      writeFileSync(path.join(root, "src/ok.txt"), "ok");
      writeFileSync(path.join(root, "src/secret.txt"), "x");
      chmodSync(path.join(root, "src/secret.txt"), 0o000);
      const src = path.join(root, "src");
      const dst = path.join(root, "dst");
      let caught: unknown;
      try {
        pyCopytree(src, dst);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ShutilError);
      expect((caught as Error).message).toBe(
        `[('${src}/secret.txt', '${dst}/secret.txt', "[Errno 13] Permission denied: '${src}/secret.txt'")]`,
      );
      expect(readFileSync(path.join(dst, "ok.txt"), "utf8")).toBe("ok");
    },
  );

  it("copying a directory onto itself reports every file as the same file (message extended character by character)", () => {
    const root = fresh();
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/a.txt"), "a");
    const src = path.join(root, "src");
    let message = "";
    try {
      pyCopytree(src, src);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(
      message.startsWith(
        "['<', 'D', 'i', 'r', 'E', 'n', 't', 'r', 'y', ' ', \"'\", 'a', '.', 't', 'x', 't', \"'\", '>'",
      ),
    ).toBe(true);
  });

  it("a missing source is a plain FileNotFoundError", () => {
    const root = fresh();
    expect(() =>
      pyCopytree(path.join(root, "nope"), path.join(root, "dst")),
    ).toThrow(OSError);
  });
});

describe("pyExpandUser (Path.expanduser)", () => {
  const savedHome = process.env["HOME"];
  afterAll(() => {
    process.env["HOME"] = savedHome;
  });

  it("expands ~ and ~/x through $HOME and keeps '..'", () => {
    process.env["HOME"] = "/home/someone/";
    expect(pyExpandUser("~")).toBe("/home/someone");
    expect(pyExpandUser("~/a//b/../c")).toBe("/home/someone/a/b/../c");
    expect(pyExpandUser("plain/x")).toBe("plain/x");
    expect(pyExpandUser("/abs/~x")).toBe("/abs/~x");
  });

  it("expands ~user through the passwd database and fails like RuntimeError for an unknown user", () => {
    expect(pyExpandUser("~root/x")).toMatch(/\/x$/);
    expect(() => pyExpandUser("~nobodyxyz/proj")).toThrow(
      "Could not determine home directory.",
    );
  });
});

describe("loadTemplateFromYaml rejects a document that is not a mapping", () => {
  const cases = ["- a\n", "!!set {a}\n", "2001-01-01\n", "1.5\n", "abc\n", "true\n", "\n"];
  it.each(cases)("%j", (yaml) => {
    const file = path.join(fresh(), "template.yaml");
    writeFileSync(file, yaml);
    expect(() => loadTemplateFromYaml(file)).toThrow("must be a YAML mapping");
  });

  it("YAML errors carry the line and column", () => {
    const file = path.join(fresh(), "template.yaml");
    writeFileSync(file, "name: [x\nports: 1\n");
    expect(() => loadTemplateFromYaml(file)).toThrow(/line 2, column 1/);
  });

  it("a !!binary scalar is not a string", () => {
    const file = path.join(fresh(), "template.yaml");
    writeFileSync(file, "name: !!binary aGVsbG8=\n");
    expect(() => loadTemplateFromYaml(file)).toThrow(/name/);
  });
});

describe("text decoding parity", () => {
  it("readTextPy reports the first undecodable byte like CPython", () => {
    const file = path.join(fresh(), "x.yaml");
    writeFileSync(file, Buffer.from("name: \xff\n", "latin1"));
    expect(() => readTextPy(file)).toThrow(
      "'utf-8' codec can't decode byte 0xff in position 6: invalid start byte",
    );
    writeFileSync(file, Buffer.from([0xff, 0xfe, 0x41]));
    expect(() => readTextPy(file)).toThrow(
      "'utf-8' codec can't decode byte 0xff in position 0: invalid start byte",
    );
  });

  it("repr(bytes)", () => {
    expect(pyRepr(new Uint8Array(Buffer.from("it's\n\x00ok")))).toBe(
      `b"it's\\n\\x00ok"`,
    );
    expect(pyRepr(new Uint8Array(Buffer.from("a\"b'c")))).toBe(`b'a"b\\'c'`);
  });

  it("DockerIgnore.fromFile keeps a UTF-8 BOM (the first pattern then does not match, as in Python)", () => {
    const file = path.join(fresh(), ".dockerignore");
    writeFileSync(
      file,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("**/.env\nnode_modules\n"),
      ]),
    );
    const ignore = DockerIgnore.fromFile(file);
    expect(ignore.excludes(".env")).toBe(false);
    expect(ignore.excludes("node_modules")).toBe(true);
  });
});

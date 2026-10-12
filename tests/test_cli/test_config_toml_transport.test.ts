import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as transport from "../../src/transport/config.js";
import { loads } from "../../src/utils/_tomllib.js";

describe("TransportTomlLoader", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ebx-toml-"));
    file = path.join(dir, "config.toml");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns an empty dict for a missing file", () => {
    expect(transport._loadTomlFile(file)).toEqual({});
  });

  it("parses tables into plain objects and keeps floats distinguishable", () => {
    fs.writeFileSync(file, "[transport]\nhttp_timeout = 5.0\nmax_retries = 3\n");
    const data = transport._loadTomlFile(file);
    expect(Object.keys(data["transport"])).toEqual(["http_timeout", "max_retries"]);
    expect(String(data["transport"]["http_timeout"])).toBe("5.0");
    expect(data["transport"]["max_retries"]).toBe(3);
  });

  it("returns {} on a syntax error (tomllib message text)", () => {
    fs.writeFileSync(file, "[transport]\nregion = 1 2\n");
    expect(transport._loadTomlFile(file)).toEqual({});
  });

  it("returns {} on invalid UTF-8", () => {
    fs.writeFileSync(file, Buffer.from([0xc3, 0x28]));
    expect(transport._loadTomlFile(file)).toEqual({});
  });
});

describe("TomlTemporalRepr", () => {
  it.each([
    ["d = 2024-01-02", "datetime.date(2024, 1, 2)", "date"],
    ["d = 2024-01-02T03:04:05", "datetime.datetime(2024, 1, 2, 3, 4, 5)", "datetime"],
    ["d = 2024-01-02 03:04:00Z", "datetime.datetime(2024, 1, 2, 3, 4, tzinfo=datetime.timezone.utc)", "datetime"],
    ["d = 2024-01-02T03:04:05.5+01:00", "datetime.datetime(2024, 1, 2, 3, 4, 5, 500000, tzinfo=datetime.timezone(datetime.timedelta(seconds=3600)))", "datetime"],
    ["d = 2024-01-02T03:04:05-01:30", "datetime.datetime(2024, 1, 2, 3, 4, 5, tzinfo=datetime.timezone(datetime.timedelta(days=-1, seconds=81000)))", "datetime"],
    ["d = 07:00:00", "datetime.time(7, 0)", "time"],
    ["d = 07:30:15.000001", "datetime.time(7, 30, 15, 1)", "time"],
  ])("%s", (src, repr, kind) => {
    const v = loads(src).get("d") as { __repr__(): string; __pytype__: string };
    expect(v.__repr__()).toBe(repr);
    expect(v.__pytype__).toBe(kind);
  });
});

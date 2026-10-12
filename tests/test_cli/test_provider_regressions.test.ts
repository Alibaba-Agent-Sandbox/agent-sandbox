/**
 * Provider-wiring regressions: a non-string sandbox id matches Python's `in` TypeError (unexpected error, exit 1),
 * and `--verbose` logs `Loaded config` once (the legacy loader), not again from provider resolution.
 */

import "../_support/isolatedHome.js";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _selectProvider } from "../../src/api/sandbox.js";
import { handleErrors, main } from "../../src/cli/main.js";
import { SystemExit } from "../../src/framework/utils.js";
import {
  _CONFIG_FILE,
  _ENV_FILE_CANDIDATES,
  _setConfigFile,
  _setEnvFileCandidates,
  resetConfig,
} from "../../src/transport/config.js";
import { useIso } from "../_support/iso.js";
import { useCapsys } from "./conftest.js";

const iso = useIso();
const cap = useCapsys();

let savedConfig = "";
let savedEnv: string[] = [];

beforeEach(() => {
  savedConfig = _CONFIG_FILE;
  savedEnv = [..._ENV_FILE_CANDIDATES];
});

afterEach(() => {
  _setConfigFile(savedConfig);
  _setEnvFileCandidates(savedEnv);
  resetConfig();
});

describe("sandbox id that is not a string", () => {
  it("test_int_is_an_unexpected_error_exit_1", async () => {
    const wrapped = handleErrors(async () => {
      _selectProvider(null, 1);
    });
    let caught: unknown;
    try {
      await wrapped();
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(SystemExit);
    expect((caught as SystemExit).code).toBe(1);
    const { err } = cap.readouterr();
    expect(err).toContain("Unexpected error: argument of type 'int' is not iterable");
  });

  it("test_list_is_membership_and_null_is_skipped", () => {
    expect(_selectProvider(null, null)).toEqual([null, null]);
    const [prov, bare] = _selectProvider(null, ["http://x"]);
    expect(prov).toBeNull();
    expect(bare).toEqual(["http://x"]);
  });
});

describe("verbose config load", () => {
  it("test_verbose_logs_loaded_config_once", async () => {
    iso.writeToml('[transport]\nregion = "cn-hangzhou"\n');
    _setConfigFile(iso.toml);
    _setEnvFileCandidates([iso.env]);
    resetConfig();
    await main({ args: ["-v", "list"] });
    const { err } = cap.readouterr();
    const loads = err.split("\n").filter((line) => line.includes("Loaded config"));
    expect(loads).toEqual([`DEBUG: Loaded config from ${iso.toml}`]);
  });
});

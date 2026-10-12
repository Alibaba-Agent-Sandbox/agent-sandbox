/**
 * KI-007: `files.list` of a missing directory raises instead of returning `[]`.
 *
 * Real envd answers `ListDir` of a missing path with HTTP 200 `{"entries": []}` (observed), but `Stat` of the same path
 * with HTTP 404 -- so an empty answer is disambiguated with `Stat`.
 */

import { describe, expect, it } from "vitest";

import { FilesModule } from "../../src/api/files.js";
import { FileNotFoundError_ } from "../../src/models/errors.js";
import { FilesystemProtocol } from "../../src/protocol/filesystem.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";
import { useHttpxMock } from "../helpers/httpxMock.js";
import { ENVD, makeHttp, raises, token } from "./_helpers.js";

const iso = useIsolatedEnv();
useTransportIsolation(iso);
const httpx_mock = useHttpxMock();

const LIST_URL = `${ENVD}/filesystem.Filesystem/ListDir`;
const STAT_URL = `${ENVD}/filesystem.Filesystem/Stat`;
const files = () => new FilesModule(ENVD, token(), new FilesystemProtocol(makeHttp()));

describe("KI-007 list of a missing directory", () => {
  it("test_empty_answer_for_a_missing_directory_raises_not_found", async () => {
    httpx_mock.add_response({ url: LIST_URL, method: "POST", json: { entries: [] } });
    httpx_mock.add_response({ url: STAT_URL, method: "POST", status_code: 404, content: "" });
    const err = await raises(() => files().list("/tmp/pr/nope"), FileNotFoundError_);
    expect(String(err.message)).toContain("/tmp/pr/nope");
  });

  it("test_missing_key_answer_is_also_disambiguated", async () => {
    httpx_mock.add_response({ url: LIST_URL, method: "POST", json: {} });
    httpx_mock.add_response({ url: STAT_URL, method: "POST", status_code: 404, content: "" });
    await raises(() => files().list("/nope"), FileNotFoundError_);
  });

  it("test_existing_empty_directory_still_lists_as_empty", async () => {
    httpx_mock.add_response({ url: LIST_URL, method: "POST", json: { entries: [] } });
    httpx_mock.add_response({
      url: STAT_URL,
      method: "POST",
      json: { entry: { name: "empty", path: "/tmp/empty", type: 2, size: 4096 } },
    });
    expect(await files().list("/tmp/empty")).toEqual([]);
  });

  it("test_non_empty_listing_costs_no_extra_stat", async () => {
    httpx_mock.add_response({
      url: LIST_URL,
      method: "POST",
      json: { entries: [{ name: "a", path: "/d/a", type: 1, size: 1 }] },
    });
    const entries = await files().list("/d");
    expect(entries.map((e) => e.name)).toEqual(["a"]);
    expect(httpx_mock.get_requests().length).toBe(1);
  });

  it("test_listdir_404_also_maps_to_not_found", async () => {
    httpx_mock.add_response({ url: LIST_URL, method: "POST", status_code: 404, content: "not found\n" });
    await raises(() => files().list("/gone"), FileNotFoundError_);
  });
});

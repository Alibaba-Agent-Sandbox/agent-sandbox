/**
 * KI-008 (gateway throughput, not an SDK bug): the SDK must *report* it clearly.
 *
 * A large envd upload/download that exceeds the HTTP timeout used to leak a bare `WriteTimeout` / `ReadTimeout`. The
 * timeout itself is unchanged; the error now names the operation, the size and the knob to turn.
 */

import { describe, expect, it } from "vitest";

import { FilesModule } from "../../src/api/files.js";
import { FileOperationError } from "../../src/models/errors.js";
import { FilesystemProtocol } from "../../src/protocol/filesystem.js";
import { ReadTimeout, WriteTimeout } from "../../src/transport/_httpx.js";
import { HTTPError } from "../../src/transport/http.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";
import { useHttpxMock } from "../helpers/httpxMock.js";
import { ENVD, makeHttp, raises, token } from "./_helpers.js";

const iso = useIsolatedEnv();
useTransportIsolation(iso);
const httpx_mock = useHttpxMock();

const files = () => new FilesModule(ENVD, token(), new FilesystemProtocol(makeHttp()));

describe("KI-008 transfer timeout report", () => {
  it("test_upload_timeout_is_a_clear_file_operation_error", async () => {
    httpx_mock.add_exception(new WriteTimeout("timed out"), { method: "POST" });
    const err = await raises(() => files().write("/tmp/big.bin", new Uint8Array(1_000_000)), FileOperationError);
    expect(err.message).toBe("Upload to /tmp/big.bin (1000000 bytes) timed out; the transfer took longer than the HTTP timeout.");
    expect(err.suggestion).toContain("EBX_HTTP_TIMEOUT");
    expect(err).not.toBeInstanceOf(HTTPError);
  });

  it("test_download_timeout_is_a_clear_file_operation_error", async () => {
    httpx_mock.add_exception(new ReadTimeout("timed out"), { method: "GET" });
    const err = await raises(() => files().readBytes("/tmp/big.bin"), FileOperationError);
    expect(err.message).toBe("Download of /tmp/big.bin timed out; the transfer took longer than the HTTP timeout.");
    expect(err.suggestion).toBe("Raise the HTTP timeout (EBX_HTTP_TIMEOUT / http_timeout) or transfer smaller chunks.");
  });
});

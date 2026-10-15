/**
 * Where a template image installs `agent-sandbox-server` when no local wheel is injected.
 *
 * The distribution is not on PyPI. The PyPI project `agent-sandbox` is unrelated (`agent-infra/sandbox-sdk`).
 * `python-sdk` has no GitHub release, so the Dockerfile installs the `server-sdk` directory of a pinned commit
 * archive. That URL works with plain `pip install` (no git client, no BuildKit, no local wheel).
 * `ABX_SERVER_SDK_SOURCE` still builds a wheel and replaces this line at `docker build` time.
 * Any `python-sdk/archive/<40-hex>.tar.gz#subdirectory=server-sdk` pin is that same install:
 * deploy uses it as written and does not query PyPI, and a local wheel replaces it whatever SHA it names.
 *
 * Pin is python-sdk `61c43e0be65a1f57aa09186d578e7b399e48429b` (PR #21). The server-sdk tree there
 * matches `b6e71fa` (PR #20); later commits through `11bbafa6` (PR #24) do not change server runtime.
 */

/** A Dockerfile pin of `server-sdk` from a python-sdk commit archive, any 40-hex SHA. */
export const SERVER_SDK_ARCHIVE_PIN =
  /https:\/\/github\.com\/alibaba-agent-sandbox\/python-sdk\/archive\/[0-9a-f]{40}\.tar\.gz#subdirectory=server-sdk/i;

export function dockerfilePinsServerArchive(text: string): boolean {
  return SERVER_SDK_ARCHIVE_PIN.test(text);
}

export const SERVER_SDK_GIT_SHA = "61c43e0be65a1f57aa09186d578e7b399e48429b";

export const SERVER_SDK_ARCHIVE_URL =
  `https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/${SERVER_SDK_GIT_SHA}.tar.gz`;

/** pip requirement: name plus the archive subdirectory. */
export const SERVER_SDK_PIP_SPEC =
  `agent-sandbox-server @ ${SERVER_SDK_ARCHIVE_URL}#subdirectory=server-sdk`;

/** The Dockerfile line `abx template init` writes. Templates copy this line. */
export const ABX_SERVER_INSTALL = `RUN pip install --no-cache-dir "${SERVER_SDK_PIP_SPEC}"`;

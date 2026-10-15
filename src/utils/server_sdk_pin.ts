/**
 * Where a template image installs `agent-sandbox-server` when no local wheel is injected.
 *
 * The distribution is not on PyPI. The PyPI project `agent-sandbox` is unrelated (`agent-infra/sandbox-sdk`).
 * `python-sdk` has no GitHub release, so the Dockerfile installs the `server-sdk` directory of a pinned commit
 * archive. That URL works with plain `pip install` (no git client, no BuildKit, no local wheel).
 * `ABX_SERVER_SDK_SOURCE` still builds a wheel and replaces this line at `docker build` time.
 *
 * Pin is python-sdk `b6e71fa4b6127e94a0da0aa96642ee96f69ad87a` (PR #20, Express auth and envd framing).
 */

export const SERVER_SDK_GIT_SHA = "b6e71fa4b6127e94a0da0aa96642ee96f69ad87a";

export const SERVER_SDK_ARCHIVE_URL =
  `https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/${SERVER_SDK_GIT_SHA}.tar.gz`;

/** pip requirement: name plus the archive subdirectory. */
export const SERVER_SDK_PIP_SPEC =
  `agent-sandbox-server @ ${SERVER_SDK_ARCHIVE_URL}#subdirectory=server-sdk`;

/** The Dockerfile line `abx template init` writes. Templates copy this line. */
export const ABX_SERVER_INSTALL = `RUN pip install --no-cache-dir "${SERVER_SDK_PIP_SPEC}"`;

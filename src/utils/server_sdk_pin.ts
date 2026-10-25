/** Exact server installation requirements used by template tooling.
 * The published release is explicitly alpha; legacy source pins remain supported.
 * Local wheel injection recognizes both supported install forms.
 */

/** Published, opt-in alpha used by newly generated application templates. */
export const SERVER_SDK_RELEASE_SPEC = "agent-sandbox-server==0.4.0a1";

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

/** The Dockerfile line `abx template scaffold` writes. Templates copy this line. */
export const ABX_SERVER_INSTALL = `RUN pip install --no-cache-dir "${SERVER_SDK_PIP_SPEC}"`;

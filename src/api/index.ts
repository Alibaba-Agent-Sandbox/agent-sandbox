/** L4 High-level API — user-facing classes (port of `api/__init__.py`; `api/deploy.py` is SDK-only and not ported). */

export { ResolvedCapabilities, resolveCapabilities } from "./capability.js";
export { CodeContextModule } from "./code.js";
export { CommandsModule } from "./commands.js";
export { ACRConfig, BuildResult, DockerBuilder } from "./docker_builder.js";
export { createOfficialTemplate, getTemplate as getOfficialTemplate } from "./fc_template.js";
export { FilesModule } from "./files.js";
export { NetworkModule } from "./network.js";
export { Sandbox } from "./sandbox.js";

export const __all__ = [
  "Sandbox",
  "CommandsModule",
  "FilesModule",
  "CodeContextModule",
  "NetworkModule",
  "ResolvedCapabilities",
  "resolveCapabilities",
  "DockerBuilder",
  "ACRConfig",
  "BuildResult",
  "createOfficialTemplate",
  "getOfficialTemplate",
];

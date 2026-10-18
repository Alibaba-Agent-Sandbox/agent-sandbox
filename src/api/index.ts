/** L4 High-level API — user-facing classes (port of `api/__init__.py`; `api/deploy.py` is SDK-only and not ported). */

export { ResolvedCapabilities, resolveCapabilities } from "./capability.js";
export { CodeContextModule } from "./code.js";
export { CommandsModule } from "./commands.js";
export { ACRConfig, BuildResult, DockerBuilder } from "./docker_builder.js";
export { createOfficialTemplate, getTemplate as getOfficialTemplate } from "./fc_template.js";
export { FilesModule } from "./files.js";
export { Image } from "./image.js";
export { NetworkModule } from "./network.js";
export { Sandbox } from "./sandbox.js";
export { TemplateManager } from "./template.js";

export { deployProviderImage, type ProviderImageOptions } from "./provider_template.js";

export const __all__ = [
  "deployProviderImage",
  "Sandbox",
  "CommandsModule",
  "FilesModule",
  "CodeContextModule",
  "NetworkModule",
  "TemplateManager",
  "Image",
  "ResolvedCapabilities",
  "resolveCapabilities",
  "DockerBuilder",
  "ACRConfig",
  "BuildResult",
  "createOfficialTemplate",
  "getOfficialTemplate",
];

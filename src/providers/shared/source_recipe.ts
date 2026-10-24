/** Materialize the existing official Docker recipe, without changing application instructions. */
import { ProviderConfigError } from "../../models/provider_errors.js";
import { materializeBaseImage } from "../../utils/base_image.js";

const NATIVE_FROM = /^FROM[ \t]+(fc-e2b-registry\.(?:<region>|[a-z0-9-]+)\.cr\.aliyuncs\.com\/runtime\/base:(?:<tag>|[A-Za-z0-9_][A-Za-z0-9._-]*))(?:[ \t]+AS[ \t]+[a-zA-Z0-9_-]+)?[ \t]*\r?$/im;
const WHEEL_COPY = /^COPY[ \t]+\*\.whl[ \t]+\/tmp\/[ \t]*\r?$/gm;
const ARCHIVE = /https:\/\/github\.com\/alibaba-agent-sandbox\/python-sdk\/archive\/([^\s"']+)/gi;

/** Keep instruction offsets while masking comments, continuation bodies and heredocs. */
function instructionMask(source: string): string {
  const lines = source.split("\n"), masked = [...lines];
  const escape = /^#\s*escape\s*=\s*([\\`])/im.exec(source)?.[1] ?? "\\";
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i]!;
    if (!first.trim() || first.trimStart().startsWith("#")) { masked[i] = " ".repeat(first.length); continue; }
    let instruction = first, continued = first.trimEnd().endsWith(escape);
    while (continued && i + 1 < lines.length) {
      const next = lines[++i]!;
      masked[i] = " ".repeat(next.length);
      if (!next.trim() || next.trimStart().startsWith("#")) continue;
      instruction += "\n" + next;
      continued = next.trimEnd().endsWith(escape);
    }
    if (!/^\s*(?:RUN|COPY|ADD)\s/i.test(first)) continue;
    for (const match of instruction.matchAll(/(?:^|\s)<<(-?)[ \t]*["']?([A-Za-z_][A-Za-z0-9_]*)["']?(?=\s|$)/g)) {
      while (i + 1 < lines.length) {
        const body = lines[++i]!;
        masked[i] = " ".repeat(body.length);
        if ((match[1] ? body.replace(/^\t+/, "") : body).replace(/\r$/, "") === match[2]) break;
      }
    }
  }
  return masked.join("\n");
}

/** Only the documented official base and exact server-wheel recipe are expanded. */
export function materializeSourceRecipe(source: string, options: { serverCommit?: string; hasWheels?: boolean } = {}): string {
  const from = NATIVE_FROM.exec(instructionMask(source));
  if (!from) return source;
  const base = materializeBaseImage(from[1]!, "cn-hangzhou");
  let result = source.slice(0, from.index) + from[0].replace(from[1]!, base) + source.slice(from.index + from[0].length);
  const archives = [...result.matchAll(ARCHIVE)].map(match => match[1]!);
  if (archives.length === 0 && !options.serverCommit) return result;
  if (archives.length === 0 || archives.some(pin => !/^[a-f0-9]{40}\.tar\.gz#subdirectory=server-sdk$/.test(pin)) || new Set(archives).size !== 1) {
    throw new ProviderConfigError("The server wheel recipe requires one exact python-sdk commit archive in the selected Dockerfile.");
  }
  const commit = archives[0]!.slice(0, 40);
  if (options.serverCommit !== undefined && options.serverCommit !== `${commit}\n`) {
    throw new ProviderConfigError("server-sdk.commit must contain the same 40-character commit as the selected Dockerfile, followed by a newline.");
  }
  const instructions = instructionMask(result);
  const copies = [...instructions.matchAll(WHEEL_COPY)];
  if (options.hasWheels || copies.length === 0) return result;
  if ((instructions.match(/^FROM\s+/gim) ?? []).length !== 1) {
    throw new ProviderConfigError("Automatic server wheel preparation requires a single-stage official Dockerfile. Supply its wheel in the build context for a custom multi-stage recipe.");
  }
  // Use an alias that cannot shadow an application stage. Docker creates the wheel;
  // the host does not need Python, pip, or a separate SDK checkout.
  let stage = "abx-server-wheel";
  while (new RegExp(`\\bAS\\s+${stage}\\b`, "i").test(instructions)) stage += "-build";
  const builder = `FROM ${base} AS ${stage}\nUSER root\nRUN python3 -m pip wheel --no-deps --wheel-dir /abx-wheels "https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/${commit}.tar.gz#subdirectory=server-sdk"\n\n`;
  for (const copy of copies.reverse()) result = result.slice(0, copy.index) + `COPY --from=${stage} /abx-wheels/*.whl /tmp/` + result.slice(copy.index! + copy[0].length);
  // Keep Docker parser directives and leading comments before the first FROM.
  return result.slice(0, from.index) + builder + result.slice(from.index);
}

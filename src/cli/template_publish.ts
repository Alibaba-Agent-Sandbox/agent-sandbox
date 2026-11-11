/** Publish an existing clean Git commit through an immutable remote reference. */
import fs from "node:fs";
import path from "node:path";
import type { Context, Params } from "./kit.js";
import { getFormatter } from "./formatters.js";
import { UsageError } from "./errors.js";
import { canGuideConfiguration } from "./config_guidance.js";
import { confirm } from "./prompts.js";
import { runTool } from "../providers/shared/project.js";

export const publishSeams = { git: (args: readonly string[], cwd: string): Promise<string> => runTool("git", args, { cwd, timeout: 120 }) };

/** Push only a new tag; never commit, replace a tag or update a remote branch. */
export async function publishTemplate(ctx: Context, params: Params): Promise<void> {
  const directory = fs.realpathSync(String(params.source ?? ".")), tag = String(params.tag), remote = String(params.remote ?? "origin");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new UsageError("--remote must name an existing Git remote.");
  if (!fs.existsSync(path.join(directory, "template.yaml"))) throw new UsageError("Template source has no template.yaml.");
  const git = (args: string[]) => publishSeams.git(args, directory);
  await git(["check-ref-format", `refs/tags/${tag}`]);
  const root = (await git(["rev-parse", "--show-toplevel"])).trim();
  if ((await git(["status", "--porcelain", "--untracked-files=normal"])).trim()) throw new UsageError("Commit template changes before publishing; the Git worktree must be clean.");
  const commit = (await git(["rev-parse", "HEAD"])).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new UsageError("Could not identify the source commit.");
  const relative = path.relative(root, directory).split(path.sep).join("/");
  await git(["cat-file", "-e", `${commit}:${relative ? `${relative}/` : ""}template.yaml`]);
  const remoteUrl = (await git(["config", "--get", `remote.${remote}.url`])).trim();
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl);
  if (!match) throw new UsageError("Publishing requires an existing GitHub HTTPS or SSH remote without inline credentials, so the source can be fetched by template init.");
  const refs = (await git(["ls-remote", "--tags", remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`])).trim().split("\n").filter(Boolean);
  const peeled = refs.find(line => line.endsWith("^{}")) ?? refs[0];
  if (peeled && peeled.split(/\s+/)[0] !== commit) throw new UsageError("The remote tag already points to another commit; choose a new version.");
  if (!peeled) {
    if (!params.yes) {
      if (!canGuideConfiguration(ctx, false)) throw new UsageError("Pass --yes to publish this commit to the configured Git remote.");
      await confirm(`Publish commit ${commit.slice(0, 12)} as ${tag} to remote ${remote}?`, { abort: true, err: true });
    }
    await git(["push", remote, `${commit}:refs/tags/${tag}`]);
  }
  const verified = await git(["ls-remote", "--tags", remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (!verified.split("\n").some(line => line.split(/\s+/)[0] === commit)) throw new UsageError("Remote tag could not be verified; inspect it before retrying.");
  getFormatter(ctx).printDict({ status: "published", tag, commit,
    source: `${match[1]}/${match[2]}${relative ? `//${relative}` : ""}@${commit}` });
}

/** Git timeout/fallback behavior without a two-minute test delay. */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as childProcess from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGit, type InstallPhase } from "../../src/providers/installer.js";
import { useIso } from "../_support/iso.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
useIso();
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

function gitProcess(args: string[], fetchError: string | null, wait: boolean): ReturnType<typeof childProcess.spawn> {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn(() => true),
  });
  queueMicrotask(() => {
    if (args.includes("fetch") && wait) return;
    if (args.includes("fetch") && fetchError) proc.stderr.write(fetchError);
    if (args.includes("rev-parse")) proc.stdout.write("a".repeat(40));
    proc.emit("close", args.includes("fetch") && fetchError ? 128 : 0);
  });
  return proc as unknown as ReturnType<typeof childProcess.spawn>;
}

function fakeGit(error: string | null, wait = false): string[][] {
  const calls: string[][] = [];
  vi.mocked(childProcess.spawn).mockImplementation((_cmd, args) => {
    const argv = [...(args ?? [])] as string[];
    calls.push(argv);
    return gitProcess(argv, argv.includes("--depth") ? error : null, wait);
  });
  return calls;
}

describe("bounded Git wait", () => {
  it("announces the fetch before waiting and does not retry a timeout", async () => {
    vi.useFakeTimers();
    const calls = fakeGit(null, true);
    const phases: InstallPhase[] = [];
    const outcome = fetchGit("https://example.test/provider.git", { onProgress: (phase) => phases.push(phase) }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    expect(phases).toEqual(["fetch"]);
    expect(calls.filter((args) => args.includes("fetch"))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await outcome).toMatchObject({
      message: expect.stringContaining("git fetch timed out after 120s"),
      suggestion: expect.stringContaining("install its local plugin directory"),
    });
    expect(calls.filter((args) => args.includes("fetch"))).toHaveLength(1);
  });

  it("does not retry authentication/network failures or publish raw output as progress", async () => {
    const calls = fakeGit("fatal: repository not found");
    const phases: InstallPhase[] = [];
    await expect(fetchGit("https://example.test/provider.git", { onProgress: (phase) => phases.push(phase) })).rejects.toThrow("repository not found");
    expect(calls.filter((args) => args.includes("fetch"))).toHaveLength(1);
    expect(phases).toEqual(["fetch"]);
  });

  it("announces a shallow-transport fallback and then validates the fetched tree", async () => {
    const calls = fakeGit("fatal: dumb http transport does not support shallow capabilities");
    const phases: InstallPhase[] = [];
    await expect(fetchGit("https://example.test/provider.git", { onProgress: (phase) => phases.push(phase) })).resolves.toEqual({ commit: "a".repeat(40), entries: [] });
    expect(calls.filter((args) => args.includes("fetch"))).toHaveLength(2);
    expect(phases).toEqual(["fetch", "fetch-full", "validate"]);
  });
});

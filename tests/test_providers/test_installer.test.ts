/** Install / update / uninstall of provider plugins: trust, integrity and rollback (port of `test_installer.py`). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ProviderConflictError,
  ProviderInstallError,
  ProviderIntegrityError,
  ProviderManifestError,
  ProviderNotFoundError,
  ProviderTrustError,
  ProviderVersionError,
} from "../../src/providers/errors.js";
import * as installer from "../../src/providers/installer.js";
import * as registry from "../../src/providers/registry.js";
import * as settings from "../../src/providers/settings.js";
import * as store from "../../src/providers/store.js";
import { TEST_HOST_VERSION, git, gitCommitAll, initRepo, writePlugin } from "../_support/plugins.js";
import { useIso } from "../_support/iso.js";

const iso = useIso();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-inst-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const T = (...p: string[]): string => path.join(tmp, ...p);
const HV = { hostVersion: TEST_HOST_VERSION };

function inst(src: string, opts: installer.InstallOptions = {}): Promise<installer.Receipt> {
  return installer.install(src, { yes: true, ...HV, ...opts });
}

const GIT_KW = { yes: true, allowInsecureTransport: true, allowUnpinned: true } as const;
const installGit = (url: string, opts: installer.InstallOptions = {}): Promise<installer.Receipt> => installer.install(url, { ...HV, ...opts });
const updateGit = (id: string, opts: installer.UpdateOptions = {}): Promise<installer.UpdateResult> => installer.update(id, { ...HV, ...opts });

function seedData(id = "demo-prov"): void {
  const data = store.dataDir(id);
  const files: Record<string, Buffer> = {
    "state.json": Buffer.from('{"sandboxes": 2}'),
    "nested/deep/cache.bin": Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    "empty-dir/.keep": Buffer.alloc(0),
  };
  for (const [rel, blob] of Object.entries(files)) {
    const target = path.join(data, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, blob);
  }
  fs.chmodSync(path.join(data, "state.json"), 0o600);
}

function snapshotData(id = "demo-prov"): Record<string, [string, number]> {
  const data = store.dataDir(id);
  const out: Record<string, [string, number]> = {};
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else out[path.relative(data, full).split(path.sep).join("/")] = [fs.readFileSync(full).toString("base64"), fs.statSync(full).mode & 0o777];
    }
  };
  walk(data);
  return out;
}

const boom = (msg: string) => (): never => {
  throw new ProviderInstallError(msg);
};

async function rejectsWith<T extends Error>(p: Promise<unknown>, cls: new (...a: never[]) => T): Promise<T> {
  try {
    await p;
  } catch (exc) {
    expect(exc).toBeInstanceOf(cls);
    return exc as T;
  }
  throw new Error(`expected ${cls.name}`);
}

describe("TestLocalInstall", () => {
  it("test_installs_and_records_receipt", async () => {
    const src = writePlugin(T("src"));
    const receipt = await inst(src);
    expect(receipt["id"]).toBe("demo-prov");
    expect(receipt["trust"]).toBe("local");
    expect((receipt["source"] as Record<string, unknown>)["type"]).toBe("local");
    const onDisk = store.readReceipt("demo-prov") as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(onDisk["tree_sha256"]).toBe(store.digestDir(store.providerDir("demo-prov")));
    expect(onDisk["consented"]["runtime"]).toEqual(["python3", "./provider.py"]);
    expect(store.listInstalledIds()).toEqual(["demo-prov"]);
    expect(registry.getProvider("demo-prov").id).toBe("demo-prov");
  });

  it.skipIf(process.platform === "win32")("test_store_permissions", async () => {
    const src = writePlugin(T("src"));
    fs.writeFileSync(path.join(src, "run.sh"), "#!/bin/sh\n");
    fs.chmodSync(path.join(src, "run.sh"), 0o755);
    await inst(src);
    const root = store.providerDir("demo-prov");
    expect((fs.statSync(root).mode & 0o777).toString(8)).toBe("700");
    expect((fs.statSync(path.join(root, "provider.py")).mode & 0o777).toString(8)).toBe("600");
    expect(fs.statSync(path.join(root, "run.sh")).mode & 0o111).not.toBe(0);
  });

  it("test_consent_required", async () => {
    const src = writePlugin(T("src"));
    const exc = await rejectsWith(installer.install(src, HV), ProviderTrustError);
    expect(exc.code).toBe("E8012");
    expect(store.readReceipt("demo-prov")).toBeNull();
  });

  it("test_confirm_callback_sees_plan", async () => {
    const src = writePlugin(T("src"));
    const seen: Array<Record<string, unknown>> = [];
    await rejectsWith(
      installer.install(src, {
        ...HV,
        confirm: (plan) => {
          seen.push(plan.summary());
          return false;
        },
      }),
      ProviderTrustError,
    );
    expect(seen[0]?.["id"]).toBe("demo-prov");
    expect(seen[0]?.["runtime"]).toEqual(["python3", "./provider.py"]);
    expect(store.readReceipt("demo-prov")).toBeNull();
    await installer.install(src, { ...HV, confirm: () => true });
    expect(store.readReceipt("demo-prov")).not.toBeNull();
  });

  it("test_duplicate_needs_force", async () => {
    const src = writePlugin(T("src"));
    await inst(src);
    const exc = await rejectsWith(inst(src), ProviderConflictError);
    expect(exc.code).toBe("E8003");
    writePlugin(src, { version: "0.2.0" });
    await inst(src, { force: true });
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("0.2.0");
  });

  it("test_missing_manifest_and_bad_source", async () => {
    fs.mkdirSync(T("empty"));
    await rejectsWith(inst(T("empty")), ProviderManifestError);
    await rejectsWith(installer.install("definitely-not-a-source", { yes: true, ...HV }), ProviderInstallError);
  });

  it("test_builtin_id_is_reserved", async () => {
    await expect(inst(writePlugin(T("src"), { id: "alicloud-express" }))).rejects.toSatisfy(
      (e) => e instanceof ProviderManifestError || e instanceof ProviderConflictError,
    );
  });

  it.skipIf(process.platform === "win32")("test_symlink_rejected", async () => {
    const src = writePlugin(T("src"));
    fs.writeFileSync(T("outside.txt"), "x");
    fs.symlinkSync(T("outside.txt"), path.join(src, "link"));
    await rejectsWith(inst(src), ProviderInstallError);
  });

  it.skipIf(process.platform === "win32")("test_symlinked_dir_rejected", async () => {
    const src = writePlugin(T("src"));
    fs.mkdirSync(T("outside-dir"));
    fs.symlinkSync(T("outside-dir"), path.join(src, "dir-link"));
    await rejectsWith(inst(src), ProviderInstallError);
  });

  it.skipIf(process.platform === "win32")("test_hardlink_rejected", async () => {
    const src = writePlugin(T("src"));
    fs.writeFileSync(T("outside.txt"), "x");
    fs.linkSync(T("outside.txt"), path.join(src, "hl"));
    await rejectsWith(inst(src), ProviderInstallError);
  });

  it("test_top_level_data_dir_is_reserved", async () => {
    const src = writePlugin(T("src"), { files: { "data/x.txt": "x" } });
    await rejectsWith(inst(src), ProviderInstallError);
  });

  it("test_requires_incompatible_sdk", async () => {
    const src = writePlugin(T("src"));
    const file = path.join(src, "abx-provider.toml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf-8").replace('cli = ">=0.3"', 'cli = ">=99"'));
    await rejectsWith(inst(src), ProviderVersionError);
  });

  it("test_install_never_executes_plugin_code", async () => {
    const canary = T("canary");
    const code = `open(${JSON.stringify(canary)}, 'w').write('ran')\n`;
    const src = writePlugin(T("src"), { files: { "provider.py": code, "sitecustomize.py": code } });
    await inst(src);
    registry.getProvider("demo-prov");
    store.verifyIntegrity("demo-prov");
    expect(fs.existsSync(canary)).toBe(false);
  });

  it("test_sha256_pin", async () => {
    const src = writePlugin(T("src"));
    const { plan } = await installer.prepare(src);
    const exc = await rejectsWith(inst(src, { sha256: "0".repeat(64) }), ProviderIntegrityError);
    expect(exc.code).toBe("E8011");
    const receipt = await inst(src, { sha256: plan.tree_sha256.toUpperCase() });
    expect(receipt["trust"]).toBe("pinned");
  });

  it("test_link_requires_yes_and_skips_integrity", async () => {
    const src = writePlugin(T("src"));
    await rejectsWith(installer.install(src, { ...HV, link: true, confirm: () => true }), ProviderTrustError);
    const receipt = await inst(src, { link: true });
    expect(receipt["trust"]).toBe("link");
    fs.writeFileSync(path.join(src, "provider.py"), "print('changed')\n");
    store.verifyIntegrity("demo-prov");
    expect((registry.getProvider("demo-prov") as unknown as { pluginRoot: string }).pluginRoot).toBe(fs.realpathSync(src));
  });

  it("test_failing_verify_rolls_back_to_previous_version", async () => {
    const src = writePlugin(T("src"), { version: "1.0.0" });
    await inst(src);
    const before = store.digestDir(store.providerDir("demo-prov"));
    writePlugin(src, { version: "2.0.0" });
    await rejectsWith(inst(src, { force: true, verify: boom("handshake failed") }), ProviderInstallError);
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.0.0");
    expect(store.digestDir(store.providerDir("demo-prov"))).toBe(before);
    store.verifyIntegrity("demo-prov");
  });

  it("test_failed_verify_rollback_restores_data_dir_exactly", async () => {
    const src = writePlugin(T("src"), { version: "1.0.0" });
    await inst(src);
    seedData();
    const before = snapshotData();
    expect(Object.keys(before).length).toBeGreaterThan(0);
    writePlugin(src, { version: "2.0.0" });
    await rejectsWith(inst(src, { force: true, verify: boom("handshake failed") }), ProviderInstallError);
    expect(snapshotData()).toEqual(before);
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.0.0");
    store.verifyIntegrity("demo-prov");
    const trash = store.trashDir();
    expect(fs.existsSync(trash) ? fs.readdirSync(trash) : []).toEqual([]);
  });

  it("test_failed_swap_rollback_restores_data_dir_exactly", async () => {
    const src = writePlugin(T("src"), { version: "1.0.0" });
    await inst(src);
    seedData();
    const before = snapshotData();
    writePlugin(src, { version: "2.0.0" });
    const realRename = installer.fsHooks.rename;
    const final = store.providerDir("demo-prov");
    installer.fsHooks.rename = (a, b) => {
      if (b === final && path.dirname(a) === store.stagingDir()) throw Object.assign(new Error("injected failure"), { code: "EACCES" });
      realRename(a, b);
    };
    try {
      await expect(inst(src, { force: true })).rejects.toThrow(/injected/);
    } finally {
      installer.fsHooks.rename = realRename;
    }
    expect(snapshotData()).toEqual(before);
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.0.0");
    store.verifyIntegrity("demo-prov");
  });

  it("test_successful_update_keeps_data_dir", async () => {
    const src = writePlugin(T("src"), { version: "1.0.0" });
    await inst(src);
    seedData();
    const before = snapshotData();
    writePlugin(src, { version: "2.0.0" });
    await inst(src, { force: true, verify: () => undefined });
    expect(snapshotData()).toEqual(before);
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("2.0.0");
  });

  it("test_failing_first_install_leaves_nothing", async () => {
    const src = writePlugin(T("src"));
    await rejectsWith(inst(src, { verify: boom("nope") }), ProviderInstallError);
    expect(store.listInstalledIds()).toEqual([]);
    expect(fs.existsSync(store.providerDir("demo-prov"))).toBe(false);
  });

  it("test_data_dir_survives_force_reinstall", async () => {
    const src = writePlugin(T("src"));
    await inst(src);
    fs.mkdirSync(store.dataDir("demo-prov"), { recursive: true });
    fs.writeFileSync(path.join(store.dataDir("demo-prov"), "state.json"), "{}");
    writePlugin(src, { version: "0.2.0" });
    await inst(src, { force: true });
    expect(fs.existsSync(path.join(store.dataDir("demo-prov"), "state.json"))).toBe(true);
    store.verifyIntegrity("demo-prov");
  });

  it("test_lock_is_exclusive", async () => {
    await store.withStoreLock(async () => {
      await rejectsWith(
        store.withStoreLock(() => undefined, { timeout: 0.2 }),
        ProviderInstallError,
      );
    });
    await store.withStoreLock(() => undefined, { timeout: 0.2 });
  });

  it("test_stale_lock_is_broken", async () => {
    fs.mkdirSync(store.providersDir(), { recursive: true });
    const lock = path.join(store.providersDir(), ".lock");
    fs.writeFileSync(lock, "123");
    fs.utimesSync(lock, 1, 1);
    await store.withStoreLock(() => undefined, { timeout: 0.5 });
  });

  it("test_concurrent_installs_serialize", async () => {
    const srcs = ["a", "b", "c"].map((c, i) => writePlugin(T(`s${i}`), { id: `prov-${c}` }));
    await Promise.all(srcs.map((s) => inst(s)));
    expect(store.listInstalledIds()).toEqual(["prov-a", "prov-b", "prov-c"]);
  });
});

describe("TestIntegrity", () => {
  it("test_tamper_detected", async () => {
    await inst(writePlugin(T("src")));
    fs.writeFileSync(path.join(store.providerDir("demo-prov"), "provider.py"), "print('evil')\n");
    expect(() => store.verifyIntegrity("demo-prov")).toThrow(ProviderIntegrityError);
  });

  it("test_extra_file_detected", async () => {
    await inst(writePlugin(T("src")));
    fs.writeFileSync(path.join(store.providerDir("demo-prov"), "extra.py"), "x");
    expect(() => store.verifyIntegrity("demo-prov")).toThrow(ProviderIntegrityError);
  });

  it.skipIf(process.platform === "win32")("test_mode_change_detected", async () => {
    await inst(writePlugin(T("src")));
    fs.chmodSync(path.join(store.providerDir("demo-prov"), "provider.py"), 0o700);
    expect(() => store.verifyIntegrity("demo-prov")).toThrow(ProviderIntegrityError);
  });

  it("test_data_dir_changes_are_not_tampering", async () => {
    await inst(writePlugin(T("src")));
    fs.mkdirSync(store.dataDir("demo-prov"), { recursive: true });
    fs.writeFileSync(path.join(store.dataDir("demo-prov"), "x"), "state");
    store.verifyIntegrity("demo-prov");
  });

  it("test_not_installed", () => {
    expect(() => store.verifyIntegrity("nothing-here")).toThrow(ProviderNotFoundError);
  });
});

describe("TestUninstall", () => {
  it("test_removes_plugin_keeps_data_unless_purged", async () => {
    await inst(writePlugin(T("src")));
    fs.mkdirSync(store.dataDir("demo-prov"), { recursive: true });
    fs.writeFileSync(path.join(store.dataDir("demo-prov"), "state"), "s");
    const result = await installer.uninstall("demo-prov");
    expect(result.removed).toBe(true);
    expect(result.purged).toBe(false);
    const root = store.providerDir("demo-prov");
    expect(fs.readdirSync(root).sort()).toEqual(["data"]);
    expect(store.listInstalledIds()).toEqual([]);
    await installer.uninstall("demo-prov", { purge: true });
    expect(fs.existsSync(root)).toBe(false);
  });

  it("test_resets_default_and_purges_settings", async () => {
    await inst(writePlugin(T("src")));
    iso.writeToml('# my notes\n[core]\nprovider = "demo-prov"\n\n[providers.demo-prov]\nregion = "x"\n\n[providers.other]\nk = "v"\n');
    const result = await installer.uninstall("demo-prov", { purge: true });
    expect(result.default_reset).toBe(true);
    const text = fs.readFileSync(iso.toml, "utf-8");
    expect(text).not.toContain("demo-prov");
    expect(text).toContain("# my notes");
    expect(text).toContain("[providers.other]");
  });

  it("test_unknown_and_builtin", async () => {
    await rejectsWith(installer.uninstall("ghost"), ProviderNotFoundError);
    await rejectsWith(installer.uninstall("alicloud-express"), ProviderConflictError);
  });
});

describe("TestDefaultSetting", () => {
  it("test_roundtrip_preserves_other_content", () => {
    iso.writeToml('# top\n[transport]\nregion = "cn-beijing"\n');
    settings.setDefaultProvider("demo-prov");
    let text = fs.readFileSync(iso.toml, "utf-8");
    expect(text).toContain("# top");
    expect(text).toContain('region = "cn-beijing"');
    expect(text).toContain('provider = "demo-prov"');
    settings.setDefaultProvider("other-one");
    expect(fs.readFileSync(iso.toml, "utf-8").split("provider =").length - 1).toBe(1);
    settings.setDefaultProvider(null);
    text = fs.readFileSync(iso.toml, "utf-8");
    expect(text).not.toContain("provider =");
    if (process.platform !== "win32") expect((fs.statSync(iso.toml).mode & 0o777).toString(8)).toBe("600");
  });
});

describe("TestClassifySource", () => {
  it.each(["ext::sh -c 'x'", "http://example.com/r.git", "git://example.com/r.git", "file://localhost/nonexistent-installer-fixture", "ftp://x/y"])("test_insecure_rejected[%s]", (src) => {
    expect(() => installer.classifySource(src)).toThrow(ProviderTrustError);
  });

  it.each(["https://user:pw@example.com/r.git", "https://token@example.com/r.git", "ssh://user:pw@example.com/r.git"])(
    "test_credentials_in_url_rejected[%s]",
    (src) => {
      expect(() => installer.classifySource(src)).toThrow(ProviderTrustError);
    },
  );

  it.each(["https://example.com/r.git", "ssh://git@example.com/r.git", "git@example.com:org/r.git", "git+https://example.com/r"])(
    "test_good_urls[%s]",
    (src) => {
      expect(installer.classifySource(src)[0]).toBe("git");
    },
  );

  it("test_insecure_allowed_with_flag", () => {
    expect(installer.classifySource("file://localhost/nonexistent-installer-fixture", { allowInsecure: true })[0]).toBe("git");
  });

  it("test_garbage", () => {
    expect(() => installer.classifySource("not a thing")).toThrow(ProviderInstallError);
  });

  it("test_redact_url", () => {
    expect(store.redactUrl("https://u:p@h.com/r")).toBe("https://h.com/r");
    expect(store.redactUrl("https://h.com/r")).toBe("https://h.com/r");
  });
});

describe("TestPathSafety", () => {
  const BAD = ["", "/abs", "../x", "a/../../x", "a//b", "./a", "a\\b", "C:/x", "a/b/", "nul", "COM1.txt", "a/.", "x.", "x ", "a\x00b"];
  it.each(BAD)("test_rejects[%j]", (p) => {
    expect(() => store.validateRelPath(p)).toThrow(ProviderInstallError);
  });
  it.each(["a", "a/b.py", "dir/sub/file.txt", ".hidden", "a-b_c.d"])("test_accepts[%s]", (p) => {
    store.validateRelPath(p);
  });

  it("test_case_collisions_and_limits", () => {
    const e = (p: string, data = Buffer.alloc(0)): store.FileEntry => ({ path: p, executable: false, data });
    expect(() => store.checkLimits([e("A.py"), e("a.py")])).toThrow(ProviderInstallError);
    expect(() => store.checkLimits(Array.from({ length: store.MAX_FILES + 1 }, (_, i) => e(`f${i}`)))).toThrow(ProviderInstallError);
    expect(() => store.checkLimits([e("big", Buffer.alloc(store.MAX_FILE_BYTES + 1, "x"))])).toThrow(ProviderInstallError);
  });
});

describe("TestGitInstall", () => {
  let repo = "";
  const url = (r = repo): string => `file://${r}`;
  beforeEach(() => {
    repo = initRepo(T("remote"));
    writePlugin(repo, { version: "1.0.0" });
    gitCommitAll(repo, "v1");
  });

  it("test_insecure_transport_needs_flag", async () => {
    await rejectsWith(installGit(url(), { yes: true }), ProviderTrustError);
  });

  it("test_unpinned_refused_non_interactive", async () => {
    const exc = await rejectsWith(installGit(url(), { yes: true, allowInsecureTransport: true }), ProviderTrustError);
    expect(String(exc.message).toLowerCase()).toContain("unpinned");
    expect(store.readReceipt("demo-prov")).toBeNull();
  });

  it("test_unpinned_allowed_explicitly", async () => {
    const receipt = await installGit(url(), GIT_KW);
    expect(receipt["trust"]).toBe("unpinned");
    expect((receipt["source"] as Record<string, unknown>)["commit"]).toBe(git(repo, "rev-parse", "HEAD"));
    expect((receipt["source"] as Record<string, unknown>)["type"]).toBe("git");
    store.verifyIntegrity("demo-prov");
    expect(fs.existsSync(path.join(store.providerDir("demo-prov"), ".git"))).toBe(false);
  });

  it("test_commit_pin_is_trusted_and_checked", async () => {
    const commit = git(repo, "rev-parse", "HEAD");
    const receipt = await installGit(url(), { ref: commit, yes: true, allowInsecureTransport: true });
    expect(receipt["trust"]).toBe("pinned");
    expect((receipt["source"] as Record<string, unknown>)["commit"]).toBe(commit);
  });

  it("test_tag_is_unpinned", async () => {
    git(repo, "tag", "v1");
    await rejectsWith(installGit(url(), { ref: "v1", yes: true, allowInsecureTransport: true }), ProviderTrustError);
    const receipt = await installGit(url(), { ref: "v1", ...GIT_KW });
    expect(receipt["trust"]).toBe("unpinned");
  });

  it("test_sha256_pins_a_branch", async () => {
    const { plan } = await installer.prepare(url(), { allowInsecureTransport: true });
    const receipt = await installGit(url(), { sha256: plan.tree_sha256, yes: true, allowInsecureTransport: true });
    expect(receipt["trust"]).toBe("pinned");
  });

  it("test_subdir", async () => {
    const mono = initRepo(T("mono"));
    writePlugin(path.join(mono, "plugins", "one"), { id: "sub-one" });
    fs.writeFileSync(path.join(mono, "README.md"), "mono");
    gitCommitAll(mono);
    const receipt = await installGit(url(mono), { subdir: "plugins/one", ...GIT_KW });
    expect(receipt["id"]).toBe("sub-one");
    expect((receipt["source"] as Record<string, unknown>)["subdir"]).toBe("plugins/one");
    expect(fs.existsSync(path.join(store.providerDir("sub-one"), "README.md"))).toBe(false);
  });

  it.each(["../x", "/abs", "-flag", "a/../b"])("test_bad_subdir[%s]", async (subdir) => {
    await rejectsWith(installGit(url(), { subdir, ...GIT_KW }), ProviderInstallError);
  });

  it.skipIf(process.platform === "win32")("test_symlink_in_repo_rejected", async () => {
    const evil = initRepo(T("evil"));
    writePlugin(evil);
    fs.symlinkSync(T("remote"), path.join(evil, "leak"));
    gitCommitAll(evil);
    await rejectsWith(installGit(url(evil), GIT_KW), ProviderInstallError);
    expect(store.readReceipt("demo-prov")).toBeNull();
  });

  it("test_submodule_in_repo_rejected", async () => {
    const subm = initRepo(T("subm"));
    writePlugin(subm);
    gitCommitAll(subm);
    git(subm, "update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},vendor`);
    git(subm, "commit", "-q", "-m", "gitlink");
    await rejectsWith(installGit(url(subm), GIT_KW), ProviderInstallError);
  });

  it.skipIf(process.platform === "win32")("test_hooks_and_git_dir_are_not_executed_or_installed", async () => {
    const hooky = initRepo(T("hooky"));
    writePlugin(hooky);
    const canary = T("hook-ran");
    const hook = path.join(hooky, ".git", "hooks", "post-checkout");
    fs.writeFileSync(hook, `#!/bin/sh\ntouch ${canary}\n`);
    fs.chmodSync(hook, 0o755);
    fs.writeFileSync(path.join(hooky, ".gitattributes"), "* filter=pwn\n");
    gitCommitAll(hooky);
    git(hooky, "config", "filter.pwn.smudge", `touch ${canary}; cat`);
    await installGit(url(hooky), GIT_KW);
    expect(fs.existsSync(canary)).toBe(false);
  });

  it("test_update_flow", async () => {
    await installGit(url(), GIT_KW);
    expect((await updateGit("demo-prov", GIT_KW)).status).toBe("up-to-date");
    writePlugin(repo, { version: "1.1.0" });
    const commit = gitCommitAll(repo, "v1.1");
    let res = await updateGit("demo-prov", { check: true, ...GIT_KW });
    expect(res.status).toBe("available");
    expect(res.available).toBe(commit);
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.0.0");
    res = await updateGit("demo-prov", GIT_KW);
    expect(res.status).toBe("updated");
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.1.0");
    store.verifyIntegrity("demo-prov");
  });

  it("test_update_requires_new_consent_for_risky_changes", async () => {
    const kw = { allowInsecureTransport: true, allowUnpinned: true };
    await installGit(url(), { yes: true, ...kw });
    writePlugin(repo, { version: "1.1.0", extra: '[security]\nnetwork = ["*"]\n[core]\ninherit = ["sandbox_api_key"]\n' });
    gitCommitAll(repo);
    await rejectsWith(updateGit("demo-prov", kw), ProviderTrustError);
    const seen: string[][] = [];
    await rejectsWith(
      updateGit("demo-prov", {
        ...kw,
        confirm: (plan) => {
          seen.push(plan.changes);
          return false;
        },
      }),
      ProviderTrustError,
    );
    expect(seen[0]).toContain("security");
    expect(seen[0]).toContain("inherit");
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.0.0");
    await updateGit("demo-prov", { ...kw, confirm: () => true });
    expect((store.readReceipt("demo-prov")?.["consented"] as Record<string, unknown>)["inherit"]).toEqual(["sandbox_api_key"]);
  });

  it("test_pinned_install_does_not_float", async () => {
    const commit = git(repo, "rev-parse", "HEAD");
    await installGit(url(), { ref: commit, yes: true, allowInsecureTransport: true });
    writePlugin(repo, { version: "9.9.9" });
    gitCommitAll(repo);
    const res = await updateGit("demo-prov", { yes: true, allowInsecureTransport: true });
    expect(res.status).toBe("pinned");
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.0.0");
  });

  it("test_update_refuses_id_change", async () => {
    await installGit(url(), GIT_KW);
    writePlugin(repo, { id: "renamed-prov", version: "2.0.0" });
    gitCommitAll(repo);
    await rejectsWith(updateGit("demo-prov", GIT_KW), ProviderInstallError);
  });

  it("test_update_rolls_back_on_failed_verify", async () => {
    await installGit(url(), GIT_KW);
    writePlugin(repo, { version: "1.1.0" });
    gitCommitAll(repo);
    await rejectsWith(updateGit("demo-prov", { verify: boom("handshake"), ...GIT_KW }), ProviderInstallError);
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.0.0");
    store.verifyIntegrity("demo-prov");
  });

  it("test_update_rollback_after_failed_verify_keeps_data_dir", async () => {
    await installGit(url(), GIT_KW);
    seedData();
    const before = snapshotData();
    writePlugin(repo, { version: "1.1.0" });
    gitCommitAll(repo);
    await rejectsWith(updateGit("demo-prov", { verify: boom("handshake"), ...GIT_KW }), ProviderInstallError);
    expect(snapshotData()).toEqual(before);
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.0.0");
    store.verifyIntegrity("demo-prov");
  });

  it("test_update_accepts_allow_insecure_transport", async () => {
    await installGit(url(), GIT_KW);
    writePlugin(repo, { version: "1.1.0" });
    gitCommitAll(repo);
    const base = { yes: true, allowUnpinned: true };
    await rejectsWith(updateGit("demo-prov", base), ProviderTrustError);
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.0.0");
    expect((await updateGit("demo-prov", { ...base, allowInsecureTransport: true, check: true })).status).toBe("available");
    await updateGit("demo-prov", { ...base, allowInsecureTransport: true });
    expect(store.readReceipt("demo-prov")?.["version"]).toBe("1.1.0");
  });

  it("test_catalog_ref_uses_double_slash_for_the_subdirectory", () => {
    expect(installer.expandCatalogRef("alibaba-agent-sandbox/awesome-providers//opensandbox")).toEqual({
      source: "https://github.com/alibaba-agent-sandbox/awesome-providers.git",
      ref: null,
      subdir: "opensandbox",
    });
    expect(installer.expandCatalogRef("acme/plugins//providers/one@v1.2.0")).toEqual({
      source: "https://github.com/acme/plugins.git",
      ref: "v1.2.0",
      subdir: "providers/one",
    });
    const url = "https://github.com/acme/plugins.git";
    expect(installer.expandCatalogRef(url, null, "opensandbox")).toEqual({ source: url, ref: null, subdir: "opensandbox" });
    expect(() => installer.expandCatalogRef("acme/plugins//one", null, "two")).toThrow(/--subdir/);
    expect(() => installer.expandCatalogRef("acme/plugins//one@v1", "v2")).toThrow(/--ref/);
  });

  it("test_update_of_local_install_is_an_error", async () => {
    await inst(writePlugin(T("src")));
    await rejectsWith(installer.update("demo-prov", { yes: true }), ProviderInstallError);
  });

  it("test_update_of_catalog_install_points_at_cli_reinstall", async () => {
    await inst(writePlugin(T("src")));
    const receipt = store.readReceipt("demo-prov");
    expect(receipt).not.toBeNull();
    receipt!["source"] = { type: "catalog", id: "opensandbox", registry: "https://registry.agent-sandbox.cn/providers/index.json" };
    store.writeReceipt(store.providerDir("demo-prov"), receipt!);
    const exc = await rejectsWith(installer.update("demo-prov", { yes: true }), ProviderInstallError);
    expect(exc.message).toContain("abx provider install alibaba-agent-sandbox/awesome-providers//opensandbox --force");
  });

  it("test_receipt_never_contains_credentials", async () => {
    await installGit(url(), GIT_KW);
    const text = JSON.stringify(store.readReceipt("demo-prov"));
    expect((text.split('"url"')[1] as string).split(",")[0]).not.toContain("@");
  });
});

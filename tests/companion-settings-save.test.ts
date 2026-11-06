import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { companionProblems, problemReport } from "../companion/problems.mjs";
import { startSignIn } from "../companion/engine.mjs";

// 9.0 release blocker: on a second PC no settings save ever reached the disk, with nothing logged.
// A Windows protected-storage call that never answers must not stop the save, nor the next ones.
const require = createRequire(import.meta.url);
const { createStoreConfig } = require("../companion-app/store-config.cjs");
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;

const never = () => new Promise<never>(() => {});
const encode = (text: string) => Buffer.from("DPAPI:" + Buffer.from(text).toString("base64"));
const decode = (data: Buffer) => Buffer.from(data.toString().slice(6), "base64").toString();
// Electron's safeStorage with every asynchronous call hanging; the synchronous ones work.
function hangingStorage({ sync = true } = {}) {
  return {
    isAsyncEncryptionAvailable: vi.fn(never),
    encryptStringAsync: vi.fn(never),
    decryptStringAsync: vi.fn(never),
    ...(sync ? {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((text: string) => encode(text)),
      decryptString: vi.fn((data: Buffer) => decode(data))
    } : {})
  };
}
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function setup(storage: object) {
  const folder = mkdtempSync(join(tmpdir(), "guilded-settings-save-")); folders.push(folder);
  const lines: string[] = [];
  const store = createStoreConfig(storage, { timeoutMs: 40, log: (line: string) => lines.push(line) });
  return { file: join(folder, "config.secure"), store, lines };
}

describe("saving settings when Windows protected storage hangs", () => {
  it("lands through the synchronous call, and so do the next saves", async () => {
    const { file, store, lines } = setup(hangingStorage());
    await store.write(file, { companionCredential: "first", watchFile: "C:\\WoW\\Guilded.lua" });
    expect(JSON.parse(decode(readFileSync(file)))).toMatchObject({ companionCredential: "first" });
    await Promise.all([store.write(file, { companionCredential: "second" }), store.write(file, { companionCredential: "third" })]);
    expect(JSON.parse(decode(readFileSync(file)))).toEqual({ companionCredential: "third" });
    expect(await store.read(file)).toEqual({ companionCredential: "third" });
    await expect(store.flush()).resolves.toBeUndefined();
    expect(lines).toContain("settings save stuck at available (no answer after 0 s); using the synchronous call");
    expect(lines.some((line) => line.startsWith("encrypt: ok through the synchronous call"))).toBe(true);
    expect(lines.filter((line) => line.startsWith("save: done"))).toHaveLength(3);
    expect(store.status()).toMatchObject({ lastError: null, stuck: null });
  }, 10_000);

  it("keeps the last good file and says why when no call answers at all", async () => {
    const { file, store, lines } = setup(hangingStorage({ sync: false }));
    writeFileSync(file, "last good file");
    await expect(store.write(file, { companionCredential: "new" })).rejects.toThrow(/did not answer at available.*last saved file is kept/);
    expect(readFileSync(file, "utf8")).toBe("last good file");
    expect(store.status().lastError?.message).toMatch(/did not answer/);
    expect(lines).toContain("available: no synchronous fallback");
    // A later save is not stuck behind the failed one: it runs (and fails the same way) at once.
    await expect(store.write(file, { companionCredential: "newer" })).rejects.toThrow(/did not answer/);
    await expect(store.flush()).rejects.toThrow(/did not answer/);
  }, 10_000);

  it("does not let one never-ending save hold up the queue or the flush forever", async () => {
    // encrypt hangs with no fallback once; afterwards it works.
    let calls = 0;
    const storage = {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: (text: string) => (++calls === 1 ? never() : Promise.resolve(encode(text))),
      decryptStringAsync: async (data: Buffer) => ({ result: decode(data), shouldReEncrypt: false })
    };
    const { file, store } = setup(storage);
    const first = store.write(file, { n: 1 });
    const second = store.write(file, { n: 2 });
    await expect(first).rejects.toThrow(/did not answer at encrypt/);
    await second;
    expect(JSON.parse(decode(readFileSync(file)))).toEqual({ n: 2 });
  }, 10_000);

  it("reads a saved file through the synchronous call too", async () => {
    const { file, store } = setup(hangingStorage());
    writeFileSync(file, encode(JSON.stringify({ companionCredential: "kept" })));
    expect(await store.read(file)).toEqual({ companionCredential: "kept" });
    expect(existsSync(file)).toBe(true);
  }, 10_000);
});

describe("the Problems panel when settings cannot be saved", () => {
  it("comes first and carries only two yes/no values", () => {
    const found = companionProblems({ settingsSave: { failed: true, stuck: false, step: "encrypt" }, diskSpace: { ok: false, freeMb: 10, neededMb: 600 } });
    expect(found[0]).toEqual({ id: "settings-not-saved", data: { failed: true, stuck: false } });
    expect(companionProblems({ settingsSave: null }).some((p) => p.id === "settings-not-saved")).toBe(false);
    expect(problemReport({ problems: found, reference: "ABCDEFGH" }).text).toContain("settings-not-saved");
  });

  it("is worded in French", () => {
    const page = readFileSync("companion-app/renderer/problems.js", "utf8");
    expect(page).toContain("case 'settings-not-saved'");
    for (const key of ["Settings could not be saved.", "Settings could not be saved: {0}", "Windows protected storage is not answering. What you change now is kept only until the companion closes."]) expect(fr[key], key).toBeTruthy();
  });
});

describe("the Discord sign-in from the second-PC test", () => {
  it("counts down from the bot's remaining seconds, not the PC clock", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      requestId: "r".repeat(43), confirm: "ABC-123", url: "https://guilded.kcaron.top/me/companion?request=x",
      expiresAt: "2020-01-01T00:00:00.000Z", expiresInSeconds: 1200, loopbackAccepted: false
    }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const started = await startSignIn({ uploadUrl: "https://guilded.kcaron.top" });
      expect(started.ok).toBe(true);
      const left = (Date.parse(started.expiresAt ?? "") - Date.now()) / 1000;
      expect(left).toBeGreaterThan(1190);
      expect(left).toBeLessThanOrEqual(1200);
    } finally { fetchMock.mockRestore(); }
  });

  it("Reopen the page starts a new request and the waiting loop follows it", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    const reopen = main.slice(main.indexOf('registerIpc("sign-in-reopen"'));
    expect(reopen).toMatch(/beginSignIn\(current\.next\)[\s\S]{0,400}current\.replacedBy = begun\.current[\s\S]{0,80}signIn = begun\.current/);
    expect(main).toMatch(/if \(current\.replacedBy && signIn === current\.replacedBy\) \{\s*current = current\.replacedBy;/);
  });

  it("has the French for the sign-in box's English line", () => {
    const html = readFileSync("companion-app/renderer/index.html", "utf8");
    expect(html).toContain("Then choose your server, press Connect, and come back here.");
    expect(fr["Then choose your server, press Connect, and come back here."]).toMatch(/Connecter/);
  });
});

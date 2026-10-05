import { File } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserCompanion } from "../companion/browser-client.mjs";

afterEach(() => vi.restoreAllMocks());
const profile = { guildDiscordId: "123", wowEnabled: false, poeEnabled: true, poeCharacter: "Mapper", poeLeague: "Pilot", poeMode: "STANDARD", pairingCode: "ABC123DEF456" };
function environment() {
  const storage = new Map<string, string>();
  const session = new Map<string, string>();
  let file: File;
  const env = {
    location: { origin: "https://bot.test", search: "", reload: vi.fn() },
    localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    sessionStorage: { getItem: (key: string) => session.get(key), setItem: (key: string, value: string) => session.set(key, value), removeItem: (key: string) => session.delete(key) },
    document: { createElement: () => {
      const events = new Map<string, () => void>();
      return { files: [file], addEventListener: (name: string, run: () => void) => events.set(name, run), click: () => events.get("change")?.(), remove: vi.fn() };
    } }, URL, Blob,
    fetch: vi.fn(async (url: string, options: { body?: string }) => {
      const body = options.body ? JSON.parse(options.body) : {};
      return { ok: true, status: 200, json: async () => url.endsWith("addon-pairings") ? { companionCredential: "c".repeat(43) } : url.endsWith("poe/visits") ? { acceptedRunRefs: body.visits.map((row: { runRef: string }) => row.runRef) } : { ok: true } };
    })
  };
  return { env, storage, session, choose: (value: File) => { file = value; } };
}
const logFile = () => {
  const date = new Date(); const prefix = [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("/");
  return new File([`${prefix} 00:01:00 1 abc [DEBUG Client 42] Generating level 80 area "MapSteppe" with seed 77\n${prefix} 00:02:00 2 def [DEBUG Client 42] Generating level 1 area "Hideout" with seed 88\n`], "Client.txt");
};

describe("online companion session and queue", () => {
  it("keeps pairing and pending observations after the original tab closes", async () => {
    const { env, session, storage, choose } = environment();
    const api = createBrowserCompanion(env as never);
    await api.pairAccount(profile); choose(logFile()); await api.browsePoeLog(profile);
    session.clear();
    const reopened = createBrowserCompanion(env as never);
    const all = await reopened.getAll();
    expect(all.config.companionCredential).toBe("c".repeat(43));
    expect(all.config.guildDiscordId).toBe("123");
    expect(all.state.poe?.pending).toBe(1);
    expect(JSON.stringify([...storage.values()])).not.toContain(profile.pairingCode);
    await reopened.removeData();
    expect(storage.size).toBe(0); expect(session.size).toBe(0);
    expect((await createBrowserCompanion(env as never).getAll()).config.companionCredential).toBeUndefined();
  });
  it("migrates a tab pairing and warns when device storage cannot save", async () => {
    const { env, session } = environment();
    session.set("guilded.companion.session.v1", JSON.stringify({ config: { ...profile, pairingCode: "", companionCredential: "c".repeat(43) }, visits: [] }));
    const migrated = createBrowserCompanion(env as never);
    expect((await migrated.getAll()).config.companionCredential).toBe("c".repeat(43));
    expect(session.size).toBe(0);
    const restricted = createBrowserCompanion({ ...env, localStorage: { ...env.localStorage, setItem: () => { throw new Error("Storage blocked"); } } } as never);
    expect((await restricted.getAll()).health).toMatchObject({ level: "warn", text: expect.stringContaining("cannot remember") });
    expect((await restricted.getAll()).config.companionCredential).toBe("c".repeat(43));
  });
  it("reads updated folder data on every upload and writes returned standings directly", async () => {
    const { env } = environment(); let character = "First";
    const input = { name: "SavedVariables", queryPermission: async () => "granted", getFileHandle: async () => ({ getFile: async () => new File([`GuildedDB = { addonVersion = "6.0.0", character = { name = "${character}", class = "Mage", level = 70 }, epgp = {} }`], "Guilded.lua") }) };
    const writer = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
    const output = { name: "Guilded", queryPermission: async () => "granted", getFileHandle: vi.fn(async () => ({ createWritable: async () => writer })) };
    const picker = vi.fn(async () => input);
    const api = createBrowserCompanion({ ...env, showDirectoryPicker: picker } as never);
    await api.getAll(); await api.pairAccount({ ...profile, wowEnabled: true, poeEnabled: false }); await api.browseFile();
    await api.uploadNow(); character = "Second"; await api.uploadNow();
    const uploads = env.fetch.mock.calls.filter(call => call[0] === "/api/v1/addon-imports");
    expect(uploads.map(call => JSON.parse(call[1].body!).export.character.name)).toEqual(["First", "Second"]);
    picker.mockResolvedValue(output as never);
    env.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ standings: [], updatedAt: "2026-10-05" }) } as never);
    await api.refreshStandings(); expect(writer.write).toHaveBeenCalledWith(expect.stringContaining("GuildedStandings"));
    expect((await api.getAll()).state.lastStandings).toMatchObject({ message: expect.stringContaining("saved") });
    env.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "APPLIED" }) } as never);
    env.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ standings: [], updatedAt: "2026-10-06" }) } as never);
    await api.uploadNow();
    expect(writer.write).toHaveBeenCalledTimes(2);
    expect(writer.write).toHaveBeenLastCalledWith(expect.stringContaining("2026-10-06"));
    expect(picker).toHaveBeenCalledTimes(2); // No new folder dialog after setup.
    env.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "APPLIED" }) } as never);
    env.fetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Standings unavailable" }) } as never);
    await api.uploadNow();
    const failedReturn = await api.getAll();
    expect(failedReturn.state.lastUpload).toMatchObject({ message: "Your saved data is synced." });
    expect(failedReturn.health.level).toBe("error");
    expect(writer.write).toHaveBeenCalledTimes(2); // Failed return cannot overwrite standings.
    await api.forgetFiles(); expect((await api.getAll()).state.watching).toBeNull();
  });
  it("checks server availability before pairing without requiring a guild or PoE2", async () => {
    const { env } = environment(); const api = createBrowserCompanion(env as never);
    expect(await api.testConnection({ guildDiscordId: "", wowEnabled: true })).toMatchObject({ ok: true, message: expect.stringContaining("not linked yet") });
    expect(env.fetch.mock.calls.map(call => call[0])).toEqual(["/health"]);
    expect((await api.getAll()).state.running).toBe(false);
  });
  it("verifies WoW authorization after health and reports a revoked link as a failure", async () => {
    const { env } = environment(); const api = createBrowserCompanion(env as never);
    await api.pairAccount(profile); env.fetch.mockClear();
    expect(await api.testConnection({ ...profile, wowEnabled: true })).toMatchObject({ ok: true });
    expect(env.fetch.mock.calls.map(call => call[0])).toEqual(["/health", "/api/v1/standings?guild=123"]);
    env.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) } as never);
    env.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "Pair this companion again." }) } as never);
    expect(await api.testConnection({ ...profile, wowEnabled: true })).toMatchObject({ ok: false, message: "Pair this companion again." });
  });
  it("does not claim a connected account when health is unready or only a PoE profile is selected", async () => {
    const { env } = environment(); const api = createBrowserCompanion(env as never);
    env.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: false }) } as never);
    expect(await api.testConnection(profile)).toMatchObject({ ok: false });
    await api.pairAccount(profile); env.fetch.mockClear();
    await api.testConnection(profile);
    expect(env.fetch.mock.calls.map(call => call[0])).toEqual(["/health", "/api/v1/poe/status?guild=123"]);
  });
  it("pairs through the personal endpoint and keeps credentials out of activity", async () => {
    const { env, storage } = environment(); const api = createBrowserCompanion(env as never);
    expect(await api.pairAccount(profile)).toMatchObject({ ok: true });
    const all = await api.getAll(); expect(all.config.companionCredential).toBe("c".repeat(43));
    expect(env.fetch.mock.calls[0]?.[0]).toBe("/api/v1/addon-pairings");
    expect(JSON.stringify(all.logs)).not.toContain("c".repeat(43));
    expect(Array.from(storage.values()).join()).not.toContain(profile.pairingCode);
    expect((await createBrowserCompanion(env as never).getAll()).state.running).toBe(true);
  });
  it("keeps a failed upload queue across reload and drains only acknowledged refs", async () => {
    const { env, storage, choose } = environment(); const api = createBrowserCompanion(env as never);
    await api.pairAccount(profile); choose(logFile()); await api.browsePoeLog(profile);
    expect((await api.getAll()).state.poe?.pending).toBe(1);
    env.fetch.mockRejectedValueOnce(new Error("Offline")); await expect(api.uploadNow()).rejects.toThrow("Offline");
    expect((await api.getAll()).health.level).toBe("error");
    await api.uploadNow(); expect((await api.getAll()).health.level).toBe("ok");
    choose(logFile()); await api.browsePoeLog(profile);
    expect(JSON.stringify((await api.getAll()).logs)).not.toMatch(/with seed|DEBUG Client/);
    const resumed = createBrowserCompanion(env as never); expect((await resumed.getAll()).state.poe?.pending).toBe(1);
    await resumed.uploadNow(); expect((await resumed.getAll()).state.poe?.pending).toBe(0);
    expect(Array.from(storage.values()).join()).not.toContain("MapSteppe");
  });
  it("retains visits when acknowledgement is incomplete and blocks profile changes", async () => {
    const { env, choose } = environment(); const api = createBrowserCompanion(env as never);
    await api.pairAccount(profile); choose(logFile()); await api.browsePoeLog(profile);
    env.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ acceptedRunRefs: [] }) } as never);
    await expect(api.uploadNow()).rejects.toThrow(/acknowledge/);
    expect((await api.getAll()).state.poe?.pending).toBe(1);
    expect(await api.saveConfig({ ...profile, guildDiscordId: "456" })).toMatchObject({ ok: false });
    await expect(api.browsePoeLog({ ...profile, poeCharacter: "Other" })).rejects.toThrow(/queued/);
    expect(await api.pairAccount(profile)).toMatchObject({ ok: false });
  });
  it("rejects malformed pairing responses and revokes the session before clearing it", async () => {
    const { env, storage } = environment(); const api = createBrowserCompanion(env as never);
    env.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as never);
    expect(await api.pairAccount(profile)).toMatchObject({ ok: false });
    await api.pairAccount(profile); await api.removeData();
    expect(env.fetch.mock.calls.at(-1)?.[0]).toBe("/api/v1/companion/logout");
    expect(storage.size).toBe(0); expect(env.location.reload).toHaveBeenCalledOnce();
  });
});

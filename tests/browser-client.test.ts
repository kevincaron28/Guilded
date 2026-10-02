import { File } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserCompanion } from "../companion/browser-client.mjs";

afterEach(() => vi.restoreAllMocks());
const profile = { guildDiscordId: "123", wowEnabled: false, poeEnabled: true, poeCharacter: "Mapper", poeLeague: "Pilot", poeMode: "STANDARD", pairingCode: "ABC123DEF456" };
function environment() {
  const storage = new Map<string, string>();
  let file: File;
  const env = {
    location: { origin: "https://bot.test", search: "", reload: vi.fn() },
    sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    document: { createElement: () => {
      const events = new Map<string, () => void>();
      return { files: [file], addEventListener: (name: string, run: () => void) => events.set(name, run), click: () => events.get("change")?.(), remove: vi.fn() };
    } }, URL, Blob,
    fetch: vi.fn(async (url: string, options: { body?: string }) => {
      const body = options.body ? JSON.parse(options.body) : {};
      return { ok: true, status: 200, json: async () => url.endsWith("addon-pairings") ? { companionCredential: "c".repeat(43) } : url.endsWith("poe/visits") ? { acceptedRunRefs: body.visits.map((row: { runRef: string }) => row.runRef) } : { ok: true } };
    })
  };
  return { env, storage, choose: (value: File) => { file = value; } };
}
const logFile = () => {
  const date = new Date(); const prefix = [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("/");
  return new File([`${prefix} 00:01:00 1 abc [DEBUG Client 42] Generating level 80 area "MapSteppe" with seed 77\n${prefix} 00:02:00 2 def [DEBUG Client 42] Generating level 1 area "Hideout" with seed 88\n`], "Client.txt");
};

describe("online companion session and queue", () => {
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

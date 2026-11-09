import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimDevice, deviceMessage, deviceSummary, deviceUploadBody, registerDevice, splitGuildKey } from "../companion/device-sync.mjs";
import { createEngine, isDeviceMode, startSignIn, validateConfig } from "../companion/engine.mjs";
import { statusCard } from "../companion/status-card.mjs";
import { companionOverview } from "../companion/overview.mjs";

// Zero-setup companion (docs/ZERO_SETUP_COMPANION.md): the companion half.

const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const KEY = "k".repeat(43);
const device = (file = "C:/WoW/Guilded.lua") => ({ watchFile: file, uploadUrl: "https://bot.test/api/v1/addon-imports", device: true, deviceSecret: KEY });

describe("what an unsigned upload sends", () => {
  it("splits the addon's guild key at the first hyphen", () => {
    expect(splitGuildKey("Quebec Gold-CAMWOW US2 Realm 2 PvP")).toEqual({ name: "Quebec Gold", realm: "CAMWOW US2 Realm 2 PvP" });
    expect(splitGuildKey("NoRealm")).toBeNull();
    expect(splitGuildKey("-Realm")).toBeNull();
    expect(splitGuildKey(undefined)).toBeNull();
  });

  it("keeps only the guild and this PC's characters: no ledger, loot, ranks or runs", () => {
    const body = deviceUploadBody({
      wowGuild: "Quebec Gold-CAMWOW US2 Realm 2 PvP",
      character: { name: "Lebowski Holyroller", realm: "", class: "PALADIN", race: "Human", level: 14, guildRank: "Co-GM", professions: ["Mining"] },
      alts: [{ name: "Lebowski Highspirits", class: "PRIEST", level: 1 }, { name: "Lebowski Holyroller", class: "PALADIN" }, { name: "Bad|Name" }],
      epgpTransactions: [{ amount: 50 }], loot: [{}], dungeonRuns: [{}], guildRoster: {}
    }, { server: "111111111" });
    expect(body).toEqual({
      guild: { name: "Quebec Gold", realm: "CAMWOW US2 Realm 2 PvP" },
      characters: [
        { name: "Lebowski Holyroller", realm: "", class: "PALADIN", race: "Human", level: 14 },
        { name: "Lebowski Highspirits", realm: "", class: "PRIEST", level: 1 }
      ],
      server: "111111111"
    });
  });

  it("caps the characters it sends", () => {
    const alts = Array.from({ length: 30 }, (_, i) => ({ name: `Alt Number${i}`, class: "MAGE", level: 10 }));
    expect(deviceUploadBody({ alts }).characters).toHaveLength(12);
  });
});

describe("the bot's answers", () => {
  it("turns them into a status line", () => {
    const synced = deviceSummary({ status: "synced", server: { discordId: "1", name: "Quebec Gold" }, guild: { name: "Quebec Gold", realm: "R" }, characters: 2 });
    expect(deviceMessage(synced)).toBe("Syncing to Quebec Gold (from your guild Quebec Gold). Your characters show as reported until you sign in with Discord.");
    expect(deviceMessage(deviceSummary({ status: "no-guild", guild: { name: "Quebec Gold", realm: "R" } }))).toContain("isn't set up on Discord yet");
    expect(deviceMessage(deviceSummary({ status: "no-guild", guild: { name: "Québec Gold", realm: "CAMWOW US2 Realm 2 PvP" } }))).toContain("Québec Gold (realm CAMWOW US2 Realm 2 PvP) isn't set up");
    expect(deviceMessage(deviceSummary({ status: "no-guild", guild: null }))).toContain("Waiting for your character's guild");
    expect(deviceSummary({ status: "choose", guild: { name: "G", realm: "R" }, servers: [{ discordId: "1", name: "A" }, { discordId: "2", name: "B" }] })?.servers).toHaveLength(2);
    expect(deviceSummary({ nonsense: true })).toBeNull();
  });

  it("registers once and claims with both the device key and the member credential", async () => {
    const fetcher = vi.fn(async () => Response.json({ deviceSecret: KEY, deviceId: "d1" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await registerDevice(device())).toEqual({ ok: true, deviceSecret: KEY });
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe("https://bot.test/api/v1/device/register");

    fetcher.mockResolvedValue(Response.json({ ok: true }));
    expect(await claimDevice(device(), "c".repeat(43))).toEqual({ ok: true, status: 200 });
    const headers = ((fetcher.mock.calls[1] as unknown[])[1] as { headers: Record<string, string> }).headers;
    expect(headers["x-companion-device"]).toBe(KEY);
    expect(headers["x-companion-credential"]).toBe("c".repeat(43));
  });

  it("says an older bot does not support it, so Sign in with Discord still works", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Not found" }, { status: 404 })));
    expect(await registerDevice(device())).toMatchObject({ ok: false, unsupported: true });
  });

  it("sends the device key with a sign-in, so the page can pick its server first", async () => {
    const fetcher = vi.fn(async () => Response.json({ requestId: "r".repeat(43), url: "https://bot.test/me/companion?request=x", confirm: "ABC-DEF", expiresInSeconds: 600 }));
    vi.stubGlobal("fetch", fetcher);
    await startSignIn(device());
    expect(((fetcher.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> }).headers["x-companion-device"]).toBe(KEY);
  });
});

describe("device mode in the engine and the window", () => {
  it("needs no sign-in and no server ID", () => {
    expect(isDeviceMode(device())).toBe(true);
    expect(validateConfig(device())).toEqual([]);
    // A signed-in install is never in device mode, whatever is left in its settings.
    expect(isDeviceMode({ ...device(), companionCredential: "x".repeat(32) })).toBe(false);
    expect(isDeviceMode({ ...device(), deviceSecret: "" })).toBe(false);
  });

  it("uploads this PC's characters with the device key and shows where they went", async () => {
    const root = mkdtempSync(join(tmpdir(), "qg-device-"));
    dirs.push(root);
    const saved = join(root, "WTF", "Account", "ACC", "SavedVariables");
    mkdirSync(saved, { recursive: true });
    const file = join(saved, "Guilded.lua");
    writeFileSync(file, 'GuildedDB = { version = 3, guildKey = "Quebec Gold-CAMWOW", character = { name = "Lebowski Holyroller", class = "PALADIN", level = 14 }, epgp = {} }');
    const fetcher = vi.fn(async (url: unknown) => String(url).endsWith("/api/v1/device/uploads")
      ? Response.json({ status: "synced", server: { discordId: "1", name: "Quebec Gold" }, guild: { name: "Quebec Gold", realm: "CAMWOW" }, characters: 1 })
      : Response.json({ error: "unexpected" }, { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    const engine = createEngine(device(file));
    try {
      expect(await engine.start()).toBe(true);
      await vi.waitFor(() => expect(engine.state().device?.status).toBe("synced"));
      const calls = fetcher.mock.calls as unknown as [unknown, { headers: Record<string, string>; body: string }][];
      // No standings, no addon-imports: only the device upload.
      expect(calls.every(([url]) => String(url).endsWith("/api/v1/device/uploads"))).toBe(true);
      expect(calls[0]![1].headers["x-companion-device"]).toBe(KEY);
      expect(calls[0]![1].headers["x-companion-credential"]).toBeUndefined();
      expect(JSON.parse(calls[0]![1].body)).toMatchObject({ guild: { name: "Quebec Gold", realm: "CAMWOW" }, characters: [{ name: "Lebowski Holyroller", level: 14 }] });
      expect(engine.state().syncPhase).toBe("synced");
    } finally { await engine.stop(); }
  });

  it("shows 'Syncing to <server> (from your guild <guild>)' with an optional sign-in", () => {
    const config = { ...device(), companionCredential: "", deviceSecret: "set" };
    expect(companionOverview(config, {})).toMatchObject({ device: true, canSync: true });
    const card = statusCard({ config, state: { running: true, device: { status: "synced", server: "Quebec Gold", guild: { name: "Quebec Gold" } } } });
    expect(card).toMatchObject({ id: "synced", tone: "ok", title: ["Syncing to {0} (from your guild {1}).", "Quebec Gold", "Quebec Gold"], button: { action: "sign-in" } });
    expect(statusCard({ config, state: { running: true, device: { status: "no-guild", guild: { name: "Quebec Gold" } } } }).id).toBe("guild-not-set-up");
    expect(statusCard({ config, state: { running: true, device: { status: "choose", guild: { name: "Quebec Gold" } } } }).button?.action).toBe("choose-server");
    // Without a device key the sign-in card stays first.
    expect(statusCard({ config: { ...config, deviceSecret: "" }, state: {} }).id).toBe("not-signed-in");
  });
});

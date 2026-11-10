import { describe, expect, it } from "vitest";
import { claimDevice, DEVICE_LIMITS, deviceFor, handleDeviceUpload, looseKey, pickServer, prismaInstallStore, registerDevice, windowLimiter, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";
import { hashCompanionSecret } from "../src/services/character-pairing.js";

// Zero-setup companion (docs/ZERO_SETUP_COMPANION.md): device keys, server by in-game guild, reported data only.

function memoryStore(candidates: Record<string, ServerCandidate[]> = {}) {
  const devices = new Map<string, DeviceRow & { tokenHash: string; wowGuildKey?: string }>();
  const characters = new Map<string, Map<string, Record<string, unknown>>>();
  let next = 0;
  const store: DeviceStore = {
    async create(tokenHash) { const id = `d${++next}`; devices.set(id, { id, tokenHash, guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 }); return { id }; },
    async find(tokenHash) { return [...devices.values()].find((row) => row.tokenHash === tokenHash) ?? null; },
    async candidates(nameKey, realmKey) { return candidates[`${nameKey}|${realmKey}`] ?? []; },
    async characterKeys(deviceId) { return [...(characters.get(deviceId)?.keys() ?? [])]; },
    async saveUpload(deviceId, data, rows) {
      const device = devices.get(deviceId)!;
      Object.assign(device, { guildId: data.guildId, chosenGuildId: data.chosenGuildId, uploads: device.uploads + 1, ...(data.wowGuild ? { wowGuildKey: data.wowGuild.key } : {}) });
      const map = characters.get(deviceId) ?? new Map();
      for (const row of rows) map.set(row.nameKey, { ...map.get(row.nameKey), ...row });
      characters.set(deviceId, map);
    },
    async claim(deviceId, memberId) {
      const device = devices.get(deviceId);
      if (!device || device.revokedAt || (device.claimedMemberId && device.claimedMemberId !== memberId)) return false;
      device.claimedMemberId = memberId;
      return true;
    }
  };
  return { store, devices, characters };
}

const quebec: ServerCandidate = { guildId: "g-qg", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true };
const copycat: ServerCandidate = { guildId: "g-copy", discordId: "222222222", serverName: "Copycat", officerLinked: false };
const upload = (extra: Record<string, unknown> = {}) => ({
  guild: { name: "Quebec Gold", realm: "CAMWOW US2 Realm 2 PvP" },
  characters: [{ name: "Lebowski Holyroller", class: "PALADIN", level: 14, race: "Human" }],
  ...extra
});

describe("device registration", () => {
  it("hands the key out once and keeps only its hash", async () => {
    const { store, devices } = memoryStore();
    const { deviceSecret, deviceId } = await registerDevice(store);
    expect(deviceSecret.length).toBeGreaterThanOrEqual(40);
    expect(devices.get(deviceId)!.tokenHash).toBe(hashCompanionSecret(deviceSecret));
    expect(JSON.stringify([...devices.values()])).not.toContain(deviceSecret);
    expect((await deviceFor(store, deviceSecret))?.id).toBe(deviceId);
  });

  it("refuses short, unknown and revoked keys", async () => {
    const { store, devices } = memoryStore();
    const { deviceSecret, deviceId } = await registerDevice(store);
    expect(await deviceFor(store, "short")).toBeNull();
    expect(await deviceFor(store, "x".repeat(43))).toBeNull();
    expect(await deviceFor(store, undefined)).toBeNull();
    devices.get(deviceId)!.revokedAt = new Date();
    expect(await deviceFor(store, deviceSecret)).toBeNull();
  });
});

describe("guild names across servers, realms and spellings (9 Nov 2026 live bug)", () => {
  it("reduces names to letters and digits", () => {
    expect(looseKey("Québec Gold")).toBe("quebecgold");
    expect(looseKey("✤Quebec Gold✤")).toBe("quebecgold");
    expect(looseKey("CAMWOW US2 Realm 8 PvP")).toBe("camwowus2realm8pvp");
  });

  function fakeDatabase() {
    return {
      wowGuild: { findMany: async () => [] },
      guild: { findMany: async () => [
        { id: "g-qg", discordId: "1323321076478119967", name: "✤Quebec Gold✤", officerSyncAt: new Date() },
        { id: "g-other", discordId: "999999999", name: "Vanguard", officerSyncAt: null }
      ] },
      character: { findMany: async () => [] }
    };
  }

  it("finds the server of Québec Gold for a character on Realm 8 while the guild's home is Realm 2", async () => {
    const store = prismaInstallStore(fakeDatabase() as never, () => null);
    const found = await store.candidates("québec gold", "camwow us2 realm 8 pvp", ["blunt cruising"]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ guildId: "g-qg", discordId: "1323321076478119967", officerLinked: true });
  });

  it("matches registered in-game guilds on any realm and tells servers apart by realm, then roster", async () => {
    const space = (guildId: string, discordId: string, realm: string) => ({ name: "Québec Gold", realm, guildId, scopeGuildId: null, guild: { discordId, officerSyncAt: null }, scope: null });
    const database = { ...fakeDatabase(), wowGuild: { findMany: async () => [space("a", "1", "CAMWOW US2 Realm 2 PvP"), space("b", "2", "CAMWOW US2 Realm 8 PvP")] }, guild: { findMany: async () => [] } };
    const found = await prismaInstallStore(database as never, () => null).candidates("québec gold", "camwow us2 realm 8 pvp");
    expect(found.map((row) => [row.discordId, row.realmMatch])).toEqual([["1", false], ["2", true]]);
    expect(pickServer(found)).toMatchObject({ pick: { discordId: "2" } });
    expect(pickServer([{ ...found[0]!, rosterMatch: true }, found[1]!])).toMatchObject({ pick: { discordId: "1" } });
    expect(pickServer([{ ...found[0]! }, { ...found[1]!, realmMatch: false }])).toHaveProperty("choose");
  });

  it("syncs an unsigned Blunt Cruising upload to the server through the loosened name", async () => {
    const { store } = memoryStore();
    const base = prismaInstallStore(fakeDatabase() as never, () => "✤Quebec Gold✤");
    const device = (await deviceFor(store, (await registerDevice(store)).deviceSecret))!;
    const answer = await handleDeviceUpload({ ...store, candidates: base.candidates }, device, {
      guild: { name: "Québec Gold", realm: "CAMWOW US2 Realm 8 PvP" },
      characters: [{ name: "Blunt Cruising", race: "Orc" }]
    });
    expect(answer).toMatchObject({ status: "synced", server: { discordId: "1323321076478119967", name: "✤Quebec Gold✤" }, guild: { name: "Québec Gold", realm: "CAMWOW US2 Realm 8 PvP" } });
  });
});

describe("server from the in-game guild", () => {
  it("picks the only server, prefers the officer-linked one, otherwise asks", () => {
    expect(pickServer([])).toEqual({ none: true });
    expect(pickServer([copycat])).toEqual({ pick: copycat });
    expect(pickServer([copycat, quebec])).toEqual({ pick: quebec });
    const other = { ...quebec, guildId: "g-other", discordId: "333333333", serverName: "Other" };
    expect(pickServer([quebec, other])).toEqual({ choose: [quebec, other] });
    expect(pickServer([quebec, other], "333333333")).toEqual({ pick: other });
    // A pick that is not a candidate is ignored.
    expect(pickServer([copycat, quebec], "999999999")).toEqual({ pick: quebec });
  });

  it("syncs to the server that set up the guild, and stores the characters as reported", async () => {
    const { store, characters } = memoryStore({ "quebec gold|camwow us2 realm 2 pvp": [quebec] });
    const { deviceSecret } = await registerDevice(store);
    const device = (await deviceFor(store, deviceSecret))!;
    const answer = await handleDeviceUpload(store, device, upload());
    expect(answer).toEqual({ status: "synced", server: { discordId: "111111111", name: "Quebec Gold" }, guild: { name: "Quebec Gold", realm: "CAMWOW US2 Realm 2 PvP" }, characters: 1, claimed: false });
    expect([...characters.get(device.id)!.values()][0]).toMatchObject({ name: "Lebowski Holyroller", className: "Paladin", level: 14 });
  });

  it("keeps the data pending when no server set up the guild yet", async () => {
    const { store, devices } = memoryStore();
    const device = (await deviceFor(store, (await registerDevice(store)).deviceSecret))!;
    expect(await handleDeviceUpload(store, device, upload())).toMatchObject({ status: "no-guild", guild: { name: "Quebec Gold" } });
    expect(devices.get(device.id)!.guildId).toBeNull();
    expect(await handleDeviceUpload(store, device, upload({ guild: null }))).toEqual({ status: "no-guild", guild: null });
  });

  it("asks when two unlinked servers registered the guild, then remembers the member's choice", async () => {
    const twin = { ...copycat, guildId: "g-twin", discordId: "444444444", serverName: "Twin" };
    const { store, devices } = memoryStore({ "quebec gold|camwow us2 realm 2 pvp": [copycat, twin] });
    const device = (await deviceFor(store, (await registerDevice(store)).deviceSecret))!;
    expect(await handleDeviceUpload(store, device, upload())).toMatchObject({ status: "choose", servers: [{ discordId: "222222222" }, { discordId: "444444444" }] });
    expect(await handleDeviceUpload(store, device, upload({ server: "444444444" }))).toMatchObject({ status: "synced", server: { name: "Twin" } });
    expect(devices.get(device.id)!.chosenGuildId).toBe("g-twin");
    expect(await handleDeviceUpload(store, { ...devices.get(device.id)! }, upload())).toMatchObject({ status: "synced", server: { name: "Twin" } });
  });

  it("leaves out servers that are not allowed (Guilded Lite)", async () => {
    const { store } = memoryStore({ "quebec gold|camwow us2 realm 2 pvp": [quebec] });
    const device = (await deviceFor(store, (await registerDevice(store)).deviceSecret))!;
    expect(await handleDeviceUpload(store, device, upload(), { allows: () => false })).toMatchObject({ status: "no-guild" });
  });
});

describe("abuse limits", () => {
  it("caps the characters one device may report", async () => {
    const { store, characters } = memoryStore({ "quebec gold|camwow us2 realm 2 pvp": [quebec] });
    const device = (await deviceFor(store, (await registerDevice(store)).deviceSecret))!;
    const many = (from: number) => Array.from({ length: DEVICE_LIMITS.charactersPerUpload }, (_, i) => ({ name: `Alt Number${from + i}` }));
    await handleDeviceUpload(store, device, upload({ characters: many(0) }));
    await handleDeviceUpload(store, device, upload({ characters: many(100) }));
    expect(characters.get(device.id)!.size).toBe(DEVICE_LIMITS.charactersPerDevice);
    // Known characters still update after the cap.
    await handleDeviceUpload(store, device, upload({ characters: [{ name: "Alt Number0", level: 30 }] }));
    expect(characters.get(device.id)!.get("alt number0")).toMatchObject({ level: 30 });
  });

  it("refuses too many characters at once, other editions and bad names", async () => {
    const { store } = memoryStore();
    const device = (await deviceFor(store, (await registerDevice(store)).deviceSecret))!;
    const tooMany = Array.from({ length: DEVICE_LIMITS.charactersPerUpload + 1 }, (_, i) => ({ name: `Alt ${i}` }));
    await expect(handleDeviceUpload(store, device, upload({ characters: tooMany }))).rejects.toMatchObject({ status: 400 });
    await expect(handleDeviceUpload(store, device, upload({ characters: [{ name: "Ann", gameEdition: "retail" }] }))).rejects.toMatchObject({ status: 400 });
    await expect(handleDeviceUpload(store, device, upload({ characters: [{ name: "Bad|Name" }] }))).rejects.toMatchObject({ status: 400 });
  });

  it("ignores unknown fields: an unsigned upload carries no ledger, loot, ranks or runs", async () => {
    const { store, characters } = memoryStore({ "quebec gold|camwow us2 realm 2 pvp": [quebec] });
    const device = (await deviceFor(store, (await registerDevice(store)).deviceSecret))!;
    await handleDeviceUpload(store, device, upload({ epgpTransactions: [{ amount: 9999 }], loot: [{}], guildRoster: [{ rank: "GM" }], runs: [{}] }));
    const stored = [...characters.get(device.id)!.values()][0]!;
    expect(Object.keys(stored).sort()).toEqual(["className", "gameEdition", "level", "name", "nameKey", "race", "realm"]);
  });

  it("counts per key within the hour", () => {
    const allow = windowLimiter(2, 3_600_000);
    expect(allow("ip", 0)).toBe(true);
    expect(allow("ip", 1)).toBe(true);
    expect(allow("ip", 2)).toBe(false);
    expect(allow("other", 2)).toBe(true);
    expect(allow("ip", 3_600_001)).toBe(true);
  });
});

describe("claim after a Discord sign-in", () => {
  it("makes the device the member's and stops its unsigned uploads", async () => {
    const { store } = memoryStore({ "quebec gold|camwow us2 realm 2 pvp": [quebec] });
    const secret = (await registerDevice(store)).deviceSecret;
    const device = (await deviceFor(store, secret))!;
    expect(await claimDevice(store, device, "member-1")).toBe(true);
    const claimed = (await deviceFor(store, secret))!;
    expect(claimed.claimedMemberId).toBe("member-1");
    // Its next upload is told to use the member credential (the normal path confirms the characters).
    expect(await handleDeviceUpload(store, claimed, upload())).toEqual({ status: "claimed" });
    expect(await claimDevice(store, claimed, "member-1")).toBe(true);
  });

  it("never lets a second account take a claimed device", async () => {
    const { store } = memoryStore();
    const secret = (await registerDevice(store)).deviceSecret;
    await claimDevice(store, (await deviceFor(store, secret))!, "member-1");
    expect(await claimDevice(store, (await deviceFor(store, secret))!, "member-2")).toBe(false);
    expect((await deviceFor(store, secret))!.claimedMemberId).toBe("member-1");
  });
});

describe("officers see what unsigned companions reported", () => {
  it("lists reported characters nobody linked, once each, in /roster gaps", async () => {
    const { reportedDeviceCharacters } = await import("../src/services/companion-device.js");
    const { formatRosterGaps } = await import("../src/services/roster-gaps.js");
    const database = {
      deviceCharacter: { findMany: async () => [
        { nameKey: "lebowski highspirits", name: "Lebowski Highspirits", displayName: null, className: "Priest", level: 1, lastSeenAt: new Date() },
        { nameKey: "lebowski highspirits", name: "Lebowski Highspirits", displayName: null, className: "Priest", level: 1, lastSeenAt: new Date() },
        { nameKey: "lebowski holyroller", name: "Lebowski Holyroller", displayName: null, className: "Paladin", level: 14, lastSeenAt: new Date() }
      ] },
      character: { findMany: async () => [{ name: "Lebowski Holyroller", realm: "", gameEdition: "forever" }] }
    };
    const rows = await reportedDeviceCharacters(database as never, "g1");
    expect(rows.map((row) => row.name)).toEqual(["Lebowski Highspirits"]);
    const { text } = formatRosterGaps({ notInGuild: [], noLink: [], unclaimed: [], syncFresh: true, considered: 0, fromCompanions: [{ name: "Lebowski Highspirits", level: 1 }] }, "fr");
    expect(text).toContain("Signalés par un compagnon sans connexion Discord** (1)");
    expect(text).toContain("Lebowski Highspirits 1");
  });
});

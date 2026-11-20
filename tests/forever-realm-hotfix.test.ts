import { describe, expect, it } from "vitest";
import { deviceUploadBody, splitGuildKey } from "../companion/device-sync.mjs";
import { characterKey, normalizeExportIdentities } from "../companion/character-identity.mjs";
import { handleDeviceUpload, deviceFor, registerDevice, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";
import { serverKnowsWowGuild } from "../src/services/wow-guilds.js";
import { parsePlayerGuid } from "../src/services/guild-armory-id.js";
import { addonCharacterSchema, addonSnapshotSchema } from "../src/integrations/addon.js";

// WoW Forever 1.60.1 (20 Nov 2026) hides realm names and ids: an upload with an empty realm and a guild key "Guild-" must
// land on the same server, guild and characters as an upload made before the change (docs/FOREVER_REALM_HOTFIX_2026-11.md).
const OLD_REALM = "CAMWOW US2 Realm 2 PvP";
const qg: ServerCandidate = { guildId: "g-qg", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true };

function memoryStore() {
  const devices = new Map<string, DeviceRow & { tokenHash: string }>();
  const characters = new Map<string, Map<string, Record<string, unknown>>>();
  let next = 0;
  const store: DeviceStore = {
    async create(tokenHash) { const id = `d${++next}`; devices.set(id, { id, tokenHash, guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 }); return { id }; },
    async find(tokenHash) { return [...devices.values()].find((row) => row.tokenHash === tokenHash) ?? null; },
    // Like the real store: the guild name decides, the realm is only a hint.
    async candidates(nameKey) { return nameKey === "quebec gold" ? [qg] : []; },
    async characterKeys(deviceId) { return [...(characters.get(deviceId)?.keys() ?? [])]; },
    async saveUpload(deviceId, data, rows) {
      Object.assign(devices.get(deviceId)!, { guildId: data.guildId, chosenGuildId: data.chosenGuildId });
      const map = characters.get(deviceId) ?? new Map();
      for (const row of rows) map.set(row.nameKey, { ...map.get(row.nameKey), ...row });
      characters.set(deviceId, map);
    },
    async claim() { return true; }
  };
  return { store, characters };
}

async function uploadAs(savedFile: Record<string, unknown>) {
  const { store, characters } = memoryStore();
  const device = (await deviceFor(store, (await registerDevice(store)).deviceSecret))!;
  const body = deviceUploadBody(savedFile, {});
  const answer = await handleDeviceUpload(store, device, body);
  return { answer, body, characters: [...(characters.get(device.id)?.keys() ?? [])].sort() };
}

describe("an upload before and after the 1.60.1 realm change", () => {
  const saved = (guildKey: string, realm: string) => ({
    wowGuild: guildKey,
    character: { name: "Lebowski Holyroller", realm, class: "PALADIN", race: "Human", level: 14 },
    alts: [{ name: "Lebowski Highspirits", realm, class: "PRIEST", level: 3 }]
  });

  it("splits both guild keys into the same guild name", () => {
    expect(splitGuildKey(`Quebec Gold-${OLD_REALM}`)).toEqual({ name: "Quebec Gold", realm: OLD_REALM });
    expect(splitGuildKey("Quebec Gold-")).toEqual({ name: "Quebec Gold", realm: "" });
    expect(splitGuildKey("-Realm")).toBeNull();
    expect(splitGuildKey("NoDash")).toBeNull();
  });

  it("lands on the same server and characters", async () => {
    const before = await uploadAs(saved(`Quebec Gold-${OLD_REALM.replace(/\s+/g, "")}`, OLD_REALM));
    const after = await uploadAs(saved("Quebec Gold-", ""));
    expect(before.answer.status).toBe("synced");
    expect(after.answer.status).toBe("synced");
    expect((after.answer as { server: { discordId: string } }).server.discordId).toBe((before.answer as { server: { discordId: string } }).server.discordId);
    expect((after.answer as { guild: { name: string } }).guild.name).toBe((before.answer as { guild: { name: string } }).guild.name);
    expect(after.characters).toEqual(before.characters);
    expect(after.characters).toEqual(["lebowski highspirits", "lebowski holyroller"]);
  });

  it("derives the same character key whatever the realm", () => {
    expect(characterKey("Lebowski Holyroller", OLD_REALM)).toBe(characterKey("Lebowski Holyroller", ""));
  });

  it("keeps an empty realm on export rows", () => {
    expect(normalizeExportIdentities({ character: "Lebowski Holyroller", realm: "" }, "forever", "")).toMatchObject({ character: "Lebowski Holyroller", realm: "" });
  });

  it("the server recognises the guild with or without the realm part", async () => {
    const db = { wowGuild: { findMany: async () => [{ name: "Quebec Gold", realm: OLD_REALM }] } } as never;
    expect(await serverKnowsWowGuild(db, { id: "g", name: "Quebec Gold" }, "Quebec Gold-")).toMatchObject({ known: true });
    expect(await serverKnowsWowGuild(db, { id: "g", name: "Quebec Gold" }, `Quebec Gold-${OLD_REALM.replace(/\s+/g, "")}`)).toMatchObject({ known: true });
    expect(await serverKnowsWowGuild(db, { id: "g", name: "Quebec Gold" }, "Other Guild-")).toMatchObject({ known: false });
  });

  it("accepts characters and snapshots with an empty or missing realm", () => {
    expect(addonCharacterSchema.safeParse({ name: "Lebowski Holyroller", realm: "", class: "PALADIN", level: 14, gameEdition: "forever" }).success).toBe(true);
    expect(addonSnapshotSchema.safeParse({ source: "guilded-addon", exportedAt: "2026-11-21T00:00:00Z", wowGuild: "Quebec Gold-", character: { name: "Lebowski Holyroller", realm: "", class: "PALADIN", level: 14 } }).success).toBe(true);
  });

  it("reads the character id from a player GUID whatever the realm part", () => {
    expect(parsePlayerGuid("Player-4408-0A1B2C3D")?.characterId).toBe(0x0a1b2c3dn);
    expect(parsePlayerGuid("Player-0-0A1B2C3D")?.characterId).toBe(0x0a1b2c3dn);
    expect(parsePlayerGuid("Player--0A1B2C3D")?.characterId).toBe(0x0a1b2c3dn);
    expect(parsePlayerGuid("Creature-0-0-0-0-1-0A1B2C3D")).toBeNull();
  });
});

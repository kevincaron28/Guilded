import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readAddonExport } from "../companion/lua-export.mjs";
import { guildRankFields } from "../companion/lua-export-content.mjs";
import { addonCharacterSchema, parseAddonSnapshot } from "../src/integrations/addon.js";
import { guildRankLine, guildRankOf, guildRankUpdate } from "../src/services/guild-rank.js";
import { applyDiscoveredCharacters } from "../src/services/roster-discovery.js";

const base = { name: "Ray", realm: "Realm", class: "PRIEST" };

describe("guild rank on an upload", () => {
  it("is optional: an older addon's character still parses", () => {
    const parsed = addonCharacterSchema.parse(base);
    expect(parsed.guildRankName).toBeUndefined();
    expect(parsed.guildRankIndex).toBeUndefined();
  });
  it("accepts a rank name and index and rejects nonsense", () => {
    expect(addonCharacterSchema.parse({ ...base, guildRankName: "Officer", guildRankIndex: 1 })).toMatchObject({ guildRankName: "Officer", guildRankIndex: 1 });
    expect(addonCharacterSchema.safeParse({ ...base, guildRankName: "", guildRankIndex: 1 }).success).toBe(false);
    expect(addonCharacterSchema.safeParse({ ...base, guildRankName: "X", guildRankIndex: -1 }).success).toBe(false);
    expect(addonCharacterSchema.safeParse({ ...base, guildRankName: "X", guildRankIndex: 1.5 }).success).toBe(false);
  });
});

describe("companion export of the rank", () => {
  it("takes a complete rank from the first source that has one", () => {
    expect(guildRankFields({ rankName: " Officer ", rankIndex: 1 })).toEqual({ guildRankName: "Officer", guildRankIndex: 1 });
    expect(guildRankFields(undefined, { guildRankName: "Member", guildRankIndex: 4 })).toEqual({ guildRankName: "Member", guildRankIndex: 4 });
  });
  it("drops an incomplete or malformed rank", () => {
    expect(guildRankFields({ rankName: "Officer" })).toEqual({});
    expect(guildRankFields({ rankName: "Officer", rankIndex: 99 })).toEqual({});
    expect(guildRankFields(undefined, null)).toEqual({});
  });
  it("puts the roster rank on the exporter, alts and peers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qg-rank-"));
    try {
      const file = join(dir, "Guilded.lua");
      await writeFile(file, `GuildedDB = {
        guildKey = "Gold-Realm",
        character = { name = "Kev", class = "MAGE", level = 60, guildRankName = "Guild Master", guildRankIndex = 0 },
        myCharacters = { ["Kev"] = { name = "Kev", class = "MAGE", level = 60 }, ["Alt"] = { name = "Alt", class = "ROGUE", level = 20, guildRankName = "Member", guildRankIndex = 4 } },
        roster = { ["Kev"] = { rankName = "Guild Master", rankIndex = 0 }, ["Amy"] = { rankName = "Officer", rankIndex = 1 } },
        peerRoster = { ["Amy"] = { updatedAt = "2026-09-30T10:00:00Z", identity = { class = "MAGE" } }, ["Bob"] = { updatedAt = "2026-09-30T10:00:00Z", identity = { class = "ROGUE" } } },
      }`);
      const snapshot = parseAddonSnapshot(await readAddonExport(file, "Realm"));
      expect(snapshot.character).toMatchObject({ guildRankName: "Guild Master", guildRankIndex: 0 });
      expect(snapshot.alts.find((a) => a.name === "Kev")).toMatchObject({ guildRankName: "Guild Master", guildRankIndex: 0 });
      expect(snapshot.alts.find((a) => a.name === "Alt")).toMatchObject({ guildRankName: "Member", guildRankIndex: 4 });
      expect(snapshot.characters.find((c) => c.name === "Amy")).toMatchObject({ guildRankName: "Officer", guildRankIndex: 1 });
      expect(snapshot.characters.find((c) => c.name === "Bob")?.guildRankName).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("storing and reading the rank", () => {
  const at = new Date("2026-11-03T00:00:00Z");
  it("writes a rank only when the upload carries a whole one", () => {
    expect(guildRankUpdate({ guildRankName: "Officer", guildRankIndex: 1 }, at)).toEqual({ guildRankName: "Officer", guildRankIndex: 1, guildRankAt: at });
    expect(guildRankUpdate({}, at)).toEqual({});
    expect(guildRankUpdate({ guildRankName: "Officer" }, at)).toEqual({});
  });
  it("refreshes a linked character's rank but never stores it for unclaimed ones", async () => {
    const upserts: Record<string, unknown>[] = [];
    const client = {
      character: { update: vi.fn(async () => ({})), findUnique: vi.fn(async () => null) },
      professionSkill: { upsert: vi.fn(async () => ({})) },
      unclaimedCharacter: { findUnique: vi.fn(async () => null), upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => { upserts.push(create); return create; }) }
    };
    const entry = (name: string) => ({ name, realm: "Realm", class: "PRIEST", race: "Scourge", level: 6, spec: "", professions: [], guildRankName: "Officer", guildRankIndex: 1 });
    await applyDiscoveredCharacters(client as never, "g", [entry("Ray"), entry("Amy")], [{ id: "c1", name: "Ray", realm: "Realm" }]);
    expect(client.character.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ guildRankName: "Officer", guildRankIndex: 1 }) }));
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).not.toHaveProperty("guildRankName");
  });
  it("exposes the rank to cards and role logic", () => {
    expect(guildRankOf({ guildRankName: "Officer", guildRankIndex: 1 })).toEqual({ name: "Officer", index: 1 });
    expect(guildRankOf({ guildRankName: "Officer", guildRankIndex: null })).toBeNull();
    expect(guildRankOf(null)).toBeNull();
    expect(guildRankLine({ guildRankName: "Officer", guildRankIndex: 1 })).toBe("Officer");
    expect(guildRankLine({ guildRankName: "A very long rank name indeed", guildRankIndex: 2 }, 10)).toBe("A very lo…");
    expect(guildRankLine({})).toBeNull();
  });
});

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { withCardPictures } from "../src/services/card-pictures.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { achievementUnlockedCard } from "../src/services/end-cards.js";
import { circleImage, scoreCardPng, type ScoreCard } from "../src/services/score-card.js";

const red = () => sharp({ create: { width: 128, height: 128, channels: 3, background: { r: 230, g: 20, b: 20 } } }).webp().toBuffer();
const redPortrait = (await red()).toString("base64");

const run = (): DungeonImportResult => ({
  runRef: "T-1", dungeonName: "The Deadmines", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1200, points: 0, guildRecord: false, previousGuildBest: null,
  personalRecords: [], players: ["Kev-Forever", "Mel", "Pug"], deaths: 0, unlinked: ["Pug"], inGuildPlayers: ["Kev-Forever", "Mel"], achievements: [],
  fullNames: { "Kev-Forever": "Kev Caron", Mel: "Mélodie Gagnon", Pug: "Pug Healson" },
  playerDetails: [{ character: "Kev-Forever", class: "MAGE", role: "DAMAGER" }, { character: "Mel", class: "PRIEST", role: "HEALER" }, { character: "Pug", class: "DRUID", role: "TANK" }] as never
});

function fakeDb(rows: { characterId: string; name: string; displayName?: string | null; thumb: Buffer; discordUserId?: string }[], enabled = true) {
  return {
    guildSettings: { findUnique: vi.fn(async () => ({ characterPicturesEnabled: enabled })) },
    characterPicture: {
      findMany: vi.fn(async ({ where }: { where: { characterId?: { in: string[] } } }) => where.characterId
        ? rows.filter(row => where.characterId!.in.includes(row.characterId)).map(row => ({ characterId: row.characterId, thumb: row.thumb }))
        : rows.map(row => ({ characterId: row.characterId, character: { name: row.name, displayName: row.displayName ?? null } }))),
      findFirst: vi.fn(async ({ where }: { where: { character: { member: { discordUserId: string } } } }) => rows.find(row => row.discordUserId === where.character.member.discordUserId) ?? null)
    }
  };
}

describe("character pictures added to cards at delivery", () => {
  it("gives guild party members their picture by character name, never outsiders, and stores nothing in the definition", async () => {
    const thumb = await red();
    const card = dungeonRunCard(run(), "en");
    expect(card.dungeon!.party.map(member => member.character)).toEqual(["Kev-Forever", "Mel", undefined]);
    expect(JSON.stringify(card)).not.toContain("portrait");
    const db = fakeDb([{ characterId: "c1", name: "Kev", displayName: "Kev Caron", thumb }, { characterId: "c3", name: "Pug", thumb }]);
    const drawn = await withCardPictures(db as never, "g1", card);
    expect(drawn.dungeon!.party.map(member => Boolean(member.portrait))).toEqual([true, false, false]);
    expect(drawn.dungeon!.party[0]!.portrait).toBe(thumb.toString("base64"));
    expect(card.dungeon!.party[0]!.portrait).toBeUndefined();
    // Only the matched characters' thumbs are read.
    expect(db.characterPicture.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { characterId: { in: ["c1"] }, status: "ok" } }));
  });

  it("shows nothing when two characters share the name, the server switch is off, or the lookup fails", async () => {
    const thumb = await red(), card = dungeonRunCard(run(), "en");
    const twins = fakeDb([{ characterId: "c1", name: "Mel", thumb }, { characterId: "c2", name: "Mel", thumb }]);
    expect((await withCardPictures(twins as never, "g1", card)).dungeon!.party.some(member => member.portrait)).toBe(false);
    const off = fakeDb([{ characterId: "c1", name: "Kev", thumb }], false);
    expect(await withCardPictures(off as never, "g1", card)).toBe(card);
    expect(off.characterPicture.findMany).not.toHaveBeenCalled();
    const broken = { guildSettings: { findUnique: async () => { throw new Error("db down"); } } };
    expect(await withCardPictures(broken as never, "g1", card)).toBe(card);
  });

  it("uses the member's character picture as the achievement card's portrait, ahead of the Discord avatar", async () => {
    const thumb = await red();
    const card: ScoreCard = { ...achievementUnlockedCard("Kev", [ACTIVE_ACHIEVEMENTS[0]!.id], 3, "en"), portrait: Buffer.from("discord-avatar").toString("base64") };
    const db = fakeDb([{ characterId: "c1", name: "Kev", thumb, discordUserId: "123456789012345678" }]);
    expect((await withCardPictures(db as never, "g1", card, "123456789012345678")).portrait).toBe(thumb.toString("base64"));
    // No picture: the Discord avatar stays.
    expect((await withCardPictures(db as never, "g1", card, "999999999999999999")).portrait).toBe(card.portrait);
    // Leaderboards and other multi-member cards are left alone.
    expect(await withCardPictures(db as never, "g1", { ...card, ladder: { columns: [], boards: [] } }, "123456789012345678")).toEqual({ ...card, ladder: { columns: [], boards: [] } });
  });

  it("a pictured party member never breaks the card (the redesigned card draws roles, not thumbnails), and a broken image is ignored", async () => {
    expect(await circleImage(Buffer.from("not an image").toString("base64"), 30)).toBeNull();
    const plain = dungeonRunCard(run(), "en");
    const pictured: ScoreCard = { ...plain, dungeon: { ...plain.dungeon!, party: plain.dungeon!.party.map((member, i) => i === 0 ? { ...member, portrait: redPortrait } : member) } };
    expect(await scoreCardPng(pictured)).toBeInstanceOf(Buffer);
    expect(await scoreCardPng(plain)).toBeInstanceOf(Buffer);
    const broken: ScoreCard = { ...plain, dungeon: { ...plain.dungeon!, party: plain.dungeon!.party.map((member, i) => i === 0 ? { ...member, portrait: "!!!" } : member) } };
    expect(await scoreCardPng(broken)).toBeInstanceOf(Buffer);
  }, 60_000);
});

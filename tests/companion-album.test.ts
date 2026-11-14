import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { albumCards, albumFor } from "../src/services/companion-album.js";

// Phone badge album (APP_TCG option 1): the member's own stored badges as cards.
const firstId = ACHIEVEMENTS.find(def => !def.legacy && def.game !== "poe2")!.id;

function fakeDb(rows: { id: string; guildId: string; discordId: string }[], earned: { memberId: string; key: string; earnedAt: Date }[], off: string[] = []) {
  return {
    member: { findMany: async () => rows.map(row => ({ id: row.id, guildId: row.guildId, guild: { discordId: row.discordId } })) },
    guildSettings: { findMany: async () => off.map(guildId => ({ guildId })) },
    memberAchievement: { findMany: async ({ where }: { where: { memberId?: { in: string[] } } }) => earned.filter(row => where.memberId?.in.includes(row.memberId)).map(row => ({ key: row.key, earnedAt: row.earnedAt })) }
  } as never;
}

describe("phone badge album", () => {
  it("lists the catalogue with dates on earned cards and nothing on locked ones", () => {
    const cards = albumCards(new Map([[firstId, new Date("2026-11-05T10:00:00Z")]]), "en");
    // 9.3: every card names its painted emblem (the family's), which the app layers over the tier frame.
    expect(cards.every(card => typeof card.emblem === "string" && /^[a-z0-9-]+$/.test(card.emblem))).toBe(true);
    expect(cards.length).toBeGreaterThan(20);
    expect(cards.find(card => card.id === firstId)?.earnedAt).toBe("2026-11-05T10:00:00.000Z");
    expect(cards.filter(card => card.earnedAt)).toHaveLength(1);
    expect(cards.every(card => card.name && card.description && /^#/.test(card.tierColor))).toBe(true);
  });

  it("speaks French and hides legacy rows until earned", () => {
    const legacy = ACHIEVEMENTS.find(def => def.legacy);
    const fr = albumCards(new Map(), "fr");
    expect(fr.find(card => card.id === firstId)?.name).toBe(ACHIEVEMENTS.find(def => def.id === firstId)!.fr.name);
    if (legacy) {
      expect(fr.some(card => card.id === legacy.id)).toBe(false);
      expect(albumCards(new Map([[legacy.id, new Date()]]), "en").some(card => card.id === legacy.id)).toBe(true);
    }
  });

  it("merges the account's servers with the earliest date, and skips unserved or switched-off servers", async () => {
    const early = new Date("2026-11-01T00:00:00Z"), late = new Date("2026-11-06T00:00:00Z");
    const db = fakeDb(
      [{ id: "m1", guildId: "g1", discordId: "d1" }, { id: "m2", guildId: "g2", discordId: "d2" }, { id: "m3", guildId: "g3", discordId: "d3" }, { id: "m4", guildId: "g4", discordId: "d4" }],
      [{ memberId: "m1", key: firstId, earnedAt: late }, { memberId: "m2", key: firstId, earnedAt: early }, { memberId: "m3", key: ACHIEVEMENTS[1]!.id, earnedAt: early }, { memberId: "m4", key: ACHIEVEMENTS[2]!.id, earnedAt: early }],
      ["g3"]
    );
    const album = await albumFor(db, "user", "en", id => id !== "d4");
    expect(album.cards.find(card => card.id === firstId)?.earnedAt).toBe(early.toISOString());
    expect(album.earned).toBe(1);
    expect(album.total).toBe(album.cards.length);
  });

  it("returns an all-locked album for someone with no served membership", async () => {
    const album = await albumFor(fakeDb([], []), "user", "en", () => true);
    expect(album.earned).toBe(0);
    expect(album.total).toBeGreaterThan(20);
  });
});

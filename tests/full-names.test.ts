import { describe, expect, it } from "vitest";
import { displayCharacterName, emptyNameBook, fullNameBook, loadFullNameBook } from "../src/services/character-display.js";
import { duelBoardEmbed, withFullNames, type DuelBoardData } from "../src/services/duel-board.js";
import { loadBgLadderData } from "../src/services/bg-ladder.js";
import { loadProfessionPosts } from "../src/services/profession-board.js";
import { loadGallery } from "../src/services/artisans-gallery.js";
import { loadWhoData } from "../src/services/whos-who-board.js";
import { loadPromotionPlan } from "../src/services/promotion.js";

// 9.0: full Forever "First Last" names wherever the guild knows one (owner decision, 6 November 2026).
const book = fullNameBook([
  { name: "Halidor", displayName: "Halidor Galemorne" },     // a linked first-name row that knows its full name
  { name: "Mira", displayName: null }, { name: "Mira Dawn", displayName: null }, // an unlinked/roster guildmate in full
  { name: "Sam Stone", displayName: null }, { name: "Sam Smith", displayName: null }, // two Sams: ambiguous
]);

describe("displayCharacterName", () => {
  it("shows the full name from the display name, the book, or the stored full name", () => {
    expect(displayCharacterName({ name: "Halidor", displayName: "Halidor Galemorne" })).toBe("Halidor Galemorne");
    expect(displayCharacterName("Halidor", book)).toBe("Halidor Galemorne");
    expect(displayCharacterName("mira", book)).toBe("Mira Dawn");
    expect(displayCharacterName({ name: "Mira Dawn", displayName: null }, book)).toBe("Mira Dawn");
  });
  it("never guesses: ambiguous first names, unknown names and other editions stay as stored", () => {
    expect(displayCharacterName("Sam", book)).toBe("Sam");
    expect(displayCharacterName("Zed", book)).toBe("Zed");
    expect(displayCharacterName("Zed", null)).toBe("Zed");
    expect(displayCharacterName("Zed-Realm", book)).toBe("Zed-Realm");
    expect(displayCharacterName({ name: "Kev", displayName: "Kevin" }, emptyNameBook)).toBe("Kevin"); // keeps the old display-name behaviour
    expect(displayCharacterName({ name: "Kev", displayName: "Someone Else" })).toBe("Someone Else");
  });
  it("loads a guild's book from the bot's tables and survives a failed read", async () => {
    const db = { character: { findMany: async () => [{ name: "Halidor", displayName: "Halidor Galemorne" }] },
      unclaimedCharacter: { findMany: async () => [{ name: "Mira Dawn", displayName: null }] }, guildRosterEntry: { findMany: async () => [{ name: "Tess Vale" }] } };
    const loaded = await loadFullNameBook(db as never, "g1");
    expect([loaded.fullFor("Halidor"), loaded.fullFor("Mira"), loaded.fullFor("Tess")]).toEqual(["Halidor Galemorne", "Mira Dawn", "Tess Vale"]);
    expect((await loadFullNameBook({ character: { findMany: async () => { throw new Error("db"); } } } as never, "g1")).fullFor("Halidor")).toBeUndefined();
  });
});

describe("surfaces", () => {
  it("duel ladder: standings and recent duels use full names", () => {
    const data: DuelBoardData = { duels: 1, edition: "forever", standings: [{ memberId: "m1", name: "Halidor", wins: 1, losses: 0, games: 1, winRate: 1, streak: 1, bestStreak: 1 }],
      recent: [{ winner: "Halidor", loser: "Mira", endedAt: new Date(), reason: "win" }] };
    const text = JSON.stringify(duelBoardEmbed(withFullNames(data, book), "en").toJSON());
    expect(text).toContain("Halidor Galemorne");
    expect(text).toContain("Mira Dawn");
  });
  it("battleground ladder: a member shows as their main character in full, else their Discord name", async () => {
    const db = { battlegroundReport: { groupBy: async () => [
      { memberId: "m1", mode: "WSG", bracket: "10-19", outcome: "win", _count: { _all: 2 } }, { memberId: "m2", mode: "WSG", bracket: "10-19", outcome: "win", _count: { _all: 1 } }] },
      member: { findMany: async () => [{ id: "m1", displayName: "Kev#1", characters: [{ name: "Halidor", displayName: "Halidor Galemorne" }] }, { id: "m2", displayName: "Lone Discord", characters: [] }] } };
    const data = await loadBgLadderData(db as never, "g1", "forever", new Date("2026-11-10T00:00:00Z"));
    expect(data.brackets[0]!.standings.map(row => row.name)).toEqual(["Halidor Galemorne", "Lone Discord"]);
  });
  it("profession posts: crafters appear by full name", async () => {
    const db = {
      professionSkill: { findMany: async () => [{ profession: "Alchemy", skillLevel: 300, character: { name: "Halidor", lastSeenAt: null } }] },
      recipeKnown: { findMany: async () => [{ character: "Halidor", profession: "Alchemy", itemKey: 1, itemName: "Elixir", scannedAt: new Date() }, { character: "Mira", profession: "Alchemy", itemKey: 1, itemName: "Elixir", scannedAt: new Date() }] }
    };
    const posts = await loadProfessionPosts(db as never, "g1", book);
    expect(posts[0]!.skilled[0]!.character).toBe("Halidor Galemorne");
    expect(posts[0]!.recipes[0]!.crafters.map(c => c.character).sort()).toEqual(["Halidor Galemorne", "Mira Dawn"]);
    expect((await loadProfessionPosts(db as never, "g1"))[0]!.skilled[0]!.character).toBe("Halidor");
  });
  it("gallery: crafters and crafter cards use full names without an extra query", async () => {
    const db = {
      character: { findMany: async () => [{ name: "Halidor", lastSeenAt: null, displayName: "Halidor Galemorne", member: { displayName: "Kev" } }] },
      professionSkill: { findMany: async () => [{ profession: "Alchemy", skillLevel: 300, character: { name: "Halidor" } }] },
      recipeKnown: { findMany: async () => [{ character: "Halidor", profession: "Alchemy", itemKey: 1, itemName: "Elixir", scannedAt: new Date() }] },
      professionCooldown: { findMany: async () => [] }, craftOffer: { findMany: async () => [] }
    };
    const data = await loadGallery(db as never, "g1", "elixir");
    expect(data.recipes[0]!.crafters[0]!.character).toBe("Halidor Galemorne");
    expect(data.crafters[0]!.character).toBe("Halidor Galemorne");
  });
  it("Who's who: a first-name row is shown in full when another source knows it", async () => {
    const db = { member: { findMany: async () => [
      { displayName: "Kev", characters: [{ name: "Halidor", displayName: null, isMain: true }] },
      { displayName: "Mia", characters: [{ name: "Mira Dawn", displayName: null, isMain: true }, { name: "Halidor Galemorne", displayName: null, isMain: false }] }] } };
    const data = await loadWhoData(db as never, "g1", "forever");
    expect(data.people.find(p => p.displayName === "Kev")!.main).toBe("Halidor Galemorne");
  });
  it("promotion lists: ready members and unclaimed characters are named in full", async () => {
    const now = new Date("2026-11-20T12:00:00Z"), days = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const db = {
      guildSettings: { findUnique: async () => null }, character: { findMany: async () => [] }, characterRankSeen: { upsert: async () => ({}) },
      member: { findMany: async () => [{ discordUserId: "u1", displayName: "Kev", characters: [{ name: "Halidor", realm: "R", displayName: null, level: 20, guildRankName: "Initiate", guildRankAt: days(1), isMain: true, rankSeen: { since: days(9) } }] }] },
      unclaimedCharacter: { findMany: async () => [{ name: "Halidor Galemorne", displayName: null, level: 20, guildRankName: null, guildRankAt: null }] }
    };
    const discord = { id: "d1", memberCount: 1, members: { cache: new Map([["u1", {}]]), fetch: async () => undefined } };
    const { plan } = await loadPromotionPlan(db as never, discord as never, "g1", "forever", now);
    expect(plan.ready[0]!.character).toBe("Halidor Galemorne");
  });
});

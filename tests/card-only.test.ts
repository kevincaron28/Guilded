import { describe, expect, it } from "vitest";
import { cardAltText } from "../src/services/card-alt.js";
import { messageForDelivery, textlessEmbed } from "../src/services/card-only.js";
import { duelBoardEmbed } from "../src/services/duel-board.js";
import { dungeonCardOnly, dungeonPosts } from "../src/services/dungeon-announce.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";

const run = (overrides: Partial<DungeonImportResult> = {}): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Deadmines", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1300, points: 0,
  guildRecord: false, previousGuildBest: null, personalRecords: [], players: ["Kev", "Bob"], deaths: 0, unlinked: [], achievements: [], ...overrides
});
const summary = (...results: DungeonImportResult[]) => ({ results, duplicates: 0, malformed: 0 });

describe("messageForDelivery", () => {
  const full = { content: "full text", embeds: [{ title: "Title", description: "Long text" }], components: [] as never[] };
  it("sends the stored message unchanged when the card did not draw, or the post has no card-only form", () => {
    expect(messageForDelivery(full, { embeds: [textlessEmbed(1)] }, false)).toBe(full);
    expect(messageForDelivery(full, undefined, true)).toBe(full);
    expect(messageForDelivery(full, { embeds: [] }, true)).toBe(full);
    expect(messageForDelivery(full, "junk", true)).toBe(full);
  });
  it("sends the reduced message when the card drew, keeping buttons and dropping the old text line", () => {
    const sent = messageForDelivery(full, { embeds: [textlessEmbed(0xd4a017)] }, true);
    expect(sent.content).toBeUndefined();
    expect(sent.embeds).toEqual([{ color: 0xd4a017 }]);
    expect(sent.components).toBe(full.components);
    expect(messageForDelivery(full, { content: "🎉 Bravo <@1>", embeds: [textlessEmbed()] }, true).content).toBe("🎉 Bravo <@1>");
  });
});

describe("dungeon run post, card only", () => {
  it("keeps nothing but the picture for a plain run (the card shows time, boss, deaths, party)", () => {
    const only = dungeonCardOnly(run({ durationSec: 900, deaths: 2 }), "en");
    expect(only.embed.toJSON().description).toBeUndefined();
    expect(only.embed.toJSON().title).toBeUndefined();
    expect(only.content).toBeUndefined();
    // The full post is still built for the text fallback.
    expect(dungeonPosts(summary(run()), "en")[0]!.embed.toJSON().description).toContain("Kev");
  });
  it("keeps what the card cannot show: achievements, personal records and points", () => {
    const only = dungeonCardOnly(run({ points: 12, personalRecords: [{ character: "Kev" } as never], achievements: [{ key: "first-dungeon", character: "Kev" } as never] }), "en");
    const text = only.embed.toJSON().description ?? "";
    expect(text).toContain("12");
    expect(text).toContain("Kev");
    expect(text).not.toContain("Deadmines ·"); // no title/time line
  });
});

describe("alt text", () => {
  it("describes a card in under 1,000 characters, and never throws", () => {
    const card = dungeonRunCard(run(), "en");
    const alt = cardAltText(card);
    expect(alt).toContain("Deadmines");
    expect(alt.length).toBeLessThanOrEqual(1000);
    expect(cardAltText({ title: "x".repeat(3000), subtitle: "", stats: [], footer: "" }).length).toBeLessThanOrEqual(1000);
    expect(cardAltText(null as never)).toBe("");
  });
});

describe("boards", () => {
  it("drops the duel board's top-3 text under the picture, and keeps it without one", () => {
    const data = { standings: [{ memberId: "m", name: "Kev", score: 30, wins: 3, losses: 0, winRate: 1, bestStreak: 3, streak: 3 }], duels: 3, recent: [], edition: "forever" } as never;
    expect(duelBoardEmbed(data, "en", "duel.png").toJSON().description).toBeUndefined();
    expect(duelBoardEmbed(data, "en").toJSON().description).toContain("Kev");
    expect(duelBoardEmbed(data, "en", "duel.png").toJSON().title).toContain("Guild duels");
  });
});

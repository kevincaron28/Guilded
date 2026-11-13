import { describe, expect, it } from "vitest";
import { cardAltText, cardAttachment } from "../src/services/card-alt.js";
import { messageForDelivery, textlessEmbed } from "../src/services/card-only.js";
import { duelBoardEmbed } from "../src/services/duel-board.js";
import { dungeonCardOnly, dungeonPosts } from "../src/services/dungeon-announce.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import { scoreCardPng } from "../src/services/score-card.js";

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

describe("what the run card cannot say stays as text", () => {
  const detail = (character: string, unrankedReason?: string) => ({ character, class: "MAGE", role: "DAMAGER", deaths: 0, presentSec: 1100, points: 0, ...(unrankedReason ? { unrankedReason } : {}) });
  it("keeps every distinct unranked reason and the count (the card shows one, cut short)", () => {
    const only = dungeonCardOnly(run({ players: ["Kev", "Bob", "Amy"], playerDetails: [detail("Kev", "Automatic final-boss completion required"), detail("Bob", "Below level range"), detail("Amy")] as never }), "en");
    expect(only.embed.toJSON().description).toBe("Unranked ×2: Automatic final-boss completion required · Below level range");
    expect(dungeonCardOnly(run({ players: ["Kev", "Bob"], playerDetails: [detail("Kev", "Different difficulty"), detail("Bob")] as never }), "fr").embed.toJSON().description).toBe("Non classé ×1: Difficulté différente");
  });
  it("keeps the outsiders only when the party is too long for the card's rows", () => {
    const players = ["Kev", "Bob", "Amy", "Zed", "Pug1", "Pug2"];
    const long = dungeonCardOnly(run({ players, unlinked: ["Pug1", "Pug2"], inGuildPlayers: ["Kev", "Bob", "Amy", "Zed"], playerDetails: players.map(name => detail(name)) as never }), "en");
    expect(long.embed.toJSON().description).toContain("Outside the guild (2): Pug1");
    const short = dungeonCardOnly(run({ players: ["Kev", "Pug1"], unlinked: ["Pug1"], inGuildPlayers: ["Kev"], playerDetails: ["Kev", "Pug1"].map(name => detail(name)) as never }), "en");
    expect(short.embed.toJSON().description).toBeUndefined();
  });
});

describe("attachments", () => {
  it("carry the alt text of the card they were drawn from", async () => {
    const card = dungeonRunCard(run(), "en");
    const png = (await scoreCardPng(card))!;
    expect(cardAttachment(png, "card.png").description).toBe(cardAltText(card));
    expect(cardAttachment(Buffer.from("not drawn here"), "x.png").description).toBeNull();
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

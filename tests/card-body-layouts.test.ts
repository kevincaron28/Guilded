import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assertCardRules } from "../src/services/card-kit.js";
import { plainArt, renderBarsCard, renderBodyCard, wrapLines, type BodyCardSpec } from "../src/services/card-layouts-recap.js";
import { dailyRecapCard, type DailyRecap } from "../src/services/daily-recap.js";
import { raidNightCard, type RaidNightCheck } from "../src/services/raid-night-check.js";
import { buildRosterVisual, rosterVisualCard } from "../src/services/roster-visual.js";
import { serverAnniversaryCard, achievementsCard } from "../src/services/end-cards.js";
import { serverStatsCard } from "../src/services/stats-card.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";

// 16 Nov 2026: the daily recap, raid-night check, roster, server stats, anniversary, record, achievement and empty-board cards all use the banner
// layouts of card-layouts-recap.ts (nothing under 24 px, upright text, sized to their content). The old framed layout is gone.

const dims = async (png: Buffer | null) => { const meta = await sharp(png!).metadata(); return { width: meta.width!, height: meta.height! }; };
const row = (name: string, sub?: string, right?: string) => ({ name, ...(sub ? { sub } : {}), ...(right ? { right } : {}) });
const base = async (over: Partial<BodyCardSpec> = {}): Promise<BodyCardSpec> => ({ type: "weekly", emblem: "star", label: "DAILY RECAP", title: "Québec Gold", hero: "Sunday, November 15", art: await plainArt(), ...over });

describe("body layout", () => {
  it("draws every string at 24 px or more with readable contrast, for a full and a sparse card", async () => {
    const full = await renderBodyCard(await base({ tiles: [{ value: "14", label: "Levels gained" }, { value: "1", label: "New 60s" }, { value: "9", label: "Dungeon clears" }, { value: "7", label: "Duels" }],
      sections: [{ title: "Race to 60", rows: [row("Bryn Ostrander", "Warlock", "60"), row("Aldric Vance", "Druid · level 51", "+6"), row("Mirelle Dax", "Mage · level 44", "+4")], moreLabel: "more" }, { title: "Dungeons", rows: [row("Guild record", "The Deadmines", "21:51")] }], fit: true }));
    const sparse = await renderBodyCard(await base({ tiles: [{ value: "1", label: "Duels" }], sections: [{ title: "PvP", rows: [row("Torvin Hale", "Most duel wins", "×1")] }], fit: true }));
    for (const card of [full, sparse]) { assertCardRules(card.report); expect(Math.min(...card.report.map((r) => r.size))).toBeGreaterThanOrEqual(24); }
    // A sparse card is as tall as its content, not 60 % black.
    const [a, b] = [await dims(full.png), await dims(sparse.png)];
    expect(b.height).toBeLessThan(a.height - 100);
    expect(b.height).toBeGreaterThanOrEqual(340);
  });

  it("shows what does not fit as one '+N more' row, and cuts a list without a label", async () => {
    const many = Array.from({ length: 8 }, (_, i) => row(`Player ${i}`, "Druid", String(i)));
    const counted = await renderBodyCard(await base({ tiles: [{ value: "1", label: "x" }], sections: [{ title: "T", rows: many, moreLabel: "more" }] }));
    expect(counted.report.some((r) => /^\+\d+ more$/.test(r.text))).toBe(true);
    const cut = await renderBodyCard(await base({ tiles: [{ value: "1", label: "x" }], sections: [{ title: "T", rows: many }] }));
    expect(cut.report.some((r) => /^\+\d+/.test(r.text))).toBe(false);
  });

  it("is 1200 x 630 when it is not cut to its content (the website's share images)", async () => {
    const card = await renderBodyCard(await base({ sections: [{ rows: [row("A")] }] }));
    expect(await dims(card.png)).toEqual({ width: 1200, height: 630 });
  });

  it("wraps a sentence to at most three lines and ends an overlong one with an ellipsis", () => {
    expect(wrapLines("one two three", 10, 3)).toEqual(["one two", "three"]);
    const lines = wrapLines("word ".repeat(80), 40, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]!.endsWith("…")).toBe(true);
  });
});

describe("bars layout", () => {
  it("draws classes and tiles at 24 px or more, and merges the classes past nine", async () => {
    const bars = Array.from({ length: 12 }, (_, i) => ({ name: `Class ${i}`, color: "#c79c6e", parts: [1, 2, 3, 4], total: 10 - (i % 3) }));
    const card = await renderBarsCard({ type: "roster", emblem: "people", label: "ROSTER", title: "Québec Gold", hero: "120 characters", legend: ["1-19", "20-39", "40-59", "60+"], bars, otherLabel: "Others",
      rightTitle: "Professions", tiles: [{ name: "Alchemy", value: "3 crafters", side: "225" }], rightNote: "No crafter: Mining, Skinning", art: await plainArt() });
    assertCardRules(card.report);
    expect(card.report.filter((r) => r.text.startsWith("Class ")).length + card.report.filter((r) => r.text.startsWith("Others")).length).toBe(9);
    expect(await dims(card.png)).toEqual({ width: 1200, height: 630 });
  });
});

describe("the cards that used the old framed layout", () => {
  const recap: DailyRecap = { day: "2026-11-15", race: null, dungeons: null, pvp: { duels: 1, topDueler: { name: "Torvin Hale", wins: 1 }, bgPlayed: 0, bgWon: 0 } };
  it("draws the daily recap sized to its content, and 1200 x 630 on the website path", async () => {
    const png = await scoreCardPng(dailyRecapCard(recap, "fr", "Québec Gold"));
    const size = await dims(png);
    expect(size.width).toBe(1200);
    expect(size.height).toBeLessThan(630);
    const branded = await scoreCardPng(dailyRecapCard(recap, "fr", "Québec Gold"), { branded: true });
    expect(await dims(branded)).toEqual({ width: 1200, height: 630 });
  });
  it("says the duel count once: on the figures strip, not again in a panel", () => {
    const card = dailyRecapCard(recap, "en", "QG");
    expect(card.stats.map((s) => s.label)).toContain("Duels");
    expect(card.recap!.sections.flatMap((s) => s.rows).some((r) => /^\d+ duels?$/i.test(r.name))).toBe(false);
    expect(card.footer).toBe("");
  });
  it("draws the raid-night check with singular French plurals and no developer footer", async () => {
    const check: RaidNightCheck = { raidId: "r1", title: "Molten Core", scheduledAt: new Date("2026-11-18T01:00:00Z"), maybe: 1, waitlisted: 1,
      slots: [{ role: "TANK", signed: 1, limit: 2 }, { role: "HEALER", signed: 3, limit: 5 }], rows: [{ name: "Alda", className: "Warrior", role: "TANK", status: "READY", issues: [], late: false, lastSeenDays: 0 }] };
    const card = raidNightCard(check, "fr", "America/Toronto");
    expect(JSON.stringify(card)).not.toContain("(s)");
    expect(card.recap!.sections[0]!.rows[0]!.sub).toBe("1 manquant");
    expect(card.footer).toBe("");
    expect(await dims(await scoreCardPng(card))).toMatchObject({ width: 1200 });
  });
  it("draws the roster with no tile for a profession nobody has", async () => {
    const characters = Array.from({ length: 12 }, (_, i) => ({ className: ["Mage", "Druid", "Rogue"][i % 3]!, race: "Human", level: 10 + i }));
    const visual = buildRosterVisual(characters, [{ profession: "Mining", skillLevel: 150, characterId: "a" }], 6);
    const card = rosterVisualCard(visual, "en", "Guild");
    expect(card.rosterLabels?.none).toBe("No crafter:");
    const png = await scoreCardPng(card);
    expect(await dims(png)).toEqual({ width: 1200, height: 630 });
    // The grid has twelve professions and one is staffed: the card names the gap in one line instead of eleven red tiles.
    expect(card.roster!.professions.filter((p) => p.crafters === 0)).toHaveLength(visual.professions.length - 1);
  });
  it("draws the server statistics compactly: member headline, figure tiles, class bars", async () => {
    const snap = (day: string) => ({ day, discordMembers: 150, activeMembers: 60, linkedMembers: 88, rosterSize: 212, onlinePeak: 40, level60: 14, messages: 1609, voiceMinutes: 12000, raids: 1, dungeonRuns: 12, levelBands: {}, classCounts: { Warrior: 31, Mage: 30 } });
    const card = serverStatsCard([snap("2026-11-12"), snap("2026-11-13")], "Québec Gold", "fr")!;
    expect(card.subtitle).toBe("150 membres");
    expect(card.stats).toHaveLength(8);
    expect(card.stats.find((s) => s.label === "Messages")?.value).toMatch(/^3\D218$/);
    expect(card.backdrop).toEqual({ kind: "board", key: "server-stats", fallbackKey: "community" });
    expect(await dims(await scoreCardPng(card))).toEqual({ width: 1200, height: 630 });
  });
  it("draws the anniversary and the achievements card (rows with badges) and an empty board with one sentence", async () => {
    const anniversary = serverAnniversaryCard({ serverName: "QG", years: 2, founded: new Date("2024-11-05T12:00:00Z"), members: 40, achievementsEarned: 12, oldestMembers: [{ displayName: "Aldric", createdAt: new Date("2024-11-06") }] }, "en");
    expect(anniversary.rows?.[0]?.right).toBeUndefined();
    expect((await dims(await scoreCardPng(anniversary))).width).toBe(1200);
    const achievements = achievementsCard("Aldric", [{ id: "dungeon-runs-1", earnedAt: new Date("2026-11-01"), value: 1 }], "en");
    expect(achievements.subtitle).toBe("");
    expect((await dims(await scoreCardPng(achievements))).width).toBe(1200);
    const empty: ScoreCard = { title: "Race to 60", subtitle: "0 of 0", stats: [], footer: "", ladder: { columns: [], boards: [{ rows: [] }], empty: "No levelled character reported yet." } };
    const png = await scoreCardPng(empty);
    expect((await dims(png)).height).toBeLessThanOrEqual(400);
  });
});

describe("the old framed layout is gone", () => {
  const source = (file: string) => readFileSync(new URL(`../src/services/${file}`, import.meta.url), "utf8");
  it("has no render function left for the cards that moved", () => {
    const card = source("score-card.ts");
    for (const name of ["renderRecap", "renderUnlock", "renderRoster", "renderDungeon"]) expect(card, name).not.toContain(`function ${name}(`);
    expect(source("record-card.ts")).not.toContain("renderRecordCard");
    expect(source("record-card.ts")).not.toContain("sharp");
  });
});

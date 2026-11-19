import { describe, expect, it } from "vitest";
import { weeklyDungeonCard, weeklyReportCard } from "../src/services/weekly-card.js";
import { wowWeeklyStillWanted } from "../src/services/discord-jobs.js";
import { weeklyCardExtra } from "../src/commands/stats.js";
import { weeklyReportEmbeds } from "../src/commands/stats.js";
import { duelSummaryCard } from "../src/services/duel-card.js";
import { emptyNameBook } from "../src/services/character-display.js";
import { cardAltText } from "../src/services/card-alt.js";
import { scoreCardPng } from "../src/services/score-card.js";
import type { WeeklyReport } from "../src/services/weekly-report.js";

const stats = (raids: number, bossKills: number) => ({ since: new Date(), raids, averageRaiders: 18, bossKills, lootCount: 3, gpSpent: 90, epAwarded: 40, newMembers: 2, applications: 1, topAttendance: [], topLoot: [] });
const report = { weekStart: new Date("2026-12-08T15:00:00Z"), weekEnd: new Date("2026-12-15T15:00:00Z"), guild: stats(3, 9), previous: stats(2, 9), cores: [{ name: "Core A", raids: 2, attendancePct: 88, bossKills: 6, loot: 2, gp: 60, perfect: [] }],
  dungeons: { runs: 12, completed: 10, fastest: [], firsts: ["A (Deadmines)"], records: ["B (RFC)", "C (WC)"], topPoints: [], marathon: { name: "Aldric", runs: 4 } },
  raiderOfWeek: { name: "Brenna", ep: 30, raids: 3 }, dungeonHero: { name: "Cedric", points: 120 } } as unknown as WeeklyReport;

describe("weekly report card", () => {
  it("shows the week against the one before and the players of the week", async () => {
    const card = weeklyReportCard(report, "en");
    expect(card.stats.map(s => `${s.value} ${s.note ?? ""}`.trim())).toEqual(["3 +1 vs last week · 18 raiders/raid", "9 same as last week", "10 12 runs"]);
    expect(card.rows?.map(r => r.sub)).toEqual(["Raider of the week", "Dungeon hero", "Dungeon marathon", "2 raids · 6 boss kills · 88 % present · 2 items (60 GP)"]);
    // Records and first clears have one home, the weekly records post: never a badge here.
    expect(card.badges).toBeUndefined();
    expect(card.footer).toBe("Reported by members' addons · no points");
    expect(card.backdrop).toEqual({ kind: "board", key: "weekly", fallbackKey: "activity" });
    expect(cardAltText(card)).toContain("The guild's week");
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
  });

  it("speaks French and drops empty parts", () => {
    const quiet = { ...report, raiderOfWeek: null, dungeonHero: null, cores: [], guild: { ...report.guild, newMembers: 0 }, dungeons: { ...report.dungeons, marathon: null, records: [], firsts: [] } } as unknown as WeeklyReport;
    const card = weeklyReportCard(quiet, "fr");
    expect(card.title).toBe("La semaine de la guilde");
    // A quiet week shows the week before as its next useful fact; with nothing before it either, nothing is added.
    expect(card.rows).toEqual([{ name: "Semaine passée", sub: "2 raids · 9 victoires" }]);
    expect(weeklyReportCard({ ...quiet, previous: stats(0, 0) }, "fr").rows).toEqual([]);
    expect(card.badges).toBeUndefined();
    expect(card.footer).toBe("Rapporté par les addons des membres · aucun point");
  });
});

describe("duel summary truncation", () => {
  it("counts the duels it no longer lists and says 'and N more'", () => {
    const duels = Array.from({ length: 3 }, (_, i) => ({ reportKey: `k${i}`, winnerId: "w", loserId: "l", winnerCharacter: "A", loserCharacter: "B", winnerLevel: 58, loserLevel: 60, reason: "knockout", endedAt: new Date(), points: 14, winnerScore: 0, winnerStreak: 0, winnerBest: 0 }));
    const card = duelSummaryCard(duels, "en", new Map(), emptyNameBook, 40);
    expect(card.subtitle).toBe("43 more duels counted");
    expect(card.stats.map(x => x.value)).toEqual(["43", String(3 * 14)].map((v, i) => i ? String(3 * 14) : v));
    expect(card.badges?.[0]?.text).toBe("and 40 more");
  });
});

describe("weekly report text that stays", () => {
  it("only the weekly report follows the weekly switch, never the daily recap on the same route", () => {
    expect(wowWeeklyStillWanted("weekly-wow:2026-12-15T15:00:00.000Z", { weeklyReportEnabled: false })).toBe(false);
    expect(wowWeeklyStillWanted("weekly-wow:2026-12-15T15:00:00.000Z", { weeklyReportEnabled: true })).toBe(true);
    expect(wowWeeklyStillWanted("daily-recap:2026-12-15", { weeklyReportEnabled: false })).toBe(true);
  });

  it("adds one world PvP line to the card and the text only when the week has data", () => {
    const none = weeklyReportCard(report, "en");
    expect(JSON.stringify(none)).not.toContain("World PvP");
    const withPvp = { ...report, worldPvp: { kills: 40, defends: 6, helped: 9 } } as unknown as WeeklyReport;
    expect(JSON.stringify(weeklyReportCard(withPvp, "fr"))).toContain("40 victoires · 6 défenses · 9 appels répondus");
    expect(JSON.stringify(weeklyReportEmbeds(withPvp, "en"))).toContain("40 kills · 6 defends · 9 calls answered");
    expect(JSON.stringify(weeklyReportEmbeds(report, "en"))).not.toContain("World PvP");
  });

  it("keeps EP, loot and GP as text under the card, and posts no card for an empty week", () => {
    const full = { ...report, guild: { ...report.guild, coreId: undefined, topAttendance: [{ name: "Brenna", raids: 3 }], topLoot: [] } } as unknown as WeeklyReport;
    const extra = weeklyCardExtra(full, "en", weeklyReportEmbeds(full, "en")) as { card?: unknown; cardOnly?: { embeds: { fields?: { name: string }[] }[] } };
    expect(extra.card).toBeTruthy();
    const text = JSON.stringify(extra.cardOnly!.embeds);
    expect(text).toContain("EP");
    expect(text).toContain("Brenna (3)");
    const empty = { ...report, guild: { ...report.guild, coreId: undefined, raids: 0, lootCount: 0 }, dungeons: { ...report.dungeons, runs: 0 } } as unknown as WeeklyReport;
    expect(weeklyCardExtra(empty, "en", weeklyReportEmbeds(empty, "en"))).toEqual({});
  });
});

describe("weekly report 9.4: cores in the card, a dungeon card, records once", () => {
  const withRuns = { ...report, dungeons: { ...report.dungeons, fastest: [{ dungeon: "Deadmines", durationSec: 1500, players: ["Aldric", "Brenna"] }], topPoints: [{ name: "Cedric", points: 120 }, { name: "Dina", points: 60 }] } } as unknown as WeeklyReport;

  it("writes the cores line and the week line in the short form", () => {
    const text = JSON.stringify(weeklyReportEmbeds(report, "en").map(embed => embed.toJSON()));
    expect(text).toContain("2 raids · 6 boss kills · 88 % present · 2 items (60 GP)");
    expect(text).toContain("Week <t:");
    expect(text).toContain("→");
  });

  it("no longer lists records or first completions in the text report", () => {
    const text = JSON.stringify(weeklyReportEmbeds(report, "en").map(embed => embed.toJSON()));
    expect(text).not.toContain("B (RFC)");
    expect(text).not.toContain("A (Deadmines)");
  });

  it("draws the dungeon week as a second card and keeps the leaderboard link as text", () => {
    const card = weeklyDungeonCard(withRuns, "en", "Quebec Gold")!;
    expect(card.recap?.sections.map(s => s.title)).toEqual(["Fastest clear per dungeon", "Also on the dungeon board"]);
    expect(card.recap?.sections[0]!.rows[0]).toMatchObject({ name: "Deadmines", right: "25:00" });
    expect(JSON.stringify(card)).not.toContain("B (RFC)");
    expect(weeklyDungeonCard({ ...withRuns, dungeons: { ...withRuns.dungeons, runs: 0 } } as unknown as WeeklyReport, "en", "Quebec Gold")).toBeNull();
    const embeds = weeklyReportEmbeds(withRuns, "en", "https://example.test/lb");
    const extra = weeklyCardExtra(withRuns, "en", embeds, undefined, "Quebec Gold") as { extraCard?: { card: unknown }; cardOnly?: { embeds: { title?: string; description?: string }[] } };
    expect(extra.extraCard?.card).toBeTruthy();
    const titles = extra.cardOnly!.embeds.map(embed => embed.title);
    expect(titles).not.toContain("⚔️ Raid cores");
    expect(titles).not.toContain("🗝️ Dungeon week");
    expect(JSON.stringify(extra.cardOnly)).toContain("https://example.test/lb");
    // No dungeon card (no timed clear): the dungeon text stays.
    const noCard = weeklyCardExtra(report, "en", weeklyReportEmbeds(report, "en"));
    expect((noCard as { extraCard?: unknown }).extraCard).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { weeklyReportCard } from "../src/services/weekly-card.js";
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
    expect(card.rows?.map(r => r.sub)).toEqual(["Raider of the week", "Dungeon hero", "Dungeon marathon", "2 raid(s) · 6 boss kill(s)"]);
    expect(card.badges?.map(b => b.text)).toEqual(["2 dungeon record(s)", "1 first clear(s)"]);
    expect(card.backdrop).toEqual({ kind: "board", key: "weekly", fallbackKey: "activity" });
    expect(cardAltText(card)).toContain("The guild's week");
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
  });

  it("speaks French and drops empty parts", () => {
    const quiet = { ...report, raiderOfWeek: null, dungeonHero: null, cores: [], guild: { ...report.guild, newMembers: 0 }, dungeons: { ...report.dungeons, marathon: null, records: [], firsts: [] } } as unknown as WeeklyReport;
    const card = weeklyReportCard(quiet, "fr");
    expect(card.title).toBe("La semaine de la guilde");
    expect(card.rows).toEqual([]);
    expect(card.badges).toBeUndefined();
    expect(card.footer).toContain("guildedwow.com");
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

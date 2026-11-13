import { describe, expect, it } from "vitest";
import { weeklyReportCard } from "../src/services/weekly-card.js";
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
    expect(card.stats.map(s => `${s.value} ${s.note ?? ""}`.trim())).toEqual(["3 +1 vs last week", "9 same as last week", "10 12 runs"]);
    expect(card.rows?.map(r => r.sub)).toEqual(["Raider of the week", "Dungeon hero", "Dungeon marathon", "Joined the Discord this week", "2 raid(s) · 6 boss kill(s)"]);
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
    expect(card.badges?.[0]?.text).toBe("and 40 more");
  });
});

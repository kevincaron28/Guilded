import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { emptyNameBook } from "../src/services/character-display.js";
import { duelSummaryCard } from "../src/services/duel-card.js";
import { raidEndCard } from "../src/services/end-cards.js";
import { weeklyRookieCard } from "../src/services/rookie-card.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";
import { weeklyReportCard } from "../src/services/weekly-card.js";
import { welcomeCard } from "../src/services/welcome-card.js";
import { worldPvpRecapCard } from "../src/services/world-pvp-card.js";
import type { WeeklyReport } from "../src/services/weekly-report.js";

// Sample names only. CARD_RENDER_DIR writes the PNGs (group-3 previews).
const OUT = process.env["CARD_RENDER_DIR"];
const save = (name: string, png: Buffer) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); } };

const stats = (raids: number, bossKills: number) => ({ since: new Date(), raids, averageRaiders: 18, bossKills, lootCount: 3, gpSpent: 90, epAwarded: 40, newMembers: 2, applications: 1, topAttendance: [] });
const report = { weekStart: new Date("2026-12-08T15:00:00Z"), weekEnd: new Date("2026-12-15T15:00:00Z"), guild: stats(3, 9), previous: stats(2, 9), cores: [{ name: "Core A", raids: 2, attendancePct: 88, bossKills: 6, loot: 2, gp: 60, perfect: [] }],
  dungeons: { runs: 12, completed: 10, fastest: [], firsts: ["A (Deadmines)"], records: ["B (RFC)", "C (WC)"], topPoints: [], marathon: { name: "Aldric", runs: 4 } },
  raiderOfWeek: { name: "Brenna", ep: 30, raids: 3 }, dungeonHero: { name: "Cedric", points: 120 } } as unknown as WeeklyReport;
const raid = { title: "Molten Core <Week 1>", startedAt: new Date("2026-12-09T01:00:00Z"), endedAt: new Date("2026-12-09T04:30:00Z"), durationMinutes: 210, raiders: 38, late: 2, absent: 1,
  bossesKilled: 7, bossesPlanned: 10, killedNames: ["Lucifron", "Magmadar", "Gehennas", "Garr", "Shazzrah", "Baron Geddon", "Golemagg"], epAwarded: 380, epRecipients: 38, lootCount: 2, gpSpent: 140,
  topLoot: [{ item: "Sulfuras <Hand>", winner: "Kévin", gp: 90 }, { item: "Choker of the Fire Lord", winner: "Mirabelle", gp: 50 }] };
const s = (name: string, kills: number, defends: number, helped: number) => ({ memberId: name, name, kills, defends, helped });
const recap = { killer: s("Aldric", 12, 1, 0), defender: s("Brenna", 3, 7, 2), helper: s("Cedric", 0, 0, 5), quickest: { character: "Dara", zone: "Duskwood", seconds: 75 }, calls: 14, totals: { kills: 20, deaths: 8 } };
const duels = Array.from({ length: 5 }, (_, i) => ({ reportKey: `k${i}`, winnerId: "w", loserId: "l", winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: 60, loserLevel: 58, reason: "knockout", points: 14, winnerScore: 120, winnerStreak: 1, winnerBest: 3, endedAt: new Date() }));

function cards(lang: "en" | "fr"): [string, ScoreCard][] {
  return [
    ["weekly-report", weeklyReportCard(report, lang)],
    ["raid-report", raidEndCard(raid as never, lang)],
    ["rookie-of-the-week", weeklyRookieCard(lang, { name: "Brenna Ironwood", points: 40, place: 2, ranked: 8, week: "2026-12-07" })],
    ["welcome", welcomeCard(lang, { name: "Brenna Ironwood", guildName: "Québec Gold", memberCount: 41 })],
    ["world-pvp-recap", worldPvpRecapCard(recap as never, lang)],
    ["duel-summary", duelSummaryCard(duels as never, lang, new Map([["aldric", "Warrior"], ["brenna", "Mage"]]), emptyNameBook, 3, 40)]
  ];
}

describe("data cards on the banner layout", () => {
  for (const lang of ["en", "fr"] as const) {
    it(`draws each data card from its unchanged definition (${lang})`, async () => {
      for (const [name, card] of cards(lang)) {
        const png = await scoreCardPng(card);
        expect(png, name).toBeInstanceOf(Buffer);
        const meta = await sharp(png!).metadata();
        expect([meta.width, meta.height], name).toEqual([1200, 630]);
        save(`${name}-${lang}`, png!);
      }
    }, 120_000);
  }
});

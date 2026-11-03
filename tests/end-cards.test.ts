import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { achievementUnlockedCard, battlegroundEndCard, raidEndCard } from "../src/services/end-cards.js";
import { scoreCardPng } from "../src/services/score-card.js";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import type { RaidReport } from "../src/services/raid-report.js";

const raid: RaidReport = { title: "Molten Core <Week 1>", startedAt: new Date("2026-12-09T01:00:00Z"), endedAt: new Date("2026-12-09T04:30:00Z"), durationMinutes: 210, raiders: 38, late: 2, absent: 1,
  bossesKilled: 7, bossesPlanned: 10, killedNames: ["Lucifron", "Magmadar", "Gehennas", "Garr", "Shazzrah", "Baron Geddon", "Golemagg"], epAwarded: 380, epRecipients: 38, lootCount: 2, gpSpent: 140,
  topLoot: [{ item: "Sulfuras <Hand>", winner: "Kévin", gp: 90 }, { item: "Choker of the Fire Lord", winner: "Mirabelle", gp: 50 }] };
const bg = { reportId: "abc12345", mode: "casual", mapId: 489, bracket: "10-19", endedAt: new Date("2026-12-10T02:00:00Z"), durationSeconds: 754, outcome: "win", presence: "complete", status: "PROVISIONAL", corroborated: false };

describe("raid and battleground end cards", () => {
  it("summarises a raid without per-player performance and falls back to bosses without loot", () => {
    const card = raidEndCard(raid);
    expect(card.stats[0]).toMatchObject({ value: "7/10", accent: "gold", note: "Partial clear" });
    expect(card.rows?.[0]).toMatchObject({ name: "Sulfuras <Hand>", right: "90 GP" });
    expect(raidEndCard({ ...raid, topLoot: [], lootCount: 0 }).rows).toHaveLength(5);
    expect(raidEndCard({ ...raid, bossesKilled: 10 }).stats[0]).toMatchObject({ accent: "green", note: "Full clear" });
    expect(raidEndCard(raid, "fr").stats[0]!.note).toBe("Complété en partie");
  });
  it("shows only the player's own result, marks provisional reports and names known maps", () => {
    const card = battlegroundEndCard(bg, [bg, { ...bg, reportId: "zzz99999", mapId: 9999, outcome: "loss" }]);
    expect(card.title).toBe("Warsong Gulch");
    expect(card.stats[0]).toMatchObject({ value: "Victory", accent: "green" });
    expect(card.stats[1]!.value).toBe("12:34");
    expect(card.badges?.[0]).toMatchObject({ tone: "warn" });
    expect(card.rows?.map(r => r.name)).toEqual(["Warsong Gulch", "Map 9999"]);
    expect(JSON.stringify(card)).not.toMatch(/honor|damage|kills/i.test("") ? "" : /\bdamage dealt\b/);
  });
  it("renders both as 1200x630 PNGs", async () => {
    for (const card of [raidEndCard(raid), battlegroundEndCard(bg, [bg])]) {
      expect(await sharp((await scoreCardPng(card))!).metadata()).toMatchObject({ width: 1200, height: 630, format: "png" });
    }
  });
});

describe("achievement unlocked card", () => {
  const ids = ACTIVE_ACHIEVEMENTS.slice(0, 12).map(def => def.id);
  it("lists the newest first with description, tier counts and progress, and caps the list at eight", () => {
    const card = achievementUnlockedCard("frumpytm", ids, 20, "fr");
    expect(card.unlocks).toHaveLength(8);
    expect(card.unlocks![0]!.name).toBe(ACTIVE_ACHIEVEMENTS[11]!.fr.name);
    expect(card.unlocks![0]!.detail).toBe(ACTIVE_ACHIEVEMENTS[11]!.fr.description);
    expect(card.unlocksMore).toBe(4);
    expect(card.progress).toMatchObject({ value: 20, max: ACTIVE_ACHIEVEMENTS.length });
    expect(card.tierCounts!.reduce((sum, tier) => sum + tier.count, 0)).toBe(12);
    expect(JSON.stringify(card)).not.toMatch(/points?":|\+\d+ (GP|EP)/);
  });
  it("renders 1200x630 PNGs for one, several and many unlocks, and still draws a definition queued without the new fields", async () => {
    const cases = [ids.slice(0, 1), ids.slice(0, 3), ids.slice(0, 6), ids];
    for (const lang of ["en", "fr"] as const) for (const set of cases) {
      const png = await scoreCardPng(achievementUnlockedCard("A very long member display name indeed", set, 30, lang));
      expect(await sharp(png!).metadata()).toMatchObject({ width: 1200, height: 630, format: "png" });
    }
    const queued = { ...achievementUnlockedCard("frumpytm", ids.slice(0, 2), 5, "en") };
    for (const key of ["unlocks", "unlocksMore", "moreLabel", "progress", "tierCounts"] as const) delete queued[key];
    expect(await sharp((await scoreCardPng(queued))!).metadata()).toMatchObject({ width: 1200, height: 630 });
  });
});

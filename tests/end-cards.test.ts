import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { achievementUnlockedCard, achievementsCard, battlegroundEndCard, raidArtKey, raidEndCard } from "../src/services/end-cards.js";
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

describe("card art keys (batch 2)", () => {
  it("picks the Molten Core picture from the title or the bosses killed, in English or French, else the default", () => {
    expect(raidArtKey({ title: "Molten Core", killedNames: [] })).toBe("molten-core");
    expect(raidArtKey({ title: "Raid du mardi", killedNames: ["Lucifron", "Magmadar"] })).toBe("molten-core");
    expect(raidArtKey({ title: "Cœur du Magma", killedNames: [] })).toBe("molten-core");
    expect(raidArtKey({ title: "Onyxia", killedNames: ["Onyxia"] })).toBe("default");
  });
  it("names a battleground picture by map id, so English and French clients share it", () => {
    const row = { reportId: "r", mode: "10v10", mapId: 489, bracket: "60", endedAt: new Date(0), outcome: "win", presence: "complete", status: "PROVISIONAL" };
    expect(battlegroundEndCard(row, [row]).backdrop).toEqual({ kind: "battleground", key: "warsong-gulch", fallbackKey: "default" });
    expect(battlegroundEndCard({ ...row, mapId: 529 }, [], "fr").backdrop?.key).toBe("arathi-basin");
    expect(battlegroundEndCard({ ...row, mapId: 30 }, [], "fr").backdrop?.key).toBe("alterac-valley");
  });
});

describe("achievements card painting", () => {
  const plain = (card: ReturnType<typeof achievementsCard>) => { const copy = { ...card }; delete copy.backdrop; return copy; };
  const items = [{ id: "dungeon-runs-1", earnedAt: new Date("2026-11-01"), value: 1 }, { id: "raids-1", earnedAt: new Date("2026-11-02"), value: 1 }, { id: "messages-1000", earnedAt: null, value: 400 }];
  it("asks for the painted trophy wall, keeps its painted badges and its row layout (label, rows, footer), and draws a real picture", async () => {
    const card = achievementsCard("Aldric", items, "en");
    expect(card.backdrop).toEqual({ kind: "board", key: "achievements" });
    expect((card.rows ?? []).every(row => (row.icon ?? "").includes("<badge-art"))).toBe(true);
    expect(card.rowsLabel).toBeTruthy();
    expect(card.footer).toBeTruthy();
    const { default: sharpLib } = await import("sharp");
    const withArt = (await scoreCardPng(card))!, without = (await scoreCardPng(plain(card)))!;
    expect(Buffer.compare(withArt, without)).not.toBe(0);
    expect((await sharpLib(withArt).metadata()).height).toBe(630);
  });
  it("draws the plain card when the painting file is missing", async () => {
    const card = achievementsCard("Aldric", items, "en");
    const missing = (await scoreCardPng({ ...card, backdrop: { kind: "board", key: "no-such-picture" } }))!, without = (await scoreCardPng(plain(card)))!;
    expect(Buffer.compare(missing, without)).toBe(0);
  });
});

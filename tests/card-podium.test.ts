import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { communityBoardCard } from "../src/services/community-leaderboard.js";
import { weeklyPostCardExtra, weeklyHonorsMessage } from "../src/services/community-honors.js";
import { splitName } from "../src/services/card-podium.js";
import { scoreCardPng } from "../src/services/score-card.js";
import type { ScoreCard } from "../src/services/score-card.js";

// Set PODIUM_OUT to a folder to keep the sample pictures (preview only).
const OUT = process.env["PODIUM_OUT"];
const NAMES = ["Simon (Crashing Paladin)", "Kev (Lebowski Holyrod)", "El Pirata (El Pirata)", "haraz5093", "Marie-Ève (Frostbolt Mage)", "Jean-Philippe (Grimtotem Shaman)", "Dr Bob", "Ti-Guy (Hunter Pete)", "Xx_Épée_xX (Warrior)", "Léa", "Catherine (Nightfall Priest)", "Mathieu", "Sébastien (Wrathful Druid)", "Anne-Sophie (Stabby McRogue)", "Olivier", "Patate (Warlock Frite)"];
const names = (count: number) => new Map(Array.from({ length: count }, (_, i) => [String(BigInt('100000000000000000') + BigInt(i)), `${NAMES[i % NAMES.length]!.replace(/^(\S+)/, `$1${i >= NAMES.length ? i : ""}`)}`]));
const board = (count: number) => Array.from({ length: count }, (_, i) => {
  const points = Math.round(2400 / (1 + i * 0.28)) + (count - i);
  return { userId: String(BigInt('100000000000000000') + BigInt(i)), points, balance: points, discord: Math.round(points * 0.6), dungeons: Math.round(points * 0.3), pvp: points - Math.round(points * 0.6) - Math.round(points * 0.3) };
});
const save = (name: string, png: Buffer) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), png); } };

describe("community podium card", () => {
  for (const lang of ["fr", "en"] as const) for (const count of [3, 12, 24, 40]) {
    it(`draws ${count} members in ${lang}`, async () => {
      const rows = board(count);
      const card = communityBoardCard({ lang, season: { name: "Novembre 2026", status: "ACTIVE" }, board: rows as never, names: names(count), updatedAt: new Date("2026-11-19T21:29:00Z"), timeZone: "America/Toronto" });
      expect(card.ladder!.boards[0]!.rows.length).toBe(Math.min(count, 30));
      const png = (await scoreCardPng(card))!;
      expect(png).toBeTruthy();
      const meta = await sharp(png).metadata();
      expect(meta.width).toBe(1200);
      expect(meta.height).toBeGreaterThan(500);
      save(`community-${count}-${lang}.png`, png);
    }, 30000);
  }
  it("splits a name and its character", () => {
    expect(splitName("Simon (Crashing Paladin)")).toEqual({ name: "Simon", character: "Crashing Paladin" });
    expect(splitName("Kev (Lebowski Holyr")).toEqual({ name: "Kev", character: "Lebowski Holyr" });
    expect(splitName("haraz5093")).toEqual({ name: "haraz5093", character: "" });
  });
});

describe("weekly honors card", () => {
  const recap = { points: 3984, members: 37, messages: 5120, reactions: 800, voiceHours: 66, activities: 3, raids: 0, bossKills: 0, dungeonRuns: 21, newMembers: 5 };
  for (const lang of ["fr", "en"] as const) it(`is one card with a tagged MVP in ${lang}`, async () => {
    const rows = board(8), nm = names(8), mvp = rows[0]!.userId, rookie = rows[3]!;
    const message = weeklyHonorsMessage(lang, { week: "2026-11-09", board: rows as never, mvps: [mvp], recap, names: nm, rookie: rookie as never, ping: true });
    const extra = weeklyPostCardExtra(lang, message, "2026-11-09", rows as never, [mvp], rookie as never, nm, recap, new Map([[mvp, 2]])) as { card: ScoreCard; cardOnly: { content: string; embeds: unknown[] } };
    expect(extra.cardOnly.content).toContain(`<@${mvp}>`);
    expect(extra.cardOnly.embeds).toHaveLength(1);
    const png = (await scoreCardPng(extra.card))!;
    expect(png).toBeTruthy();
    save(`weekly-${lang}.png`, png);
  }, 30000);
});

describe("podium art", () => {
  it("ships every emblem, cut out and small", async () => {
    const { check } = await import("../scripts/build-podium-art.mjs");
    expect(await check()).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";
// Turns PoE2 tracking on for this file (see tests/helpers/focus-switches.ts).
vi.mock("../companion/active-games.mjs", async (original) => (await import("./helpers/focus-switches.js")).poeTrackingOn(await original()));
import sharp from "sharp";
import { GLYPHS, GLYPH_BY_ID, badgeInner, badgeLabel, badgeSvg } from "../src/services/achievement-badges.js";
import { ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { achievementsCard } from "../src/services/end-cards.js";
import { scoreCardPng } from "../src/services/score-card.js";

describe("achievement badge art", () => {
  it("gives every catalogue id a glyph, and every glyph entry maps to an id", () => {
    for (const def of ACHIEVEMENTS) expect(GLYPHS[GLYPH_BY_ID[def.id]!], def.id).toBeTruthy();
    expect(Object.keys(GLYPH_BY_ID).sort()).toEqual(ACHIEVEMENTS.map(def => def.id).sort());
  });
  it("tells badges apart: a glyph repeats within a game only across tiers or ranks of one progression", () => {
    const seen = new Map<string, string>();
    for (const def of ACHIEVEMENTS) {
      const key = `${def.game}/${def.edition ?? ""}/${GLYPH_BY_ID[def.id]}/${def.tier}/${def.rank ?? 0}`;
      expect(seen.get(key), `${def.id} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, def.id);
    }
  });
  it("renders every badge, earned and locked, as safe self-contained svg that rasterises", async () => {
    for (const def of ACHIEVEMENTS) for (const earned of [true, false]) {
      const svg = badgeSvg(def, earned, { size: 64, label: badgeLabel(def, earned, "en") });
      expect(svg).not.toMatch(/<script|href=|url\((?!#)|<image|<style|on\w+=/i);
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      expect((await sharp(png).metadata()).width).toBe(64);
    }
  });
  it("uses unique gradient ids per badge and state so many can share one page", () => {
    const ids = ACHIEVEMENTS.flatMap(def => [true, false].map(earned => badgeInner(def, earned).match(/id="([^"]+)-m"/)![1]!));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("is decorative without a label and an image with one; labels exist in English and French", () => {
    const def = ACHIEVEMENTS[0]!;
    expect(badgeSvg(def, true)).toContain('aria-hidden="true"');
    expect(badgeSvg(def, true, { label: "x" })).toContain('role="img" aria-label="x"');
    expect(badgeLabel(def, true, "en")).toBe("Getting Started: Bronze, unlocked");
    expect(badgeLabel(def, false, "fr")).toBe("Premiers pas: Bronze, verrouillé");
  });
  it("shows locked badges in greys only", () => {
    const locked = badgeInner(ACHIEVEMENTS[0]!, false);
    for (const hex of locked.match(/#[0-9a-f]{6}/gi) ?? []) { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), hex).toBeLessThan(16); }
  });
  it("draws a frame and metal for every tier, with rank pips only on long progressions", () => {
    const tiers = new Set(ACHIEVEMENTS.map(def => def.tier));
    expect([...tiers].sort()).toEqual(["bronze", "epic", "gold", "legendary", "platinum", "silver"]);
    const frames = new Set(["bronze", "silver", "gold", "platinum", "epic", "legendary"].map(tier => { const def = ACHIEVEMENTS.find(row => row.tier === tier)!; return badgeInner(def, true).match(/<g fill="url\(#[^"]+-m\)"[^>]*>(.*?)<\/g>/)![1]; }));
    expect(frames.size).toBe(6);
    const pips = (id: string) => (badgeInner(ACHIEVEMENTS.find(def => def.id === id)!, true).match(/<circle cx="[\d.]+" cy="49.5/g) ?? []).length;
    expect(pips("messages-100")).toBe(1);
    expect(pips("messages-250000")).toBe(10);
    expect(pips("voice-hours-1000")).toBe(8);
    expect(pips("wow-level-20")).toBe(0);
  });
  it("draws on the share card, in both languages", async () => {
    const items = ACHIEVEMENTS.map((def, i) => ({ id: def.id, value: i < 4 ? def.threshold : 1, earnedAt: i < 4 ? new Date("2026-10-20T00:00:00Z") : null }));
    for (const lang of ["en", "fr"] as const) {
      const card = achievementsCard("Kev", items, lang);
      expect(card.rows!.every(row => row.icon?.includes("<linearGradient"))).toBe(true);
      expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
    }
  });
});
